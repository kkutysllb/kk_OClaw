/**
 * Python gateway lifecycle management for the Electron desktop shell.
 *
 * Ported from the previous Rust implementation (`desktop/src-tauri/src/backend.rs`).
 * Responsibilities:
 *  - Resolve the gateway launch command (bundled exe → venv → system python)
 *  - Spawn the child process with an isolated environment
 *  - Poll `/health` until the gateway responds (or times out)
 *  - Capture stdout/stderr into a rotating in-memory log buffer + log file
 *  - Kill the child cleanly on shutdown (SIGTERM → SIGKILL)
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { platform } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  getAuthJwtSecretPath,
  getBackendDir,
  getBundledConfigTemplatePath,
  getBundledSkillsDir,
  getDesktopConfigPath,
  getDesktopExtensionsConfigPath,
  getGatewayExecutable,
  getGatewayLogPath,
  getKkoclawHome,
  getLogsDir,
  getSkillsDir,
  isPackaged,
  REPO_ROOT,
} from "./paths.js";
import { migrateDesktopConfigYaml } from "./config-migration.js";

// ── Constants ────────────────────────────────────────────────────────────

/** Default gateway port (distinct from the web deployment's 9987). */
export const DEFAULT_GATEWAY_PORT = 19987;
/** Gateway host — always localhost, never exposed externally. */
const GATEWAY_HOST = "127.0.0.1";
/** Health-probe interval in milliseconds. */
const HEALTH_CHECK_INTERVAL_MS = 500;
/** Health-probe timeout in seconds. */
const HEALTH_CHECK_TIMEOUT_SECS = 120;
/** Maximum log lines retained in memory. */
const MAX_LOG_LINES = 500;

export type BackendStatusKind = "stopped" | "starting" | "running" | "error";

export interface BackendStatus {
  status: BackendStatusKind;
  port: number;
  error?: string;
}

// ── Gateway port resolution ──────────────────────────────────────────────

/**
 * Resolve the gateway port. Prefers a `GATEWAY_PORT` env override (useful for
 * running multiple instances), otherwise falls back to the default.
 */
export function resolveGatewayPort(): number {
  const fromEnv = Number.parseInt(process.env.GATEWAY_PORT ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_GATEWAY_PORT;
}

// ── BackendManager ───────────────────────────────────────────────────────

type StatusListener = (status: BackendStatus) => void;

/**
 * Manages a single embedded Python gateway process.
 *
 * State transitions: stopped → starting → running | error → stopped.
 * The manager is a singleton held by the main process; the renderer polls
 * status via IPC.
 */
export class BackendManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private status: BackendStatus = {
    status: "stopped",
    port: resolveGatewayPort(),
  };
  private logs: string[] = [];
  private logStream: WriteStream | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private healthStartTime = 0;

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(listener: StatusListener): () => void {
    this.on("status", listener);
    return () => this.off("status", listener);
  }

  /** Current backend status snapshot. */
  getStatus(): BackendStatus {
    return { ...this.status };
  }

  /** Recent log lines (most recent last). */
  getLogs(): string[] {
    return [...this.logs];
  }

  // ── Launch ────────────────────────────────────────────────────────────

  /**
   * Launch the gateway as the desktop-owned child process.
   */
  async launch(): Promise<BackendStatus> {
    if (this.child || this.status.status === "starting") {
      return this.getStatus();
    }

    const port = resolveGatewayPort();

    this.ensureDataDirs();
    this.initConfig();
    this.migrateConfig();
    this.initExtensionsConfig();
    this.initSkills();
    this.openLogStream();

    const cmd = this.resolveCommand(port);
    if (!cmd) {
      const err = "No Python runtime or bundled gateway found.";
      this.appendLog(`[backend] ${err}`);
      await this.closeLogStream();
      this.setStatus({ status: "error", port, error: err });
      return this.getStatus();
    }

    this.appendLog(`[backend] launching: ${cmd.command} ${cmd.args.join(" ")}`);
    this.setStatus({ status: "starting", port });

    try {
      this.child = spawn(cmd.command, cmd.args, {
        env: this.buildEnv(port),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.appendLog(`[backend] spawn failed: ${msg}`);
      await this.closeLogStream();
      this.setStatus({ status: "error", port, error: msg });
      return this.getStatus();
    }

    this.wireProcessIO();
    this.child.once("exit", (code, signal) => {
      this.appendLog(
        `[backend] process exited (code=${code}, signal=${signal})`,
      );
      if (this.status.status !== "error" && this.status.status !== "stopped") {
        this.setStatus({ status: "stopped", port });
      }
      this.child = null;
      this.stopHealthMonitor();
      void this.closeLogStream();
    });

    this.startHealthMonitor(port);
    return this.getStatus();
  }

  /** Stop the gateway process. */
  async stop(): Promise<BackendStatus> {
    this.stopHealthMonitor();
    const port = resolveGatewayPort();
    if (!this.child) {
      await this.closeLogStream();
      this.setStatus({ status: "stopped", port });
      return this.getStatus();
    }
    try {
      await this.killProcess(this.child);
    } finally {
      this.child = null;
      await this.closeLogStream();
    }
    this.setStatus({ status: "stopped", port });
    return this.getStatus();
  }

  /** Restart: stop, wait, then launch. */
  async restart(): Promise<BackendStatus> {
    await this.stop();
    await new Promise((r) => setTimeout(r, 1000));
    return this.launch();
  }

  // ── Command resolution (three-tier fallback) ──────────────────────────

  private resolveCommand(port: number): {
    command: string;
    args: string[];
  } | null {
    // 1. Bundled PyInstaller executable (packaged build).
    const exe = getGatewayExecutable();
    if (exe) {
      return { command: exe, args: [] };
    }

    const backendDir = getBackendDir();
    if (!backendDir) return null;

    // 2. Project venv via `uv run`.
    const uvArgs = [
      "run",
      "uvicorn",
      "app.gateway.app:app",
      "--host",
      GATEWAY_HOST,
      "--port",
      String(port),
    ];

    // Prefer `uv` on PATH, fall back to `~/.local/bin/uv`.
    const uvBin = process.env.UV_BIN ?? "uv";
    return { command: uvBin, args: uvArgs };
  }

  // ── Environment ───────────────────────────────────────────────────────

  /**
   * Build the isolated child-process environment.
   *
   * `KKOCLAW_HOME` points at the app's userData dir so desktop state never
   * collides with a local web deployment's `.kkoclaw`.
   *
   * `KKOCLAW_SKILLS_PATH` points at `<userData>/skills`, which is seeded with
   * bundled public skills on first run (see `initSkills`). Desktop does not
   * create or copy `custom` skills, so it starts as a clean terminal.
   *
   * `KKOCLAW_PROJECT_ROOT` is only set in development, where the repo source
   * tree exists. The packaged gateway bundles its own source via PyInstaller
   * and would raise `ValueError` if pointed at a non-existent project root
   * (see backend `runtime_paths.project_root()`).
   */
  private buildEnv(port: number): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Isolation: desktop state lives under userData, not the repo.
      KKOCLAW_HOME: getKkoclawHome(),
      KKOCLAW_DATA_DIR: join(getKkoclawHome(), "data"),
      // Desktop config is copied into userData on first run and never reads
      // the local web service's config.yaml.
      KKOCLAW_CONFIG_PATH: getDesktopConfigPath(),
      // Desktop extensions config starts empty so MCP/custom skill state never
      // leaks in from the web/repo extensions_config.json.
      KKOCLAW_EXTENSIONS_CONFIG_PATH: getDesktopExtensionsConfigPath(),
      // Skills root: bundled public skills copied here on first run.
      KKOCLAW_SKILLS_PATH: getSkillsDir(),
      // Ignore any stale userData/custom skills from older desktop builds.
      KKOCLAW_PUBLIC_SKILLS_ONLY: "1",
      // Desktop static export talks to the gateway from the app:// origin.
      GATEWAY_CORS_ORIGINS: "app://-",
      CORS_ORIGINS: "app://-",
      // Python backend writes its own rotating log files here too
      // (gateway.log + langgraph.log), so all backend logs are co-located
      // with the Electron-captured stdout logs under userData/logs.
      KKOCLAW_LOG_DIR: getLogsDir(),
      // Persisted JWT signing secret — prevents session invalidation on
      // every gateway restart. Without this, the gateway generates a new
      // ephemeral AUTH_JWT_SECRET on each launch and all existing tokens
      // become invalid (causing 401 on /api/models, /api/threads/search, etc).
      AUTH_JWT_SECRET: this.ensureAuthJwtSecret(),
      // Gateway binding.
      GATEWAY_HOST: GATEWAY_HOST,
      GATEWAY_PORT: String(port),
      GATEWAY_LOG_LEVEL: "debug",
      // Suppress Python output buffering so logs stream.
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    };

    // Only expose the repo source root in development. The packaged gateway
    // resolves its source from the PyInstaller bundle, and an invalid
    // project root would crash the backend on import.
    if (!isPackaged()) {
      env.KKOCLAW_PROJECT_ROOT = REPO_ROOT;
    }

    return env;
  }

  // ── Process IO & logging ──────────────────────────────────────────────

  private wireProcessIO(): void {
    const child = this.child;
    if (!child) return;

    const handleStream = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      let pending = "";
      stream.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        const lines = pending.split("\n");
        // Keep the last (possibly partial) line in the buffer.
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) this.appendLog(line);
        }
      });
    };

    handleStream(child.stdout);
    handleStream(child.stderr);
  }

  private appendLog(line: string): void {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    this.logs.push(stamped);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
    this.logStream?.write(stamped + "\n");
  }

  private openLogStream(): void {
    if (this.logStream) return;
    try {
      mkdirSync(getLogsDir(), { recursive: true });
      this.logStream = createWriteStream(getGatewayLogPath(), {
        flags: "a",
      });
    } catch (e) {
      console.error("[backend] failed to open log stream:", e);
    }
  }

  private async closeLogStream(): Promise<void> {
    const stream = this.logStream;
    if (!stream) return;
    this.logStream = null;
    await new Promise<void>((resolveFn) => {
      stream.end(resolveFn);
    });
  }

  // ── Health monitoring ─────────────────────────────────────────────────

  private startHealthMonitor(port: number): void {
    this.stopHealthMonitor();
    this.healthStartTime = Date.now();
    this.healthTimer = setInterval(() => {
      void this.healthTick(port);
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async healthTick(port: number): Promise<void> {
    const elapsed = (Date.now() - this.healthStartTime) / 1000;
    if (elapsed > HEALTH_CHECK_TIMEOUT_SECS) {
      this.stopHealthMonitor();
      const err = `Backend failed to start within ${HEALTH_CHECK_TIMEOUT_SECS}s`;
      this.appendLog(`[backend] ${err}`);
      this.setStatus({ status: "error", port, error: err });
      await this.killCurrent();
      return;
    }

    try {
      const ok = await this.checkHealth(port);
      if (ok && this.status.status === "starting") {
        this.appendLog("[backend] health check passed — gateway is up");
        this.stopHealthMonitor();
        this.setStatus({ status: "running", port });
      }
    } catch {
      // Not up yet — keep polling until timeout.
    }
  }

  /** Probe `http://127.0.0.1:<port>/health`. Resolves true if 2xx. */
  private checkHealth(port: number): Promise<boolean> {
    return new Promise((resolveFn) => {
      const url = `http://${GATEWAY_HOST}:${port}/health`;
      const req = fetch(url, { signal: AbortSignal.timeout(2000) })
        .then((r) => resolveFn(r.ok))
        .catch(() => resolveFn(false));
      void req;
    });
  }

  // ── Process teardown ──────────────────────────────────────────────────

  private async killCurrent(): Promise<void> {
    if (!this.child) return;
    await this.killProcess(this.child);
    this.child = null;
  }

  /** Kill a child process: graceful SIGTERM, then forceful SIGKILL. */
  private async killProcess(child: ChildProcess): Promise<void> {
    if (!child.pid) return;

    if (platform() === "win32") {
      // Windows: taskkill the process tree (SIGTERM isn't supported).
      try {
        const taskkill = spawn("taskkill", [
          "/pid",
          String(child.pid),
          "/f",
          "/t",
        ]);
        await new Promise<void>((resolveFn) => {
          const timeout = setTimeout(() => {
            taskkill.kill();
            resolveFn();
          }, 2000);

          taskkill.once("exit", () => {
            clearTimeout(timeout);
            resolveFn();
          });
          taskkill.once("error", () => {
            clearTimeout(timeout);
            resolveFn();
          });
        });
      } catch {
        /* ignore */
      }
      return;
    }

    // Unix: SIGTERM first, escalate to SIGKILL after a grace period.
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already dead */
    }

    await new Promise<void>((resolveFn) => {
      const grace = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolveFn();
      }, 500);

      child.once("exit", () => {
        clearTimeout(grace);
        resolveFn();
      });
    });
  }

  // ── Data dir bootstrap ────────────────────────────────────────────────

  private ensureDataDirs(): void {
    const home = getKkoclawHome();
    const subdirs = ["", "logs", "data", "threads", "agents"];
    for (const sub of subdirs) {
      const dir = join(home, sub);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private initConfig(): void {
    const configPath = getDesktopConfigPath();
    if (existsSync(configPath)) return;

    const templatePath = getBundledConfigTemplatePath();
    if (!templatePath) {
      this.appendLog("[backend] bundled config.embedded.yaml not found");
      return;
    }

    try {
      copyFileSync(templatePath, configPath);
      this.appendLog(`[backend] initialized desktop config at ${configPath}`);
    } catch (e) {
      this.appendLog(
        `[backend] failed to initialize desktop config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private migrateConfig(): void {
    const configPath = getDesktopConfigPath();
    if (!existsSync(configPath)) return;

    try {
      const original = readFileSync(configPath, "utf8");
      const migrated = migrateDesktopConfigYaml(original);
      if (migrated === original) return;

      writeFileSync(configPath, migrated, "utf8");
      this.appendLog("[backend] migrated desktop config defaults");
    } catch (e) {
      this.appendLog(
        `[backend] failed to migrate desktop config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private initExtensionsConfig(): void {
    const configPath = getDesktopExtensionsConfigPath();
    if (existsSync(configPath)) return;

    try {
      writeFileSync(
        configPath,
        `${JSON.stringify({ mcpServers: {}, skills: {} }, null, 2)}\n`,
        "utf8",
      );
      this.appendLog(`[backend] initialized desktop extensions config at ${configPath}`);
    } catch (e) {
      this.appendLog(
        `[backend] failed to initialize desktop extensions config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Load or create a persistent JWT signing secret.
   *
   * The secret is stored in ``<KKOCLAW_HOME>/.auth_jwt_secret`` and reused
   * across gateway restarts so that JWTs issued during a previous session
   * remain valid. If the file does not exist (first launch or after cache
   * clear), a new cryptographically random secret is generated and persisted.
   */
  private ensureAuthJwtSecret(): string {
    const secretPath = getAuthJwtSecretPath();

    // Try reading the existing secret.
    if (existsSync(secretPath)) {
      try {
        const existing = readFileSync(secretPath, "utf8").trim();
        if (existing.length >= 32) return existing;
      } catch {
        // Corrupt or unreadable — fall through to regenerate.
      }
    }

    // Generate a new secret and persist it.
    const secret = randomBytes(32).toString("base64url");
    try {
      mkdirSync(join(secretPath, ".."), { recursive: true });
      writeFileSync(secretPath, secret, "utf8");
      this.appendLog("[backend] generated and persisted AUTH_JWT_SECRET");
    } catch (e) {
      this.appendLog(
        `[backend] WARNING: failed to persist AUTH_JWT_SECRET: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return secret;
  }

  /**
   * Seed the user-writable skills directory from the bundled public skills.
   *
   * On first run, copies every bundled `public/<skill>` into
   * `<userData>/skills/public/`. On subsequent runs, syncs any new bundled
   * skills that are missing locally WITHOUT overwriting ones the user has
   * modified or deleted — matching the old Tauri `init_app_data()` behaviour.
   */
  private initSkills(): void {
    const bundled = getBundledSkillsDir();
    const skillsRoot = getSkillsDir();
    const publicTarget = join(skillsRoot, "public");

    // Desktop starts with bundled public skills only.
    mkdirSync(publicTarget, { recursive: true });

    if (!bundled) {
      this.appendLog("[backend] no bundled skills source found");
      return;
    }

    const bundledPublic = join(bundled, "public");
    if (!existsSync(bundledPublic)) {
      this.appendLog(`[backend] bundled skills/public not found at ${bundledPublic}`);
      return;
    }

    // Sync: copy each bundled skill that doesn't already exist locally.
    let copied = 0;
    const existing = existsSync(publicTarget)
      ? new Set(readdirSync(publicTarget))
      : new Set<string>();

    for (const name of readdirSync(bundledPublic)) {
      if (existing.has(name)) continue; // don't overwrite user's copy
      const src = join(bundledPublic, name);
      const dst = join(publicTarget, name);
      try {
        cpSync(src, dst, { recursive: true });
        copied++;
      } catch (e) {
        this.appendLog(
          `[backend] failed to copy skill '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (copied > 0) {
      this.appendLog(`[backend] synced ${copied} bundled public skill(s) to ${publicTarget}`);
    }
  }

  // ── Status ────────────────────────────────────────────────────────────

  private setStatus(next: BackendStatus): void {
    this.status = next;
    this.emit("status", this.getStatus());
  }
}

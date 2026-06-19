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

import { app, BrowserWindow, dialog } from "electron";
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
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  getAuthJwtSecretPath,
  getBackendDir,
  getBundledConfigTemplatePath,
  getBundledSkillsDir,
  getCodingHome,
  getDesktopConfigPath,
  getDesktopExtensionsConfigPath,
  getGatewayExecutable,
  getGatewayLogPath,
  getKkoclawHome,
  getLogsDir,
  getSkillsDir,
  getSkillModelsEnvPath,
  isPackaged,
  REPO_ROOT,
} from "./paths.js";
import { migrateDesktopConfigYaml } from "./config-migration.js";
import { detectMigrationSources } from "./migration.js";
import { initSkillModelsEnv, parseEnvFile } from "./skill-models-env.js";

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

    // Migrate legacy <userData>/.kkoclaw → ~/.kkoclaw-desktop before creating
    // the new home dirs. Runs at most once (guarded by a marker file).
    this.migrateLegacyUserData();

    this.ensureDataDirs();
    this.initConfig();
    this.migrateConfig();
    this.initExtensionsConfig();
    this.initSkillModelsEnv();
    this.initSkills();
    this.openLogStream();

    // First-launch detection: if this is a brand-new desktop install AND a
    // web deployment exists on the machine, notify the renderer so it can
    // prompt the user to import. Guarded by a marker so we only ask once.
    this.notifyMigrationIfAvailable();

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
   * `KKOCLAW_HOME` points at `~/.kkoclaw-desktop` so desktop state lives in
   * the user's home folder (discoverable + backup-friendly) and stays isolated
   * from a co-located web deployment's `~/.kkoclaw` / `<repo>/backend/.kkoclaw`.
   *
   * `KKOCLAW_CODING_HOME` points at `~/.oclaw-coding-desktop`, the Coding
   * Agent's dedicated scratch/session store (isolated from the web's
   * `~/.oclaw-coding`). The Python side reads this via `coding_core.paths`.
   *
   * `KKOCLAW_SKILLS_PATH` points at `~/.kkoclaw-desktop/skills`, seeded with
   * bundled `public/` skills on first run. The `custom/` directory is created
   * empty so users can author their own skills at runtime — we do NOT set
   * `KKOCLAW_PUBLIC_SKILLS_ONLY` because that flag was meant to skip stale
   * custom skills during *bundling*, not to forbid users from creating them.
   *
   * `KKOCLAW_PROJECT_ROOT` is only set in development, where the repo source
   * tree exists. The packaged gateway bundles its own source via PyInstaller
   * and would raise `ValueError` if pointed at a non-existent project root
   * (see backend `runtime_paths.project_root()`).
   */
  private buildEnv(port: number): NodeJS.ProcessEnv {
    // Skill model credentials (GEMINI_API_KEY, MINIMAX_API_KEY, …) parsed from
    // `<KKOCLAW_HOME>/.env`. These are the desktop equivalent of the web
    // deployment's repo-root `.env`; without them, image/video/music skills
    // abort with "No provider configured" / "*_API_KEY is not set".
    const skillModelVars = this.loadSkillModelsEnv();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...skillModelVars,
      // Isolation: desktop state lives under ~/.kkoclaw-desktop.
      KKOCLAW_HOME: getKkoclawHome(),
      KKOCLAW_DATA_DIR: join(getKkoclawHome(), "data"),
      // Coding Agent scratch/session store: ~/.oclaw-coding-desktop.
      KKOCLAW_CODING_HOME: getCodingHome(),
      // Desktop config is copied into the home dir on first run and never
      // reads the local web service's config.yaml.
      KKOCLAW_CONFIG_PATH: getDesktopConfigPath(),
      // Desktop extensions config starts empty so MCP/custom skill state never
      // leaks in from the web/repo extensions_config.json.
      KKOCLAW_EXTENSIONS_CONFIG_PATH: getDesktopExtensionsConfigPath(),
      // Skills root: bundled public skills + user-created custom skills.
      KKOCLAW_SKILLS_PATH: getSkillsDir(),
      // Desktop static export talks to the gateway from the app:// origin.
      GATEWAY_CORS_ORIGINS: "app://-",
      CORS_ORIGINS: "app://-",
      // Python backend writes its own rotating log files here too
      // (gateway.log + langgraph.log), so all backend logs are co-located
      // with the Electron-captured stdout logs under ~/.kkoclaw-desktop/logs.
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

  /**
   * One-time migration from the legacy `<userData>/.kkoclaw` layout to the
   * new `~/.kkoclaw-desktop` home.
   *
   * Triggered when the legacy dir exists AND the new home has not been
   * marked as migrated (`.migrated_v2` sentinel). Asks the user via a native
   * dialog; on accept, recursively copies the old home (and the old coding
   * home `~/.oclaw-coding` if present) into the new locations. On decline,
   * the new home starts empty and the old data is left untouched.
   *
   * Idempotent: the `.migrated_v2` marker is written on completion (accept or
   * decline) so the user is only prompted once per machine.
   */
  private migrateLegacyUserData(): void {
    const newHome = getKkoclawHome();
    const marker = join(newHome, ".migrated_v2");
    if (existsSync(marker)) return; // already handled on this machine

    const legacyHome = join(app.getPath("userData"), ".kkoclaw");
    if (!existsSync(legacyHome)) {
      // Nothing to migrate — write the marker so we never check again.
      try {
        mkdirSync(newHome, { recursive: true });
        writeFileSync(marker, "no-legacy\n", "utf8");
      } catch {
        // ignore — ensureDataDirs will create the home shortly
      }
      return;
    }

    const choice = dialog.showMessageBoxSync({
      type: "question",
      buttons: ["迁移旧数据", "从零开始", "稍后再问"],
      defaultId: 0,
      title: "检测到旧版本数据",
      message: "检测到旧版本的 OClaw 桌面端数据",
      detail:
        `旧数据位置：${legacyHome}\n` +
        `新位置：${newHome}\n\n` +
        "是否将旧数据（配置、会话、技能等）迁移到新位置？\n" +
        "选择「从零开始」将以空状态启动，旧数据保留但不再使用。",
    });

    if (choice === 2) {
      // "稍后再问" — don't write the marker, prompt again next launch
      return;
    }

    if (choice === 0) {
      // Migrate the main home: <userData>/.kkoclaw → ~/.kkoclaw-desktop
      try {
        mkdirSync(newHome, { recursive: true });
        cpSync(legacyHome, newHome, { recursive: true });
        this.appendLog(`[backend] migrated legacy data: ${legacyHome} → ${newHome}`);
      } catch (e) {
        this.appendLog(
          `[backend] WARNING: legacy data migration failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // The coding home historically lived at ~/.oclaw-coding (real home,
      // never under userData). Migrate it to ~/.oclaw-coding-desktop if present.
      const legacyCoding = join(homedir(), ".oclaw-coding");
      if (existsSync(legacyCoding)) {
        const newCodingHome = getCodingHome();
        try {
          mkdirSync(newCodingHome, { recursive: true });
          cpSync(legacyCoding, newCodingHome, { recursive: true });
          this.appendLog(
            `[backend] migrated legacy coding data: ${legacyCoding} → ${newCodingHome}`,
          );
        } catch (e) {
          this.appendLog(
            `[backend] WARNING: legacy coding data migration failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // Write marker (for both "migrate" and "start fresh" choices).
    try {
      mkdirSync(newHome, { recursive: true });
      writeFileSync(
        marker,
        choice === 0 ? "migrated\n" : "skipped\n",
        "utf8",
      );
    } catch {
      // Non-fatal — we'll just re-prompt next launch if the marker is missing.
    }
  }

  /**
   * Detect whether a web deployment's data exists and notify the renderer.
   *
   * Fires the one-shot `migration:available` IPC event to every BrowserWindow
   * so the renderer can show a prompt. Guarded by a `.migration_prompted`
   * marker so the user is only asked once per machine (matching the pattern
   * used by `migrateLegacyUserData`). The renderer is still free to open the
   * wizard manually from the settings panel afterwards.
   */
  private notifyMigrationIfAvailable(): void {
    const home = getKkoclawHome();
    const marker = join(home, ".migration_prompted");
    if (existsSync(marker)) return;

    const sources = detectMigrationSources(REPO_ROOT).filter(
      (s) => s.hasData,
    );
    if (sources.length === 0) {
      // Nothing to import — write the marker so we never scan again.
      try {
        mkdirSync(home, { recursive: true });
        writeFileSync(marker, "no-source\n", "utf8");
      } catch {
        // ignore
      }
      return;
    }

    // Defer the broadcast until the renderer is ready. The launch() call site
    // runs before any window necessarily exists, so we wait for the next tick
    // — windows created later still receive the event because we don't write
    // the marker until the broadcast actually happens.
    setImmediate(() => {
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("migration:available", sources);
        }
        // Mark as prompted so we don't keep firing on every relaunch.
        mkdirSync(home, { recursive: true });
        writeFileSync(marker, "prompted\n", "utf8");
        this.appendLog(
          `[backend] migration sources detected: ${sources.map((s) => s.path).join(", ")}`,
        );
      } catch (e) {
        this.appendLog(
          `[backend] WARNING: failed to notify migration: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  private ensureDataDirs(): void {
    const home = getKkoclawHome();
    const subdirs = ["", "logs", "data", "threads", "agents"];
    for (const sub of subdirs) {
      const dir = join(home, sub);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    // Coding Agent home must exist so its session/skill stores can write into
    // it on first use. Created here (not in Python) to match the pattern of
    // the main home dir above.
    const codingHome = getCodingHome();
    if (!existsSync(codingHome)) mkdirSync(codingHome, { recursive: true });
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
   * Seed the skill-model credentials `.env` on first run.
   *
   * Creates an empty template so the user can discover & edit it manually;
   * the Settings UI populates it via IPC. The gateway loads these vars in
   * `buildEnv()` below so skill scripts inherit them via `os.environ`.
   */
  private initSkillModelsEnv(): void {
    const envPath = getSkillModelsEnvPath();
    if (existsSync(envPath)) return;
    try {
      initSkillModelsEnv();
      this.appendLog(`[backend] initialized skill models env at ${envPath}`);
    } catch (e) {
      this.appendLog(
        `[backend] failed to initialize skill models env: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Parse the skill-model `.env` and return every key/value pair it defines.
   *
   * Used by `buildEnv()` to inject credentials into the gateway environment.
   * Missing or unreadable file yields an empty object (non-fatal).
   */
  private loadSkillModelsEnv(): Record<string, string> {
    const envPath = getSkillModelsEnvPath();
    if (!existsSync(envPath)) return {};
    try {
      return parseEnvFile(readFileSync(envPath, "utf8"));
    } catch (e) {
      this.appendLog(
        `[backend] failed to read skill models env: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {};
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

    // Desktop seeds bundled public skills AND creates an empty custom/ dir
    // so users can author their own skills at runtime. We intentionally do
    // NOT set KKOCLAW_PUBLIC_SKILLS_ONLY — that flag was for bundling-time,
    // not runtime. See plan: "修正 PUBLIC_SKILLS_ONLY 语义".
    mkdirSync(publicTarget, { recursive: true });
    mkdirSync(join(skillsRoot, "custom"), { recursive: true });

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

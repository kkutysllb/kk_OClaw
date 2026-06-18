/**
 * Development launcher for the Electron desktop shell.
 *
 * Boots three processes and wires them together:
 *   1. The Python gateway via `uv run uvicorn` (backend venv)
 *   2. The Next.js dev server on port 18659
 *   3. Electron, pointed at the dev server via OCLAW_DEV_SERVER=1
 *
 * Ctrl-C tears everything down cleanly.
 */

import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(DESKTOP_DIR, "..");
const FRONTEND_DIR = resolve(REPO_ROOT, "frontend");
const BACKEND_DIR = resolve(REPO_ROOT, "backend");
const EMBEDDED_CONFIG = resolve(
  REPO_ROOT,
  "desktop-electron",
  "backend-build",
  "config.embedded.yaml",
);

const GATEWAY_PORT = process.env.GATEWAY_PORT ?? "19987";
const DEV_SERVER_PORT = "18659";
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const FRONTEND_READY_TIMEOUT_MS = 60_000;
const DESKTOP_DEV_ORIGINS = [
  "app://-",
  `http://127.0.0.1:${DEV_SERVER_PORT}`,
  `http://localhost:${DEV_SERVER_PORT}`,
].join(",");

/** Track child processes so we can tear them down on exit. */
const children = [];
let shuttingDown = false;
let gatewayProcess = null;
let gatewayRestartTimer = null;
let migrateDesktopConfigYaml = null;

function start(cmd, args, opts = {}) {
  const { onExit, onStdout, onStderr, detached, ...spawnOpts } = opts;
  const child = spawn(cmd, args, {
    stdio: onStdout || onStderr ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    // POSIX: put each child in its own process group so teardown can kill the
    // entire group (including grandchildren spawned by pnpm exec / uv run)
    // with a single negative-PID signal. Without this, killing the direct
    // child leaves grandchildren as orphans still bound to ports (e.g. 19987)
    // or holding .next/dev/lock. Windows has no process groups, so disabled.
    detached: process.platform !== "win32" && detached !== false,
    ...spawnOpts,
  });
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (typeof onStdout === "function") {
        onStdout(String(chunk));
      }
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      if (typeof onStderr === "function") {
        onStderr(String(chunk));
      }
    });
  }
  children.push(child);
  child.on("exit", (code, signal) => {
    const childIndex = children.indexOf(child);
    if (childIndex >= 0) {
      children.splice(childIndex, 1);
    }
    if (!shuttingDown) {
      console.log(`[dev] ${cmd} exited (code=${code})`);
    }
    if (typeof onExit === "function") {
      onExit(code, signal);
    }
  });
  return child;
}

function scheduleGatewayRestart() {
  if (shuttingDown || gatewayRestartTimer) return;
  gatewayRestartTimer = setTimeout(() => {
    gatewayRestartTimer = null;
    if (!shuttingDown) {
      startGateway();
    }
  }, 1200);
}

function teardown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] shutting down...");
  if (gatewayRestartTimer) {
    clearTimeout(gatewayRestartTimer);
    gatewayRestartTimer = null;
  }
  for (const child of [...children].reverse()) {
    try {
      // Kill the entire process group (negative PID). Each child was started
      // with detached: true, so it is the leader of its own group; the signal
      // propagates to all descendants (e.g. pnpm exec → next dev → next-server,
      // or uv run → uvicorn), preventing the orphan-process port/lock leaks
      // we hit on plain Ctrl+C.
      process.kill(-child.pid, signal);
    } catch (e) {
      if (e && e.code === "EPERM") {
        // Different session (rare on macOS); fall back to PID-only kill.
        try { process.kill(child.pid, signal); } catch { /* already dead */ }
      }
      /* ESRCH or already dead — ignore */
    }
  }
  // Graceful exit: give children 5s to clean up (delete .next/dev/lock, close
  // webpack watcher, release ports, etc.). Next.js dev server needs 3-5s to
  // release its lockfile; anything shorter leaves a stale "Unable to acquire
  // lock" state on the next `pnpm run dev`. Escalate to SIGKILL for any
  // stubborn survivors after 3s.
  const forceKillTimer = setTimeout(() => {
    for (const child of [...children]) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
  }, 3000);
  setTimeout(() => {
    clearTimeout(forceKillTimer);
    process.exit(0);
  }, 5000);
}

function migrateDesktopConfigFile(configPath) {
  if (!configPath || !existsSync(configPath)) return;
  if (!migrateDesktopConfigYaml) {
    throw new Error("desktop config migration module was not loaded");
  }
  const original = readFileSync(configPath, "utf8");
  const migrated = migrateDesktopConfigYaml(original);
  if (migrated !== original) {
    writeFileSync(configPath, migrated, "utf8");
    console.log("[dev] migrated desktop config defaults");
  }
}

process.on("SIGINT", () => teardown("SIGINT"));
process.on("SIGTERM", () => teardown("SIGTERM"));

// ── 1. Gateway (venv) ────────────────────────────────────────────────────
// In dev mode the gateway is launched here (not via backend.ts), so this
// script must inject the SAME isolation env vars that backend.ts does in
// production: KKOCLAW_HOME, KKOCLAW_CONFIG_PATH, and KKOCLAW_SKILLS_PATH.
// Without these the gateway falls back to CWD-based paths and may reuse the
// web service's local config/state.
//
// Dev userData dir: Electron uses `app.getName()` which in dev equals the
// package.json "name" field (kkoclaw-desktop). Keep in sync with
// desktop-electron/package.json.
const USER_DATA_DIR =
  process.env.HOME &&
  join(process.env.HOME, "Library", "Application Support", "kkoclaw-desktop");

function initDesktopExtensionsConfig(configPath) {
  if (!configPath || existsSync(configPath)) return;
  writeFileSync(
    configPath,
    `${JSON.stringify({ mcpServers: {}, skills: {} }, null, 2)}\n`,
    "utf8",
  );
  console.log("[dev] initialized desktop extensions config");
}

function syncDesktopPublicSkills(skillsPath) {
  if (!skillsPath) return;
  const publicTarget = join(skillsPath, "public");
  mkdirSync(publicTarget, { recursive: true });

  const bundledPublic = join(REPO_ROOT, "skills", "public");
  if (!existsSync(bundledPublic)) {
    console.warn(`[dev] bundled skills/public not found at ${bundledPublic}`);
    return;
  }

  const existing = new Set(readdirSync(publicTarget));
  let copied = 0;
  for (const name of readdirSync(bundledPublic)) {
    if (existing.has(name)) continue;
    cpSync(join(bundledPublic, name), join(publicTarget, name), { recursive: true });
    copied++;
  }
  if (copied > 0) {
    console.log(`[dev] synced ${copied} public skill(s) to ${publicTarget}`);
  }
}

function startGateway() {
  if (!existsSync(BACKEND_DIR)) {
    console.warn(`[dev] backend dir not found: ${BACKEND_DIR} — skipping gateway`);
    return;
  }

  // Mirror backend.ts buildEnv(): isolated KKOCLAW_HOME, extensions config,
  // and public-only skills under Electron userData.
  const kkoclawHome = USER_DATA_DIR
    ? join(USER_DATA_DIR, ".kkoclaw")
    : undefined;
  const configPath = kkoclawHome ? join(kkoclawHome, "config.yaml") : undefined;
  const extensionsConfigPath = kkoclawHome ? join(kkoclawHome, "extensions_config.json") : undefined;
  const dataDir = kkoclawHome ? join(kkoclawHome, "data") : undefined;
  const skillsPath = USER_DATA_DIR ? join(USER_DATA_DIR, "skills") : undefined;

  // Ensure the isolated state dir exists (matches backend.ts ensureDataDirs).
  if (kkoclawHome) {
    for (const sub of ["", "logs", "data", "threads", "agents"]) {
      mkdirSync(join(kkoclawHome, sub), { recursive: true });
    }
    if (configPath && !existsSync(configPath) && existsSync(EMBEDDED_CONFIG)) {
      copyFileSync(EMBEDDED_CONFIG, configPath);
    }
    migrateDesktopConfigFile(configPath);
    initDesktopExtensionsConfig(extensionsConfigPath);
    syncDesktopPublicSkills(skillsPath);
  }

  console.log(`[dev] starting gateway on port ${GATEWAY_PORT}...`);
  console.log(`[dev]   KKOCLAW_HOME=${kkoclawHome}`);
  console.log(`[dev]   KKOCLAW_CONFIG_PATH=${configPath}`);
  console.log(`[dev]   KKOCLAW_EXTENSIONS_CONFIG_PATH=${extensionsConfigPath}`);
  console.log(`[dev]   KKOCLAW_DATA_DIR=${dataDir}`);
  console.log(`[dev]   KKOCLAW_SKILLS_PATH=${skillsPath}`);
  gatewayProcess = start("uv", ["run", "uvicorn", "app.gateway.app:app", "--host", "127.0.0.1", "--port", GATEWAY_PORT], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT,
      GATEWAY_CORS_ORIGINS: DESKTOP_DEV_ORIGINS,
      CORS_ORIGINS: DESKTOP_DEV_ORIGINS,
      KKOCLAW_DESKTOP_DEV: "1",
      PYTHONUNBUFFERED: "1",
      // Isolation: desktop state under userData, NOT the repo's backend/.kkoclaw.
      ...(kkoclawHome ? { KKOCLAW_HOME: kkoclawHome } : {}),
      ...(configPath ? { KKOCLAW_CONFIG_PATH: configPath } : {}),
      ...(extensionsConfigPath ? { KKOCLAW_EXTENSIONS_CONFIG_PATH: extensionsConfigPath } : {}),
      ...(dataDir ? { KKOCLAW_DATA_DIR: dataDir } : {}),
      ...(skillsPath ? { KKOCLAW_SKILLS_PATH: skillsPath } : {}),
      KKOCLAW_PUBLIC_SKILLS_ONLY: "1",
    },
    onExit: () => {
      gatewayProcess = null;
      scheduleGatewayRestart();
    },
  });
}

// ── 2. Next.js dev server ────────────────────────────────────────────────
// IMPORTANT: dev mode does NOT set DESKTOP_BUILD. That env var switches Next.js
// to `output: "export"` (static), which is incompatible with the SSR auth guard
// in app/workspace/layout.tsx (`export const dynamic = "force-dynamic"`).
// Static export is only used by `desktop-build.mjs` (which patches that layout).
//
// In dev we run the normal SSR dev server with rewrites proxying /api/* to the
// desktop gateway on 19987. Desktop detection (`isDesktop()`) still works
// because it checks `window.oclawDesktop` (injected by the preload), not the
// DESKTOP_BUILD env var. Cookie-based auth flows through the Next.js proxy,
// matching fetcher.ts's `port === "18659"` credentials branch.
let frontendReadyPromise = null;

function startFrontend() {
  console.log(`[dev] starting Next.js dev server on port ${DEV_SERVER_PORT}...`);
  let markReady;
  frontendReadyPromise = new Promise((resolve) => {
    markReady = resolve;
  });
  start(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", DEV_SERVER_PORT],
    {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        // Route Next.js rewrites (/api/*) to the desktop gateway, NOT the web
        // gateway. next.config.js reads this env var (default 9193).
        KKOCLAW_INTERNAL_GATEWAY_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
        // Force same-origin rewrites even when the shell has web/desktop build
        // public URL env vars loaded.
        NEXT_PUBLIC_BACKEND_BASE_URL: "",
        NEXT_PUBLIC_LANGGRAPH_BASE_URL: "",
        GATEWAY_PORT,
      },
      onStdout: (chunk) => {
        if (chunk.includes("Ready in")) {
          markReady();
        }
      },
      onStderr: (chunk) => {
        if (chunk.includes("Ready in")) {
          markReady();
        }
      },
    },
  );
  return frontendReadyPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFrontendReady() {
  if (!frontendReadyPromise) {
    throw new Error("Frontend dev server has not been started");
  }
  await Promise.race([
    frontendReadyPromise,
    sleep(FRONTEND_READY_TIMEOUT_MS).then(() => {
      throw new Error(`Next.js dev server did not become ready at ${DEV_SERVER_URL}`);
    }),
  ]);
}

// ── 3. Electron ──────────────────────────────────────────────────────────
function startElectron() {
  console.log(`[dev] starting Electron (loading ${DEV_SERVER_URL})...`);
  start(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "electron", "."],
    {
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        OCLAW_DEV_SERVER: "1",
        OCLAW_SKIP_BACKEND_AUTOLAUNCH: "1",
        GATEWAY_PORT,
      },
    },
  );
}

// ── Boot order: compile preload, then launch everything ───────────────────
async function main() {
  // Ensure the main/preload TS is compiled first.
  console.log("[dev] compiling main process...");
  try {
    spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["run", "build"],
      { cwd: DESKTOP_DIR, stdio: "inherit" },
    ).on("exit", (code) => {
      if (code !== 0) {
        console.error("[dev] TS build failed; aborting.");
        process.exit(1);
      }
      import("../dist/config-migration.js")
        .then(async (migrationModule) => {
          migrateDesktopConfigYaml = migrationModule.migrateDesktopConfigYaml;
          startGateway();
          startFrontend();
          await waitForFrontendReady();
          startElectron();
        })
        .catch((e) => {
          console.error("[dev] failed to start desktop dev environment:", e);
          process.exit(1);
        });
    });
  } catch (e) {
    console.error("[dev] failed to start:", e);
    process.exit(1);
  }
}

main();

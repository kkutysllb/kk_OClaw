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
  const { onExit, ...spawnOpts } = opts;
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...spawnOpts,
  });
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
      process.kill(child.pid, signal);
    } catch {
      /* already dead */
    }
  }
  setTimeout(() => process.exit(0), 1500);
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
function startFrontend() {
  console.log(`[dev] starting Next.js dev server on port ${DEV_SERVER_PORT}...`);
  start(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "next", "dev", "--port", DEV_SERVER_PORT],
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
    },
  );
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
        .then((migrationModule) => {
          migrateDesktopConfigYaml = migrationModule.migrateDesktopConfigYaml;
          startGateway();
          startFrontend();
          // Give the frontend a moment to bind before Electron loads it.
          setTimeout(startElectron, 4000);
        })
        .catch((e) => {
          console.error("[dev] failed to load config migration module:", e);
          process.exit(1);
        });
    });
  } catch (e) {
    console.error("[dev] failed to start:", e);
    process.exit(1);
  }
}

main();

/**
 * Path resolution for the Electron desktop shell.
 *
 * Handles the difference between development (running from source) and
 * packaged (ASAR / unpacked resources) layouts. All path computation is
 * centralized here so the rest of the main process never branches on
 * `app.isPackaged`.
 */

import { app } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The repo root when running in development.
 *
 * `app.getAppPath()` returns the directory containing `package.json`,
 * i.e. `desktop-electron/` itself. The repo root is one level above.
 *
 * (Previously this used `"..", ".."` which incorrectly pointed two
 * levels above the package dir — e.g. `kk_Projects/` instead of
 * `kk_OClaw/` — causing dev-mode icon/resource resolution to silently
 * fail because every candidate path was off by one directory.)
 */
const REPO_ROOT = resolve(app.getAppPath(), "..");

/** Whether we are running from a packaged app (not from source). */
export function isPackaged(): boolean {
  return app.isPackaged;
}

/**
 * The bundled Python gateway directory.
 *
 * - Packaged: `<resourcesPath>/gateway` (extraResources in electron-builder)
 * - Development: `<repo>/desktop-electron/resources/gateway` (if present),
 *   otherwise `null` (fall back to the venv launcher).
 */
export function getGatewayDir(): string | null {
  if (isPackaged()) {
    return join(process.resourcesPath, "gateway");
  }
  const devDir = join(REPO_ROOT, "desktop-electron", "resources", "gateway");
  return existsSync(devDir) ? devDir : null;
}

/**
 * The PyInstaller gateway executable path, or `null` if no bundle exists.
 *
 * On Windows the executable has an `.exe` suffix.
 */
export function getGatewayExecutable(): string | null {
  const dir = getGatewayDir();
  if (!dir) return null;
  const exe = process.platform === "win32" ? "oclaw-gateway.exe" : "oclaw-gateway";
  const path = join(dir, exe);
  return existsSync(path) ? path : null;
}

/**
 * The backend source directory (`backend/`).
 *
 * Used in development to locate the venv and the `app.gateway.app:app`
 * ASGI entrypoint. Returns `null` in packaged builds where there is no
 * source tree.
 */
export function getBackendDir(): string | null {
  if (isPackaged()) return null;
  return join(REPO_ROOT, "backend");
}

/**
 * The embedded-frontend directory served by `BrowserWindow.loadFile`.
 *
 * - Packaged: `<resourcesPath>/frontend-out` (shipped via electron-builder
 *   `extraResources`)
 * - Development: `frontend/out` in the repo (built by `desktop-build.mjs`)
 */
export function getFrontendDistDir(): string {
  if (isPackaged()) {
    return join(process.resourcesPath, "frontend-out");
  }
  return join(REPO_ROOT, "frontend", "out");
}

/**
 * The app's writable data directory.
 *
 * Desktop runs under `~/.kkoclaw-desktop` (NOT Electron's `userData` /
 * `~/Library/Application Support/...`) so the user can discover and back up
 * app state directly from their home folder. A `-desktop` suffix keeps it
 * isolated from a co-located web deployment (which uses `~/.kkoclaw` or
 * `<repo>/backend/.kkoclaw`). The legacy `userData` layout is migrated on
 * first run — see `migrateLegacyUserData` in backend.ts.
 */
export function getAppDataDir(): string {
  return join(homedir(), ".kkoclaw-desktop");
}

/**
 * The gateway state directory (`KKOCLAW_HOME`).
 *
 * On desktop this is the same as `getAppDataDir()` (`~/.kkoclaw-desktop`) —
 * config.yaml, data/, skills/ etc. all live directly under the home root,
 * without an extra `.kkoclaw` nesting level. This matches the plan's flat
 * layout and keeps paths short and user-discoverable.
 */
export function getKkoclawHome(): string {
  return getAppDataDir();
}

/**
 * The Coding Agent's dedicated home directory.
 *
 * Desktop uses `~/.oclaw-coding-desktop` (suffixed to stay isolated from the
 * web deployment's `~/.oclaw-coding`). This is injected into the gateway as
 * `KKOCLAW_CODING_HOME`; the Python side resolves it via
 * `coding_core.paths.coding_home()`.
 */
export function getCodingHome(): string {
  return join(homedir(), ".oclaw-coding-desktop");
}

/** The desktop-owned gateway config file. */
export function getDesktopConfigPath(): string {
  return join(getKkoclawHome(), "config.yaml");
}

/** The desktop-owned extensions config file for MCP and skill enablement state. */
export function getDesktopExtensionsConfigPath(): string {
  return join(getKkoclawHome(), "extensions_config.json");
}

/**
 * The desktop-owned `.env` file holding skill model credentials.
 *
 * Public skills such as image/video/music generation read provider
 * credentials from fixed environment variable names (e.g. `GEMINI_API_KEY`,
 * `MINIMAX_API_KEY`). The web deployment puts these in the repo-root `.env`,
 * but the desktop shell runs fully isolated under `userData` and never reads
 * that file. This path is the desktop equivalent: `backend.ts` parses it on
 * launch and injects every variable into the gateway child-process
 * environment so skill subprocesses inherit them via `os.environ`.
 */
export function getSkillModelsEnvPath(): string {
  return join(getKkoclawHome(), ".env");
}

/**
 * Path to the persisted JWT signing secret.
 *
 * The desktop gateway must use a STABLE secret across restarts — otherwise
 * every app relaunch generates a new ephemeral ``AUTH_JWT_SECRET`` and
 * invalidates all existing JWTs, causing 401s on every API call until the
 * user re-logs in.
 */
export function getAuthJwtSecretPath(): string {
  return join(getKkoclawHome(), ".auth_jwt_secret");
}

/** The logs directory for gateway stdout/stderr. */
export function getLogsDir(): string {
  return join(getAppDataDir(), "logs");
}

/** The gateway log file path. */
export function getGatewayLogPath(): string {
  return join(getLogsDir(), "gateway.log");
}

/** The Electron main-process log file path. */
export function getMainLogPath(): string {
  return join(getLogsDir(), "main.log");
}

/** The renderer-process console log file path. */
export function getRendererLogPath(): string {
  return join(getLogsDir(), "renderer.log");
}

/**
 * The user-writable skills root.
 *
 * `~/.kkoclaw-desktop/skills/` contains bundled `public/` skills (seeded on
 * first run) AND a writable `custom/` directory so users can create their own
 * skills at runtime. Bundling only ships `public/` (see `oclaw-gateway.spec`);
 * `custom/` starts empty and is managed by the user via the skills UI.
 */
export function getSkillsDir(): string {
  return join(getAppDataDir(), "skills");
}

/**
 * The persisted file remembering user-granted external paths.
 *
 * When an agent tries to read/write outside the default allowed roots
 * (`~/.kkoclaw-desktop`, `~/.oclaw-coding-desktop`, project roots, system
 * temp), the desktop shows a system authorization dialog. Accepted paths are
 * appended here so subsequent access is silent (prefix-matched). File mode is
 * 0600 — only the current user may read/modify the grant list.
 */
export function getGrantedPathsPath(): string {
  return join(getAppDataDir(), "granted_paths.json");
}

/**
 * The bundled skills source directory (read-only).
 *
 * - Packaged: PyInstaller ships skills under `resources/gateway/_internal/skills/`.
 *   The spec bundles `skills/public` into `skills/public` of the gateway dir,
 *   so the bundled root is `<resourcesPath>/gateway/_internal/skills` (oneDir).
 * - Development: the repo `skills/` directory.
 *
 * Returns `null` when no bundled source is present (e.g. dev without repo).
 */
export function getBundledSkillsDir(): string | null {
  if (isPackaged()) {
    // PyInstaller onedir layout: <gateway>/_internal/skills/public
    const gatewayDir = getGatewayDir();
    if (!gatewayDir) return null;
    const candidates = [
      join(gatewayDir, "_internal", "skills"),
      join(gatewayDir, "skills"),
    ];
    for (const c of candidates) {
      if (existsSync(join(c, "public"))) return c;
    }
    return null;
  }
  // Development: repo skills directory (contains public/ + custom/).
  const devSkills = join(REPO_ROOT, "skills");
  return existsSync(devSkills) ? devSkills : null;
}

/** The embedded desktop default config template, if bundled. */
export function getBundledConfigTemplatePath(): string | null {
  const candidates = isPackaged()
    ? [
        join(process.resourcesPath, "gateway", "_internal", "config.embedded.yaml"),
        join(process.resourcesPath, "gateway", "config.embedded.yaml"),
      ]
    : [
        join(REPO_ROOT, "desktop-electron", "backend-build", "config.embedded.yaml"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export { REPO_ROOT };

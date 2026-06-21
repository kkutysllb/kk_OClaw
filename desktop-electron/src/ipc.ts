/**
 * IPC handler registration.
 *
 * Wires the renderer-side `window.oclawDesktop.*` calls (forwarded by the
 * preload) to the `BackendManager` and native Electron APIs. The channel
 * names and payload shapes mirror the previous Tauri commands so the
 * frontend's desktop abstraction layer stays unchanged.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import pty from "node-pty";
import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { BackendManager, resolveGatewayPort, type BackendStatus } from "./backend.js";
import {
  readSkillModelsEnv,
  writeSkillModelsEnv,
  type SkillModelsConfig,
} from "./skill-models-env.js";
import { isAllowedExternalUrl } from "./url-policy.js";
import { getGrantedPathsPath, getKkoclawHome, REPO_ROOT } from "./paths.js";
import {
  detectMigrationSources as detectSources,
  executeMigration as runMigration,
  scanMigrationSources as scanSources,
} from "./migration.js";

// ── Granted paths (authorization memory) ─────────────────────────────────

interface GrantedPathEntry {
  path: string;
  granted_at: string;
  scope: string;
  thread_id?: string;
  granted_via: string;
}

interface GrantedPathsStore {
  granted_paths: GrantedPathEntry[];
}

async function readGrantedPaths(): Promise<GrantedPathsStore> {
  const file = getGrantedPathsPath();
  try {
    const raw = await readFile(file, "utf-8");
    const data = JSON.parse(raw) as GrantedPathsStore;
    if (!Array.isArray(data.granted_paths)) data.granted_paths = [];
    return data;
  } catch {
    return { granted_paths: [] };
  }
}

async function writeGrantedPaths(data: GrantedPathsStore): Promise<void> {
  const file = getGrantedPathsPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

/** Prefix-match: returns true if *path* (or a parent) is already granted. */
function isPathGranted(path: string, entries: GrantedPathEntry[]): boolean {
  for (const entry of entries) {
    const granted = entry.path;
    if (!granted) continue;
    if (path === granted || path.startsWith(granted + "/")) return true;
  }
  return false;
}

// ── Shared payload types (mirrors frontend `core/desktop/types.ts`) ───────

interface FileDialogOptions {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

interface PickedFile {
  name: string;
  data: Uint8Array;
  type?: string;
}

interface EmbeddedTerminalSession {
  sessionId: string;
  cwd: string;
  shell: string;
  projectName: string;
  promptLabel: string;
}

interface TerminalProcess {
  process: pty.IPty;
  owner: Electron.WebContents;
  cwd: string;
  shell: string;
}

/** Minimal MIME map for common upload extensions. */
const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".html": "text/html",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function guessMime(ext: string): string | undefined {
  return MIME_BY_EXT[ext.toLowerCase()];
}

const terminalProcesses = new Map<string, TerminalProcess>();

const DEFAULT_TERMINAL_PATH =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const POSIX_SHELL_CANDIDATES = [
  process.env.SHELL,
  "/bin/zsh",
  "/bin/bash",
  "/bin/sh",
].filter(Boolean) as string[];

function resolveEmbeddedShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe";
  }
  for (const candidate of POSIX_SHELL_CANDIDATES) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known-good shell path.
    }
  }
  return "/bin/sh";
}

/**
 * Make sure node-pty's bundled `spawn-helper` binary is executable before
 * we hand off to `pty.spawn`. On macOS / Linux, `node-pty` exec's that
 * helper via `posix_spawnp`, and a missing `+x` bit surfaces as the
 * unhelpful `posix_spawnp failed.` error.
 *
 * pnpm's content-addressable store does not always preserve the mode that
 * `node-pty`'s `install.js` set on its own copy, so we self-heal at
 * runtime. If the helper really doesn't exist (e.g. unsupported platform),
 * we silently no-op — `pty.spawn` will produce its own (still cryptic)
 * error, but we won't make things worse.
 *
 * Returns the resolved helper path when found, `null` otherwise.
 */
function ensureNodePtySpawnHelperExecutable(): string | null {
  if (process.platform === "win32") return null;

  // Resolve the bundled package root via the same module the renderer would
  // load — works whether the install is hoisted, pnpm-linked, or in a
  // workspace.
  let ptyPackageRoot: string;
  try {
    const req = createRequire(import.meta.url);
    const entry = req.resolve("node-pty");
    // .../node-pty/lib/index.js → .../node-pty
    ptyPackageRoot = dirname(dirname(entry));
  } catch {
    return null;
  }

  const helper = join(
    ptyPackageRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );

  try {
    accessSync(helper, constants.X_OK);
    return helper;
  } catch {
    // Either the file is missing or lacks +x. Try to repair.
  }

  try {
    chmodSync(helper, 0o755);
    accessSync(helper, constants.X_OK);
    console.warn(
      `[oclaw-desktop] Repaired node-pty spawn-helper permissions at ${helper}`,
    );
    return helper;
  } catch (error) {
    // Don't throw — let pty.spawn produce its own error, but log enough
    // context that the next person debugging doesn't have to rediscover
    // this. The error message intentionally names `posix_spawnp failed.`
    // so it's grep-friendly.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[oclaw-desktop] Could not chmod spawn-helper at ${helper}: ${message}. ` +
        `If "posix_spawnp failed." persists, run: chmod +x "${helper}"`,
    );
    return null;
  }
}

function resolveTerminalCwd(folderPath: string): string {
  try {
    const stat = statSync(folderPath);
    if (stat.isDirectory()) return folderPath;
  } catch {
    // Fall back below.
  }
  return process.env.HOME || process.cwd();
}

function buildTerminalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.PATH = env.PATH || DEFAULT_TERMINAL_PATH;
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  return env;
}

function buildTerminalPromptLabel(folderPath: string): string {
  const projectName = basename(folderPath) || folderPath;
  return projectName;
}

function stopTerminalProcess(sessionId: string): void {
  const terminal = terminalProcesses.get(sessionId);
  if (!terminal) return;
  terminalProcesses.delete(sessionId);
  terminal.process.kill();
}

function stopTerminalsForOwner(owner: Electron.WebContents): void {
  for (const [sessionId, terminal] of terminalProcesses.entries()) {
    if (terminal.owner === owner || owner.isDestroyed()) {
      stopTerminalProcess(sessionId);
    }
  }
}

function startEmbeddedTerminal(
  owner: Electron.WebContents,
  folderPath: string,
): EmbeddedTerminalSession {
  // Self-heal node-pty's spawn-helper permission BEFORE we try to spawn.
  // Cheap when already correct; avoids the cryptic "posix_spawnp failed."
  // when pnpm stripped the +x bit during install.
  ensureNodePtySpawnHelperExecutable();

  const shellPath = resolveEmbeddedShell();
  const cwd = resolveTerminalCwd(folderPath);
  const sessionId = randomUUID();
  let terminal: pty.IPty;
  try {
    terminal = pty.spawn(shellPath, [], {
      cols: 100,
      cwd,
      env: buildTerminalEnv(),
      name: "xterm-256color",
      rows: 28,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to start project terminal: ${message}. shell=${shellPath} cwd=${cwd}`,
    );
  }

  terminalProcesses.set(sessionId, {
    process: terminal,
    owner,
    cwd,
    shell: shellPath,
  });

  const sendData = (data: string): void => {
    if (owner.isDestroyed()) {
      stopTerminalProcess(sessionId);
      return;
    }
    owner.send("terminal:data", {
      sessionId,
      data,
    });
  };

  terminal.onData(sendData);
  terminal.onExit((event) => {
    terminalProcesses.delete(sessionId);
    if (!owner.isDestroyed()) {
      owner.send("terminal:exit", {
        sessionId,
        code: event.exitCode,
        signal: event.signal,
      });
    }
  });

  owner.once("destroyed", () => stopTerminalsForOwner(owner));

  return {
    sessionId,
    cwd,
    shell: shellPath,
    projectName: basename(cwd) || cwd,
    promptLabel: buildTerminalPromptLabel(cwd),
  };
}

/**
 * Register all backend-lifecycle and system-integration IPC handlers.
 *
 * Returns the shared `BackendManager` so the main process can drive it
 * (e.g. auto-launch on `app.whenReady`, stop on `before-quit`).
 */
export function registerIpc(): BackendManager {
  const manager = new BackendManager();

  // ── Backend lifecycle ──────────────────────────────────────────────
  ipcMain.handle("backend:get-status", (): BackendStatus =>
    manager.getStatus(),
  );
  ipcMain.handle("backend:start", async (): Promise<BackendStatus> =>
    manager.launch(),
  );
  ipcMain.handle("backend:stop", async (): Promise<BackendStatus> =>
    manager.stop(),
  );
  ipcMain.handle("backend:restart", async (): Promise<BackendStatus> =>
    manager.restart(),
  );
  ipcMain.handle("backend:get-logs", (): string[] => manager.getLogs());
  ipcMain.handle("backend:get-gateway-config", () => ({
    port: resolveGatewayPort(),
  }));

  // ── Native file dialog ──────────────────────────────────────────────
  ipcMain.handle(
    "dialog:pick-files",
    async (_evt, options: FileDialogOptions = {}): Promise<PickedFile[]> => {
      const win = BrowserWindow.fromWebContents(_evt.sender);
      const dialogOpts: Electron.OpenDialogOptions = {
        title: options.title ?? "Select file",
        filters: options.filters,
        properties: [options.multiple ? "multiSelections" : "openFile"],
      };
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);

      if (result.canceled || result.filePaths.length === 0) return [];

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const data = await readFile(filePath);
          const ext = extname(filePath);
          return {
            name: basename(filePath),
            data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            type: guessMime(ext),
          } satisfies PickedFile;
        }),
      );
      return files;
    },
  );

  // ── External links ──────────────────────────────────────────────────
  ipcMain.handle("shell:open-external", async (_evt, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error("Blocked external URL.");
    }
    await shell.openExternal(url);
  });

  // ── Open local folder in system file manager (Finder / Explorer) ───
  ipcMain.handle("shell:open-folder", async (_evt, folderPath: string) => {
    await shell.openPath(folderPath);
  });

  // ── Embedded project terminal ──────────────────────────────────────
  ipcMain.handle(
    "terminal:start",
    async (_evt, folderPath: string): Promise<EmbeddedTerminalSession> => {
      return startEmbeddedTerminal(_evt.sender, folderPath);
    },
  );
  ipcMain.handle(
    "terminal:write",
    async (_evt, sessionId: string, data: string): Promise<void> => {
      const terminal = terminalProcesses.get(sessionId);
      if (!terminal || terminal.owner !== _evt.sender) {
        throw new Error("Terminal session not found.");
      }
      terminal.process.write(data);
    },
  );
  ipcMain.handle(
    "terminal:resize",
    async (
      _evt,
      sessionId: string,
      cols: number,
      rows: number,
    ): Promise<void> => {
      const terminal = terminalProcesses.get(sessionId);
      if (!terminal || terminal.owner !== _evt.sender) {
        throw new Error("Terminal session not found.");
      }
      terminal.process.resize(cols, rows);
    },
  );
  ipcMain.handle("terminal:stop", async (_evt, sessionId: string): Promise<void> => {
    const terminal = terminalProcesses.get(sessionId);
    if (!terminal || terminal.owner !== _evt.sender) return;
    stopTerminalProcess(sessionId);
  });

  // ── Native directory picker (for Code Mode project selection) ───────
  ipcMain.handle(
    "dialog:pick-directory",
    async (_evt, options: { title?: string } = {}): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(_evt.sender);
      const dialogOpts: Electron.OpenDialogOptions = {
        title: options.title ?? "选择项目目录",
        properties: ["openDirectory"],
      };
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);

      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  // ── Skill model credentials (.env read/write) ───────────────────────
  // Returns the redacted snapshot of <KKOCLAW_HOME>/.env. Secrets are masked
  // so the renderer never receives raw API keys.
  ipcMain.handle(
    "skill-models:get",
    (): SkillModelsConfig => readSkillModelsEnv(),
  );

  // Merges updates into the .env. Secret fields whose incoming value is a
  // redaction placeholder (`***`-prefixed) are preserved verbatim so the
  // renderer can round-trip the redacted snapshot without losing keys.
  ipcMain.handle(
    "skill-models:set",
    (_evt, updates: Record<string, string>): SkillModelsConfig =>
      writeSkillModelsEnv(updates),
  );

  // ── Path authorization dialog ───────────────────────────────────────
  //
  // When the backend raises PathAuthorizationRequiredError (path outside the
  // default allowed roots), the frontend receives a `path_authorization_required`
  // SSE custom event and calls this handler. We show a system dialog, persist
  // the user's choice to granted_paths.json, and return the result.
  //
  // The Python backend polls granted_paths.json (always re-reading from disk,
  // no cache) so it picks up the grant within ~1 second of the user clicking
  // "Authorize".
  ipcMain.handle(
    "authorize-path",
    async (
      _evt,
      params: { path: string; agentType: string; threadId?: string },
    ): Promise<{ authorized: boolean }> => {
      const { path, agentType, threadId } = params;

      // 1. Check if already granted (skip the dialog)
      const store = await readGrantedPaths();
      if (isPathGranted(path, store.granted_paths)) {
        return { authorized: true };
      }

      // 2. Show system authorization dialog
      const win = BrowserWindow.fromWebContents(_evt.sender);
      const readWriteLabel = agentType === "coding" ? "读写" : "访问";
      const result = win
        ? await dialog.showMessageBox(win, {
            type: "question",
            buttons: ["授权访问", "拒绝"],
            defaultId: 0,
            cancelId: 1,
            title: "路径授权请求",
            message: `${agentType} agent 请求${readWriteLabel}以下路径：`,
            detail: `${path}\n\n授权后该路径及其子目录将被永久加入允许列表，后续访问不再弹窗。`,
          })
        : await dialog.showMessageBox({
            type: "question",
            buttons: ["授权访问", "拒绝"],
            defaultId: 0,
            cancelId: 1,
            title: "路径授权请求",
            message: `${agentType} agent 请求${readWriteLabel}以下路径：`,
            detail: `${path}\n\n授权后该路径及其子目录将被永久加入允许列表，后续访问不再弹窗。`,
          });

      // 3. Handle user choice
      if (result.response === 0) {
        // Authorized — persist to granted_paths.json
        store.granted_paths.push({
          path,
          granted_at: new Date().toISOString(),
          scope: agentType,
          thread_id: threadId,
          granted_via: "system_dialog",
        });
        await writeGrantedPaths(store);
        return { authorized: true };
      }

      // Denied
      return { authorized: false };
    },
  );

  // ── List / revoke granted paths (for settings UI) ───────────────────
  ipcMain.handle("granted-paths:list", async (): Promise<GrantedPathEntry[]> => {
    const store = await readGrantedPaths();
    return store.granted_paths;
  });

  ipcMain.handle(
    "granted-paths:revoke",
    async (_evt, path: string): Promise<boolean> => {
      const store = await readGrantedPaths();
      const before = store.granted_paths.length;
      store.granted_paths = store.granted_paths.filter(
        (e) => e.path !== path && !path.startsWith(e.path + "/"),
      );
      if (store.granted_paths.length === before) return false;
      await writeGrantedPaths(store);
      return true;
    },
  );

  // ── Web-to-desktop migration ────────────────────────────────────────────
  // The source is a web project repo root (NOT a user home). The web app
  // stores data in a scattered layout inside the repo.
  ipcMain.handle("migration:detect-sources", async () => {
    return detectSources(REPO_ROOT);
  });

  ipcMain.handle(
    "migration:scan",
    async (_evt, sourcePath?: string) => {
      const source = sourcePath && sourcePath.trim() ? sourcePath : REPO_ROOT;
      return scanSources(source);
    },
  );

  ipcMain.handle(
    "migration:execute",
    async (
      _evt,
      params: {
        sourceRepoRoot: string;
        options: import("./migration.js").MigrationOptions;
      },
    ) => {
      return runMigration(params.sourceRepoRoot, getKkoclawHome(), params.options);
    },
  );

  return manager;
}

/** Forward dropped-file paths from the window to the renderer. */
export async function forwardFileDrop(
  win: BrowserWindow,
  filePaths: string[],
): Promise<void> {
  const files: PickedFile[] = [];
  for (const filePath of filePaths) {
    try {
      const buf = await readFile(filePath);
      const ext = extname(filePath);
      files.push({
        name: basename(filePath),
        data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        type: guessMime(ext),
      });
    } catch {
      /* skip unreadable files */
    }
  }
  if (files.length > 0) {
    win.webContents.send("desktop:file-drop", files);
  }
}

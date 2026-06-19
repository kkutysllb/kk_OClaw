/**
 * IPC handler registration.
 *
 * Wires the renderer-side `window.oclawDesktop.*` calls (forwarded by the
 * preload) to the `BackendManager` and native Electron APIs. The channel
 * names and payload shapes mirror the previous Tauri commands so the
 * frontend's desktop abstraction layer stays unchanged.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

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

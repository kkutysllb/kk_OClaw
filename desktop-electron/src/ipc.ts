/**
 * IPC handler registration.
 *
 * Wires the renderer-side `window.oclawDesktop.*` calls (forwarded by the
 * preload) to the `BackendManager` and native Electron APIs. The channel
 * names and payload shapes mirror the previous Tauri commands so the
 * frontend's desktop abstraction layer stays unchanged.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { BackendManager, resolveGatewayPort, type BackendStatus } from "./backend.js";
import {
  readSkillModelsEnv,
  writeSkillModelsEnv,
  type SkillModelsConfig,
} from "./skill-models-env.js";
import { isAllowedExternalUrl } from "./url-policy.js";

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

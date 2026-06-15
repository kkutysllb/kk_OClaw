/**
 * Auto-update integration via `electron-updater`.
 *
 * In packaged builds this checks GitHub Releases (configured in
 * electron-builder.yml `publish`) for a newer version. In development the
 * updater is a no-op (it only runs against a real build signature).
 */

import { app, ipcMain } from "electron";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

/**
 * Register the update-check and install IPC handlers.
 *
 * `electron-updater` is imported lazily so the dev build doesn't require
 * the package to be configured — it only activates in a packaged app.
 */
export async function registerUpdater(): Promise<void> {
  let autoUpdater: import("electron-updater").AppUpdater | null = null;

  try {
    if (app.isPackaged) {
      const mod = await import("electron-updater");
      autoUpdater = mod.autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
    }
  } catch (e) {
    console.warn("[updater] electron-updater unavailable:", e);
  }

  ipcMain.handle("updater:check", async (): Promise<UpdateInfo> => {
    if (!autoUpdater) return { available: false };
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!info) return { available: false };
      const available = info.version !== app.getVersion();
      const releaseNotes = info.releaseNotes;
      return {
        available,
        version: info.version,
        date: info.releaseDate,
        body: typeof releaseNotes === "string"
          ? releaseNotes
          : Array.isArray(releaseNotes)
            ? releaseNotes
                .map((n) => (typeof n === "string" ? n : n.note))
                .join("\n")
            : undefined,
      };
    } catch (e) {
      console.warn("[updater] check failed:", e);
      return { available: false };
    }
  });

  ipcMain.handle("updater:install", async (): Promise<boolean> => {
    if (!autoUpdater) return false;
    try {
      await autoUpdater.downloadUpdate();
      await autoUpdater.quitAndInstall();
      return true;
    } catch (e) {
      console.warn("[updater] install failed:", e);
      return false;
    }
  });
}

/**
 * Auto-update integration via `electron-updater`.
 *
 * In packaged builds this checks GitHub Releases (configured in
 * electron-builder.yml `publish`) for a newer version. In development the
 * updater is a no-op (it only runs against a real build signature).
 *
 * ── Observability ─────────────────────────────────────────────────
 * All update checks, downloads, and errors are written to ``main.log``
 * via the shared ``log`` logger. ``electron-updater``'s internal logger
 * is also bridged so HTTP failures (rate limit / network / parse errors)
 * are visible in the log, not silently swallowed. Without this, a failed
 * check returns ``{ available: false }`` and the user just sees
 * "Already up-to-date" with no clue why.
 */

import { app, ipcMain } from "electron";

import { log } from "./logger.js";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

/**
 * Adapt our string-only ``log`` to electron-updater's Logger interface,
 * which passes arbitrary values (Error objects, arrays, etc.).
 */
function formatMsg(v: unknown): string {
  if (v instanceof Error) return `${v.message}${v.stack ? `\n${v.stack}` : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const updaterLogger = {
  info(m: unknown): void {
    log.info(`[updater] ${formatMsg(m)}`);
  },
  warn(m: unknown): void {
    log.warn(`[updater] ${formatMsg(m)}`);
  },
  error(m: unknown): void {
    log.error(`[updater] ${formatMsg(m)}`);
  },
  debug(m: unknown): void {
    log.debug(`[updater] ${formatMsg(m)}`);
  },
};

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
      // Bridge electron-updater's internal logs into our file logger so
      // HTTP / parse / rate-limit failures are visible in main.log.
      autoUpdater.logger = updaterLogger;
      // Surface every lifecycle event — these are the breadcrumbs needed
      // to diagnose "user clicks Check for Updates → no update found".
      autoUpdater.on("checking-for-update", () => {
        log.info("[updater] event: checking-for-update");
      });
      autoUpdater.on("update-available", (info) => {
        log.info(`[updater] event: update-available version=${info.version}`);
      });
      autoUpdater.on("update-not-available", (info) => {
        log.info(`[updater] event: update-not-available version=${info.version}`);
      });
      autoUpdater.on("error", (err) => {
        log.error(`[updater] event: error ${formatMsg(err)}`);
      });
      autoUpdater.on("download-progress", (p) => {
        log.info(
          `[updater] event: download-progress ${p.percent.toFixed(1)}% (${p.transferred}/${p.total})`,
        );
      });
      autoUpdater.on("update-downloaded", (info) => {
        log.info(`[updater] event: update-downloaded version=${info.version}`);
      });
      log.info(
        `[updater] initialized (currentVersion=${app.getVersion()})`,
      );
    } else {
      log.info("[updater] disabled in development (app.isPackaged=false)");
    }
  } catch (e) {
    log.error(`[updater] failed to initialize: ${formatMsg(e)}`);
  }

  ipcMain.handle("updater:check", async (): Promise<UpdateInfo> => {
    if (!autoUpdater) {
      log.info("[updater] check skipped: autoUpdater not initialized");
      return { available: false };
    }
    try {
      log.info(`[updater] check requested (currentVersion=${app.getVersion()})`);
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!info) {
        log.warn("[updater] check returned no updateInfo");
        return { available: false };
      }
      const available = info.version !== app.getVersion();
      log.info(
        `[updater] check result: latest=${info.version} current=${app.getVersion()} available=${available}`,
      );
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
      log.error(`[updater] check failed: ${formatMsg(e)}`);
      return { available: false };
    }
  });

  ipcMain.handle("updater:install", async (): Promise<boolean> => {
    if (!autoUpdater) {
      log.info("[updater] install skipped: autoUpdater not initialized");
      return false;
    }
    try {
      log.info("[updater] install requested — starting download");
      await autoUpdater.downloadUpdate();
      log.info("[updater] download complete, quitting and installing");
      await autoUpdater.quitAndInstall();
      return true;
    } catch (e) {
      log.error(`[updater] install failed: ${formatMsg(e)}`);
      return false;
    }
  });
}

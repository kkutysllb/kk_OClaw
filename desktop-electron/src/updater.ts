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
 * Resolve the ``autoUpdater`` instance from ``electron-updater``.
 *
 * electron-updater 6.x exposes ``autoUpdater`` via a lazy getter defined
 * with ``Object.defineProperty(exports, "autoUpdater", ...)``.  When the
 * main process is bundled into an ASAR archive, the ESM-style
 * ``await import("electron-updater")`` path can lose this non-standard
 * lazy getter, causing ``mod.autoUpdater`` to be ``undefined`` (observed
 * in v0.1.4 packaged builds, see main.log
 * ``Cannot set properties of undefined (setting 'autoDownload')``).
 *
 * We resolve it through several strategies, preferring ``require``
 * which preserves the original ``exports`` shape:
 *   1. CommonJS ``require("electron-updater").autoUpdater`` (lazy getter
 *      fires, instantiates the platform-specific updater)
 *   2. Dynamic ``import("electron-updater")`` then ``.autoUpdater``
 *      (fallback if ``require`` is unavailable, e.g. pure-ESM context)
 *   3. Manual platform-specific instantiation as a last resort
 */
function resolveAutoUpdater(): import("electron-updater").AppUpdater | null {
  type AutoUpdaterHolder =
    | { autoUpdater?: import("electron-updater").AppUpdater }
    | undefined;

  // Strategy 1: CommonJS require — preserves the lazy getter on exports.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron-updater") as AutoUpdaterHolder;
    if (mod?.autoUpdater) return mod.autoUpdater;
  } catch {
    /* fall through to next strategy */
  }

  // Strategy 2: dynamic import — works in dev (no ASAR) where the ESM
  // interop layer correctly maps the getter to a named export.
  // NOTE: we cannot await inside this sync helper; callers that reach
  // strategy 3 below handle the async path explicitly.

  return null;
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
      // Prefer synchronous require (preserves electron-updater's lazy
      // getter); fall back to dynamic import; finally instantiate
      // manually based on the current platform.
      autoUpdater = resolveAutoUpdater();

      if (!autoUpdater) {
        try {
          const mod = await import("electron-updater");
          autoUpdater = (mod as { autoUpdater?: import("electron-updater").AppUpdater }).autoUpdater ?? null;
        } catch (e) {
          log.warn(`[updater] dynamic import failed: ${formatMsg(e)}`);
        }
      }

      if (!autoUpdater) {
        // Last-resort manual instantiation by platform.
        try {
          const mod = await import("electron-updater");
          if (process.platform === "win32") {
            autoUpdater = new mod.NsisUpdater();
          } else if (process.platform === "darwin") {
            autoUpdater = new mod.MacUpdater();
          } else {
            autoUpdater = new mod.AppImageUpdater();
          }
          log.info(`[updater] instantiated ${autoUpdater.constructor.name} manually`);
        } catch (e) {
          log.error(`[updater] manual instantiation failed: ${formatMsg(e)}`);
        }
      }

      if (!autoUpdater) {
        log.error("[updater] could not resolve autoUpdater after all strategies");
      } else {
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
      }
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

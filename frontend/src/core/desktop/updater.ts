/**
 * Auto-updater utilities for the desktop app.
 *
 * Wraps the Electron `electron-updater` channels so the frontend can check
 * for and install application updates without importing any Electron code.
 */

import { isDesktop } from "../config";

import type { UpdateInfo } from "./types";

/** Check if an application update is available. */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.checkForUpdates();
  } catch (e) {
    console.warn("[desktop] checkForUpdates failed:", e);
    return null;
  }
}

/** Download and install the available update, then restart. */
export async function installUpdate(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return await window.oclawDesktop!.installUpdate();
  } catch (e) {
    console.warn("[desktop] installUpdate failed:", e);
    return false;
  }
}

/**
 * Subscribe to the "download started" push event.
 *
 * Fired when electron-updater finds a new version and begins the
 * background download (``autoDownload=true``). Use this for a non-blocking
 * toast only — do NOT show a modal here. The user will be prompted again
 * via ``onUpdateReady`` once the download finishes.
 */
export function onUpdateDownloading(
  handler: (info: { version: string; releaseDate?: string }) => void,
): () => void {
  if (!isDesktop()) return () => {};
  try {
    return window.oclawDesktop!.onUpdateDownloading(handler);
  } catch (e) {
    console.warn("[desktop] onUpdateDownloading subscribe failed:", e);
    return () => {};
  }
}

/**
 * Subscribe to the "update ready" push event.
 *
 * Fired when the background download has completed and the installer is
 * staged. This is the right place to show the "restart now to install"
 * prompt. If the user dismisses it, the update will still auto-install on
 * the next app quit.
 */
export function onUpdateReady(
  handler: (info: { version: string; releaseDate?: string }) => void,
): () => void {
  if (!isDesktop()) return () => {};
  try {
    return window.oclawDesktop!.onUpdateReady(handler);
  } catch (e) {
    console.warn("[desktop] onUpdateReady subscribe failed:", e);
    return () => {};
  }
}

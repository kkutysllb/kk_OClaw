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

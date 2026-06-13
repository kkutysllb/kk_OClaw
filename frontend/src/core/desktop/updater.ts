/**
 * Auto-updater utilities for the desktop app.
 *
 * Wraps the Tauri updater commands so the frontend can check for
 * and install application updates.
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../config";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

/** Check if an application update is available. */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<UpdateInfo>("check_for_updates");
  } catch (e) {
    console.warn("[desktop] checkForUpdates failed:", e);
    return null;
  }
}

/** Download and install the available update, then restart. */
export async function installUpdate(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    await invoke("install_update");
    return true;
  } catch (e) {
    console.warn("[desktop] installUpdate failed:", e);
    return false;
  }
}

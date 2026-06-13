/**
 * Desktop (Tauri) integration utilities.
 *
 * Provides a thin abstraction layer over Tauri APIs so the rest of the
 * frontend can import from a single location without worrying about
 * whether `window.__TAURI_INTERNALS__` exists.
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../config";

// ── Types ────────────────────────────────────────────────────────────────

export interface BackendStatus {
  status: "stopped" | "starting" | "running" | "error";
  port: number;
  error?: string;
}

// ── Backend management ───────────────────────────────────────────────────

/** Get the current backend status via Tauri IPC. */
export async function getBackendStatus(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<BackendStatus>("get_backend_status");
  } catch (e) {
    console.warn("[desktop] getBackendStatus failed:", e);
    return null;
  }
}

/** Start the backend process. */
export async function startBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<BackendStatus>("start_backend");
  } catch (e) {
    console.warn("[desktop] startBackend failed:", e);
    return null;
  }
}

/** Stop the backend process. */
export async function stopBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<BackendStatus>("stop_backend");
  } catch (e) {
    console.warn("[desktop] stopBackend failed:", e);
    return null;
  }
}

/** Restart the backend process. */
export async function restartBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<BackendStatus>("restart_backend");
  } catch (e) {
    console.warn("[desktop] restartBackend failed:", e);
    return null;
  }
}

/** Get recent backend log lines. */
export async function getBackendLogs(): Promise<string[]> {
  if (!isDesktop()) return [];
  try {
    return await invoke<string[]>("get_backend_logs");
  } catch (e) {
    console.warn("[desktop] getBackendLogs failed:", e);
    return [];
  }
}

// ── File dialog ──────────────────────────────────────────────────────────

export interface FileDialogOptions {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

/**
 * Open a native file dialog and return selected files as File objects.
 * Falls back to a hidden <input type="file"> when not in desktop mode.
 */
export async function openFilePicker(
  options: FileDialogOptions = {},
): Promise<File[]> {
  if (!isDesktop()) {
    return openBrowserFilePicker(options);
  }

  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");

    const selected = await open({
      multiple: options.multiple ?? false,
      filters: options.filters,
      title: options.title ?? "Select file",
    });

    if (!selected) return [];

    const paths = Array.isArray(selected) ? selected : [selected];

    const files = await Promise.all(
      paths.map(async (filePath) => {
        const data = await readFile(filePath);
        const name = filePath.split("/").pop() ?? "file";
        return new File([data], name);
      }),
    );

    return files;
  } catch (e) {
    console.warn(
      "[desktop] openFilePicker failed, falling back to browser:",
      e,
    );
    return openBrowserFilePicker(options);
  }
}

function openBrowserFilePicker(options: FileDialogOptions): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple ?? false;
    if (options.filters?.length) {
      input.accept = options.filters
        .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
        .join(",");
    }
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      resolve(files);
    };
    input.click();
  });
}

// ── System integration ───────────────────────────────────────────────────

/** Open a URL in the system's default browser. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, "_blank");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

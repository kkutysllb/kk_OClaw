/**
 * Desktop (Electron) integration utilities.
 *
 * Provides a thin abstraction layer over the Electron preload bridge so the
 * rest of the frontend can import from a single location without worrying
 * about whether `window.oclawDesktop` exists.
 *
 * Every function has a browser fallback (no-op / native browser behaviour)
 * so the same code path runs unchanged in the web build.
 */

import { isDesktop } from "../config";

export type {
  BackendStatus,
  BackendStatusKind,
  EmbeddedTerminalSession,
  EnvCheckInfo,
  EnvVarInfo,
  FileDialogOptions,
  GatewayConfig,
  PickedFile,
  ServiceStateInfo,
  StartupDiagnostics,
  UpdateInfo,
} from "./types";

import type {
  BackendStatus,
  EmbeddedTerminalSession,
  FileDialogOptions,
  PickedFile,
  StartupDiagnostics,
} from "./types";

export type OpenProjectTerminalResult = "opened" | "copied" | "failed";

// ── Backend management ───────────────────────────────────────────────────

/** Get the current backend status via Electron IPC. */
export async function getBackendStatus(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.getBackendStatus();
  } catch (e) {
    console.warn("[desktop] getBackendStatus failed:", e);
    return null;
  }
}

/** Start the backend process. */
export async function startBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.startBackend();
  } catch (e) {
    console.warn("[desktop] startBackend failed:", e);
    return null;
  }
}

/** Stop the backend process. */
export async function stopBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.stopBackend();
  } catch (e) {
    console.warn("[desktop] stopBackend failed:", e);
    return null;
  }
}

/** Restart the backend process. */
export async function restartBackend(): Promise<BackendStatus | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.restartBackend();
  } catch (e) {
    console.warn("[desktop] restartBackend failed:", e);
    return null;
  }
}

/** Get recent backend log lines. */
export async function getBackendLogs(): Promise<string[]> {
  if (!isDesktop()) return [];
  try {
    return await window.oclawDesktop!.getBackendLogs();
  } catch (e) {
    console.warn("[desktop] getBackendLogs failed:", e);
    return [];
  }
}

// ── Startup diagnostics ──────────────────────────────────────────────────

/** Get full startup diagnostics for the splash panel (services + env check). */
export async function getStartupInfo(): Promise<StartupDiagnostics | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.getStartupInfo();
  } catch (e) {
    console.warn("[desktop] getStartupInfo failed:", e);
    return null;
  }
}

// ── File dialog ──────────────────────────────────────────────────────────

/**
 * Open a native file dialog and return selected files as File objects.
 * Falls back to a hidden `<input type="file">` when not in desktop mode.
 */
export async function openFilePicker(
  options: FileDialogOptions = {},
): Promise<File[]> {
  if (!isDesktop()) {
    return openBrowserFilePicker(options);
  }

  try {
    const picked: PickedFile[] =
      await window.oclawDesktop!.pickFiles(options);
    return picked.map((p) => {
      // Copy into a fresh ArrayBuffer-backed buffer so TS accepts it as a
      // BlobPart (the IPC bridge may hand back a SharedArrayBuffer-backed view).
      const buf = new Uint8Array(p.data).slice();
      const blob = new Blob([buf], { type: p.type });
      return new File([blob], p.name, { type: p.type });
    });
  } catch (e) {
    console.warn(
      "[desktop] openFilePicker failed, falling back to browser:",
      e,
    );
    return openBrowserFilePicker(options);
  }
}

function openBrowserFilePicker(
  options: FileDialogOptions,
): Promise<File[]> {
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

// ── Directory picker (Code Mode project selection) ──────────────────────

/**
 * Open a native directory picker and return the selected folder path.
 * Returns null if the user cancels or in browser mode (no native picker).
 */
export async function pickDirectory(
  options: { title?: string } = {},
): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    return await window.oclawDesktop!.pickDirectory(options);
  } catch (e) {
    console.warn("[desktop] pickDirectory failed:", e);
    return null;
  }
}

// ── Open folder in system file manager ──────────────────────────────

/**
 * Open a local folder in the system file manager (Finder / Explorer).
 * Falls back to copying the path to clipboard in browser mode.
 */
export async function openFolder(folderPath: string): Promise<void> {
  if (!isDesktop()) {
    // Browser fallback: copy path to clipboard
    try {
      await navigator.clipboard.writeText(folderPath);
    } catch {
      // Clipboard may be unavailable
    }
    return;
  }
  try {
    await window.oclawDesktop!.openFolder(folderPath);
  } catch (e) {
    console.warn("[desktop] openFolder failed:", e);
  }
}

/** Open the embedded project terminal in desktop mode, or copy path on web. */
export async function openProjectTerminal(
  folderPath: string,
): Promise<OpenProjectTerminalResult> {
  if (!folderPath.trim()) return "failed";

  if (!isDesktop()) {
    try {
      await navigator.clipboard.writeText(folderPath);
      return "copied";
    } catch (e) {
      console.warn("[web] copy project path failed:", e);
      return "failed";
    }
  }

  return "opened";
}

export async function startEmbeddedTerminal(
  folderPath: string,
): Promise<EmbeddedTerminalSession | null> {
  if (!folderPath.trim() || !isDesktop()) return null;
  try {
    return await window.oclawDesktop!.startTerminal(folderPath);
  } catch (e) {
    console.warn("[desktop] startTerminal failed:", e);
    return null;
  }
}

export async function writeEmbeddedTerminal(
  sessionId: string,
  data: string,
): Promise<boolean> {
  if (!sessionId || !isDesktop()) return false;
  try {
    await window.oclawDesktop!.writeTerminal(sessionId, data);
    return true;
  } catch (e) {
    console.warn("[desktop] writeTerminal failed:", e);
    return false;
  }
}

export async function resizeEmbeddedTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  if (!sessionId || !isDesktop()) return false;
  try {
    await window.oclawDesktop!.resizeTerminal(sessionId, cols, rows);
    return true;
  } catch (e) {
    console.warn("[desktop] resizeTerminal failed:", e);
    return false;
  }
}

export async function stopEmbeddedTerminal(
  sessionId: string,
): Promise<void> {
  if (!sessionId || !isDesktop()) return;
  try {
    await window.oclawDesktop!.stopTerminal(sessionId);
  } catch (e) {
    console.warn("[desktop] stopTerminal failed:", e);
  }
}

export function onEmbeddedTerminalData(
  handler: (event: { sessionId: string; data: string }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.oclawDesktop!.onTerminalData(handler);
}

export function onEmbeddedTerminalExit(
  handler: (event: {
    sessionId: string;
    code: number | null;
    signal: string | null;
  }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.oclawDesktop!.onTerminalExit(handler);
}

export async function copyProjectTerminalPath(folderPath: string): Promise<OpenProjectTerminalResult> {
  try {
    await navigator.clipboard.writeText(folderPath);
    return "copied";
  } catch (e) {
    console.warn("[web] copy project path failed:", e);
    return "failed";
  }
}

// Re-export system-integration helpers kept in dedicated modules.
export { openExternalUrl } from "./external-links";
export { initDragDrop, onDesktopFileDrop } from "./dnd";

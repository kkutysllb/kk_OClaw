/**
 * Native drag-and-drop file handling for the desktop app.
 *
 * In Electron, OS file drops arrive as standard HTML5 drag/drop events on the
 * renderer (the main process prevents the default file-navigation via
 * `will-navigate`). This module listens for those events, converts the
 * dropped files into `File` objects, and re-dispatches them as a custom DOM
 * event so existing UI components can react without duplicating the wiring.
 *
 * The custom-event API (`DESKTOP_DROP_EVENT` / `onDesktopFileDrop`) is kept
 * identical to the previous bridge-based implementation.
 */

import { isDesktop } from "../config";

export const DESKTOP_DROP_EVENT = "oclaw:desktop-file-drop";

export interface DroppedFilesDetail {
  files: File[];
}

let initialized = false;

/**
 * Start listening for OS file-drop events on the current window.
 *
 * Safe to call multiple times — only the first call registers the listener.
 * Returns a cleanup function that removes the handlers.
 */
export async function initDragDrop(): Promise<() => void> {
  if (!isDesktop() || typeof window === "undefined") {
    return () => {};
  }
  if (initialized) {
    return () => {};
  }

  // Prevent the browser default (which would navigate to the dropped file).
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
    }
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    window.dispatchEvent(
      new CustomEvent(DESKTOP_DROP_EVENT, {
        detail: { files } satisfies DroppedFilesDetail,
      }),
    );
  };

  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  initialized = true;

  return () => {
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
    initialized = false;
  };
}

/**
 * Subscribe to desktop file-drop events.
 *
 * Returns an unsubscribe function. The handler receives an array of File
 * objects each time files are dropped onto the window.
 */
export function onDesktopFileDrop(
  handler: (files: File[]) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<DroppedFilesDetail>).detail;
    if (detail?.files?.length) {
      handler(detail.files);
    }
  };

  window.addEventListener(DESKTOP_DROP_EVENT, listener);
  return () => window.removeEventListener(DESKTOP_DROP_EVENT, listener);
}

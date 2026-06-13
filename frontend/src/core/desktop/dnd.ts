/**
 * Native drag-and-drop file handling for the desktop app.
 *
 * Tauri emits `tauri://drag-drop` events when files are dragged onto the
 * window. This module listens for those events and converts the dropped
 * paths into File objects, then dispatches a custom DOM event so existing
 * UI components can react without coupling directly to Tauri.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { isDesktop } from "../config";

export const DESKTOP_DROP_EVENT = "oclaw:desktop-file-drop";

export interface DroppedFilesDetail {
  files: File[];
}

let initialized = false;
let unlisten: UnlistenFn | null = null;

/**
 * Start listening for native drag-drop events.
 *
 * Safe to call multiple times — only the first call registers the listener.
 * Should be called from a top-level client component on mount.
 */
export async function initDragDrop(): Promise<() => void> {
  if (!isDesktop()) {
    return () => {};
  }

  if (initialized && unlisten) {
    return () => {
      unlisten?.();
      unlisten = null;
      initialized = false;
    };
  }

  try {
    unlisten = await listen<{ paths: string[] }>(
      "tauri://file-drop",
      async (event) => {
        const paths = event.payload?.paths ?? [];
        if (paths.length === 0) return;

        const files = await Promise.all(
          paths.map(async (filePath) => {
            const data = await readFile(filePath);
            const name = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? "file";
            return new File([data], name);
          }),
        );

        window.dispatchEvent(
          new CustomEvent(DESKTOP_DROP_EVENT, {
            detail: { files } satisfies DroppedFilesDetail,
          }),
        );
      },
    );
    initialized = true;
  } catch (e) {
    console.warn("[desktop] initDragDrop failed:", e);
  }

  return () => {
    unlisten?.();
    unlisten = null;
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

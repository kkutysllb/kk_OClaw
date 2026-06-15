/**
 * Type definitions for the Electron desktop bridge.
 *
 * The Electron preload script exposes a `window.oclawDesktop` object via
 * `contextBridge`. This module declares both that global and the shared
 * shapes exchanged across the IPC boundary, so the renderer can consume
 * them with full type-safety without importing any Electron code.
 */

export type BackendStatusKind =
  | "stopped"
  | "starting"
  | "running"
  | "error";

export interface BackendStatus {
  status: BackendStatusKind;
  port: number;
  error?: string;
}

export interface GatewayConfig {
  port: number;
}

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

export interface FileDialogOptions {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface PickedFile {
  /** Base name of the file, e.g. `notes.md`. */
  name: string;
  /** Raw bytes of the file content. */
  data: Uint8Array;
  /** Best-effort MIME type guessed from the extension. */
  type?: string;
}

/**
 * The bridge exposed on `window.oclawDesktop` by the Electron preload.
 *
 * Every member maps 1:1 to an `ipcMain.handle` channel (or a native call)
 * implemented in `desktop-electron/preload.ts`.
 */
export interface DesktopBridge {
  /** Gateway port the embedded backend listens on. */
  gatewayPort: number;

  // ── Backend lifecycle ──────────────────────────────────────────────
  getGatewayConfig(): Promise<GatewayConfig>;
  getBackendStatus(): Promise<BackendStatus>;
  startBackend(): Promise<BackendStatus>;
  stopBackend(): Promise<BackendStatus>;
  restartBackend(): Promise<BackendStatus>;
  getBackendLogs(): Promise<string[]>;

  // ── Native file dialog ────────────────────────────────────────────
  pickFiles(options?: FileDialogOptions): Promise<PickedFile[]>;

  // ── System integration ────────────────────────────────────────────
  openExternal(url: string): Promise<void>;
  onFileDrop(
    handler: (files: PickedFile[]) => void,
  ): () => void;

  // ── Auto-update ───────────────────────────────────────────────────
  checkForUpdates(): Promise<UpdateInfo>;
  installUpdate(): Promise<boolean>;
}

declare global {
  interface Window {
    oclawDesktop?: DesktopBridge;
  }
}

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

/** Live status of a single managed service (mirrors Rust `ServiceState`). */
export interface ServiceStateInfo {
  name: string;
  status: BackendStatusKind;
  port: number;
  pid?: number;
  error?: string | null;
}

/** High-level environment check surfaced to the startup splash panel. */
export interface EnvCheckInfo {
  repo_root: string;
  env_file: string;
  env_file_exists: boolean;
  gateway_port: number;
  frontend_port: number;
  uv_binary: string;
  uv_binary_exists: boolean;
  is_dev: boolean;
}

/** A single environment variable loaded from `.env` (secrets redacted). */
export interface EnvVarInfo {
  key: string;
  value: string;
  source: string;
}

/** Aggregated diagnostics polled by the startup splash panel. */
export interface StartupDiagnostics {
  services: ServiceStateInfo[];
  env_check: EnvCheckInfo;
  env_vars: EnvVarInfo[];
}

export interface PickedFile {
  /** Base name of the file, e.g. `notes.md`. */
  name: string;
  /** Raw bytes of the file content. */
  data: Uint8Array;
  /** Best-effort MIME type guessed from the extension. */
  type?: string;
}

// ── Skill model credentials (mirrors skill-models-env.ts) ───────────────

export interface SkillModelField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface SkillModelProvider {
  id: string;
  category: "image" | "av";
  title: string;
  description: string;
  /** Provider-name substrings used for smart-import from dialog models. */
  matchKeywords: string[];
  fields: SkillModelField[];
}

export interface SkillModelVar {
  key: string;
  /** Redacted value for UI display. Secrets show `***` + last 4 chars. */
  value: string;
  configured: boolean;
  isSecret: boolean;
}

export interface SkillModelsConfig {
  providers: SkillModelProvider[];
  vars: SkillModelVar[];
  filePath: string;
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
  /**
   * Frontend dev-server port (only set in Electron dev-mode shells so the
   * renderer can detect dev mode port-independently). Absent on packaged
   * shells where the frontend is served from `app://-` with no port.
   */
  frontendPort?: number;

  // ── Backend lifecycle ──────────────────────────────────────────────
  getGatewayConfig(): Promise<GatewayConfig>;
  getBackendStatus(): Promise<BackendStatus>;
  startBackend(): Promise<BackendStatus>;
  stopBackend(): Promise<BackendStatus>;
  restartBackend(): Promise<BackendStatus>;
  getBackendLogs(): Promise<string[]>;

  // ── Startup diagnostics ─────────────────────────────────────────────
  getStartupInfo(): Promise<StartupDiagnostics>;

  // ── Native file dialog ────────────────────────────────────────────
  pickFiles(options?: FileDialogOptions): Promise<PickedFile[]>;
  pickDirectory(options?: { title?: string }): Promise<string | null>;

  // ── System integration ────────────────────────────────────────────
  openExternal(url: string): Promise<void>;
  openFolder(folderPath: string): Promise<void>;
  onFileDrop(
    handler: (files: PickedFile[]) => void,
  ): () => void;

  // ── Auto-update ───────────────────────────────────────────────────
  checkForUpdates(): Promise<UpdateInfo>;
  installUpdate(): Promise<boolean>;

  // ── Skill model credentials ────────────────────────────────────────
  /** Read the redacted skill-model `.env` snapshot. */
  getSkillModels(): Promise<SkillModelsConfig>;
  /** Merge updates into the `.env` (redaction placeholders are preserved). */
  setSkillModels(updates: Record<string, string>): Promise<SkillModelsConfig>;
}

declare global {
  interface Window {
    oclawDesktop?: DesktopBridge;
  }
}

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

export interface EmbeddedTerminalSession {
  sessionId: string;
  cwd: string;
  shell: string;
  projectName: string;
  promptLabel: string;
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

// ── Path authorization ───────────────────────────────────────────────────

/** Result of a path authorization dialog. */
export interface AuthorizePathResult {
  authorized: boolean;
}

/** A single user-granted path entry (mirrors Electron `GrantedPathEntry`). */
export interface GrantedPathEntry {
  path: string;
  granted_at: string;
  scope: string;
  thread_id?: string;
  granted_via: string;
}

// ── Web-to-desktop migration ──────────────────────────────────────────────

export type MigrationCategory =
  | "skills"
  | "extensions"
  | "credentials"
  | "memory"
  | "agents";

export interface MigrationOptions {
  skills: boolean;
  extensions: boolean;
  credentials: boolean;
  memory: boolean;
  agents: boolean;
}

export interface MigrationSourceCategory {
  available: boolean;
  count: number;
  description: string;
  paths: string[];
}

export interface MigrationScanResult {
  sourceRepoRoot: string;
  categories: {
    skills: MigrationSourceCategory;
    extensions: MigrationSourceCategory;
    credentials: MigrationSourceCategory;
    memory: MigrationSourceCategory;
    agents: MigrationSourceCategory;
  };
}

export interface MigrationCategoryResult {
  category: MigrationCategory;
  copied: number;
  skipped: number;
  merged: number;
  error?: string;
}

export interface MigrationResult {
  success: boolean;
  results: MigrationCategoryResult[];
  targetHome: string;
}

export interface DetectedSource {
  path: string;
  label: string;
  exists: boolean;
  hasData: boolean;
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
  startTerminal(folderPath: string): Promise<EmbeddedTerminalSession>;
  writeTerminal(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  stopTerminal(sessionId: string): Promise<void>;
  onTerminalData(
    handler: (event: { sessionId: string; data: string }) => void,
  ): () => void;
  onTerminalExit(
    handler: (event: {
      sessionId: string;
      code: number | null;
      signal: string | null;
    }) => void,
  ): () => void;
  onFileDrop(
    handler: (files: PickedFile[]) => void,
  ): () => void;

  // ── Auto-update ───────────────────────────────────────────────────
  /** Check if an application update is available on GitHub Releases. */
  checkForUpdates(): Promise<UpdateInfo>;
  /** Download and install the available update, then restart. */
  installUpdate(): Promise<boolean>;
  /**
   * Subscribe to the "Check for Updates" menu-item click. Returns an
   * unsubscribe function. The renderer should call `checkForUpdates()`
   * when the handler fires and surface the result to the user.
   */
  onCheckUpdateRequest(handler: () => void): () => void;
  /**
   * Push event: a new version was found and the background download has
   * started. The renderer should NOT block the user here — the real
   * prompt comes via ``onUpdateReady`` once the download finishes.
   * Optional UI: show a non-blocking toast.
   */
  onUpdateDownloading(
    handler: (info: { version: string; releaseDate?: string }) => void,
  ): () => void;
  /**
   * Push event: the update has been downloaded and staged. This is the
   * user-facing notification point — the renderer should show the
   * "restart now to install" prompt. If dismissed, the update will
   * auto-install on next app quit (``autoInstallOnAppQuit=true``).
   */
  onUpdateReady(
    handler: (info: { version: string; releaseDate?: string }) => void,
  ): () => void;

  // ── Skill model credentials ────────────────────────────────────────
  /** Read the redacted skill-model `.env` snapshot. */
  getSkillModels(): Promise<SkillModelsConfig>;
  /** Merge updates into the `.env` (redaction placeholders are preserved). */
  setSkillModels(updates: Record<string, string>): Promise<SkillModelsConfig>;

  // ── Path authorization ─────────────────────────────────────────────
  /** Show system dialog to authorize an external path. */
  authorizePath(params: {
    path: string;
    agentType: string;
    threadId?: string;
  }): Promise<AuthorizePathResult>;
  /** List all user-granted paths (for settings UI). */
  listGrantedPaths(): Promise<GrantedPathEntry[]>;
  /** Revoke a previously granted path. */
  revokeGrantedPath(path: string): Promise<boolean>;

  // ── Web-to-desktop migration ─────────────────────────────────────────
  /** Detect web-deployment project roots that have migratable data. */
  detectMigrationSources(): Promise<DetectedSource[]>;
  /** Scan a specific web project root and report what can be imported. */
  scanMigrationSource(sourcePath?: string): Promise<MigrationScanResult>;
  /** Execute the migration (copy/merge per category). */
  executeMigration(params: {
    sourceRepoRoot: string;
    options: MigrationOptions;
  }): Promise<MigrationResult>;
  /** Subscribe to the one-shot "migration available" signal sent on first launch. */
  onMigrationAvailable(
    handler: (sources: DetectedSource[]) => void,
  ): () => void;
}

declare global {
  interface Window {
    oclawDesktop?: DesktopBridge;
  }
}

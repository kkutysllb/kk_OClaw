/**
 * Electron preload script.
 *
 * Runs in an isolated context with Node access and exposes a typed
 * `window.oclawDesktop` bridge to the renderer via `contextBridge`. The
 * renderer never imports Electron directly — it only calls these methods,
 * which forward to the corresponding `ipcMain.handle` channels.
 *
 * The bridge shape is mirrored by `frontend/src/core/desktop/types.ts`.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// ── Payload types (kept structurally identical to the frontend's) ────────

interface FileDialogOptions {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

interface PickedFile {
  name: string;
  data: Uint8Array;
  type?: string;
}

interface GatewayConfig {
  port: number;
}

interface BackendStatus {
  status: "stopped" | "starting" | "running" | "error";
  port: number;
  error?: string;
}

interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

interface EmbeddedTerminalSession {
  sessionId: string;
  cwd: string;
  shell: string;
  projectName: string;
  promptLabel: string;
}

// ── Path authorization ────────────────────────────────────────────────────

interface AuthorizePathResult {
  authorized: boolean;
}

interface GrantedPathEntry {
  path: string;
  granted_at: string;
  scope: string;
  thread_id?: string;
  granted_via: string;
}

// ── Web-to-desktop migration ──────────────────────────────────────────────

interface MigrationOptions {
  skills: boolean;
  extensions: boolean;
  credentials: boolean;
  memory: boolean;
  agents: boolean;
}

interface DetectedSource {
  path: string;
  label: string;
  exists: boolean;
  hasData: boolean;
}

// ── Skill model credentials (mirrors skill-models-env.ts shapes) ──────────

interface SkillModelField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

interface SkillModelProvider {
  id: string;
  category: "image" | "av";
  title: string;
  description: string;
  matchKeywords: string[];
  fields: SkillModelField[];
}

interface SkillModelVar {
  key: string;
  value: string;
  configured: boolean;
  isSecret: boolean;
}

interface SkillModelsConfig {
  providers: SkillModelProvider[];
  vars: SkillModelVar[];
  filePath: string;
}

// The renderer reads `gatewayPort` synchronously at module load to resolve
// the gateway base URL. We default it to the standard desktop port (19987);
// the renderer's `initGatewayPort()` refreshes it asynchronously once the
// main process responds.
const DEFAULT_GATEWAY_PORT = 19987;

contextBridge.exposeInMainWorld("oclawDesktop", {
  gatewayPort: DEFAULT_GATEWAY_PORT,

  // ── Backend lifecycle ──────────────────────────────────────────────
  getGatewayConfig: (): Promise<GatewayConfig> =>
    ipcRenderer.invoke("backend:get-gateway-config"),
  getBackendStatus: (): Promise<BackendStatus> =>
    ipcRenderer.invoke("backend:get-status"),
  startBackend: (): Promise<BackendStatus> =>
    ipcRenderer.invoke("backend:start"),
  stopBackend: (): Promise<BackendStatus> =>
    ipcRenderer.invoke("backend:stop"),
  restartBackend: (): Promise<BackendStatus> =>
    ipcRenderer.invoke("backend:restart"),
  getBackendLogs: (): Promise<string[]> =>
    ipcRenderer.invoke("backend:get-logs"),

  // ── Native file dialog ──────────────────────────────────────────────
  pickFiles: (options?: FileDialogOptions): Promise<PickedFile[]> =>
    ipcRenderer.invoke("dialog:pick-files", options ?? {}),
  pickDirectory: (options?: { title?: string }): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pick-directory", options ?? {}),

  // ── System integration ──────────────────────────────────────────────
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),
  openFolder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-folder", folderPath),
  startTerminal: (folderPath: string): Promise<EmbeddedTerminalSession> =>
    ipcRenderer.invoke("terminal:start", folderPath),
  writeTerminal: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke("terminal:write", sessionId, data),
  resizeTerminal: (
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> =>
    ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  stopTerminal: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("terminal:stop", sessionId),
  onTerminalData: (
    handler: (event: { sessionId: string; data: string }) => void,
  ): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      event: { sessionId: string; data: string },
    ): void => {
      handler(event);
    };
    ipcRenderer.on("terminal:data", listener);
    return () => {
      ipcRenderer.removeListener("terminal:data", listener);
    };
  },
  onTerminalExit: (
    handler: (event: { sessionId: string; code: number | null; signal: string | null }) => void,
  ): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      event: { sessionId: string; code: number | null; signal: string | null },
    ): void => {
      handler(event);
    };
    ipcRenderer.on("terminal:exit", listener);
    return () => {
      ipcRenderer.removeListener("terminal:exit", listener);
    };
  },
  onFileDrop: (handler: (files: PickedFile[]) => void): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      files: PickedFile[],
    ): void => {
      handler(files);
    };
    ipcRenderer.on("desktop:file-drop", listener);
    return () => {
      ipcRenderer.removeListener("desktop:file-drop", listener);
    };
  },

  // ── Auto-update ─────────────────────────────────────────────────────
  checkForUpdates: (): Promise<UpdateInfo> =>
    ipcRenderer.invoke("updater:check"),
  installUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke("updater:install"),
  onCheckUpdateRequest: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("menu:check-update", listener);
    return () => {
      ipcRenderer.removeListener("menu:check-update", listener);
    };
  },
  // Push events from main → renderer for the autoDownload lifecycle.
  // With autoDownload=true, the renderer is NOT in charge of triggering
  // the download — it only reacts to progress notifications from main.
  //   onUpdateDownloading: a new version was found, background download
  //     started (silent; UI may show a non-blocking toast).
  //   onUpdateReady: download completed, installer staged — show the
  //     "restart now to install" prompt.
  onUpdateDownloading: (
    callback: (info: { version: string; releaseDate?: string }) => void,
  ): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      info: { version: string; releaseDate?: string },
    ): void => callback(info);
    ipcRenderer.on("updater:downloading", listener);
    return () => {
      ipcRenderer.removeListener("updater:downloading", listener);
    };
  },
  onUpdateReady: (
    callback: (info: { version: string; releaseDate?: string }) => void,
  ): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      info: { version: string; releaseDate?: string },
    ): void => callback(info);
    ipcRenderer.on("updater:ready", listener);
    return () => {
      ipcRenderer.removeListener("updater:ready", listener);
    };
  },

  // ── Skill model credentials ────────────────────────────────────────
  getSkillModels: (): Promise<SkillModelsConfig> =>
    ipcRenderer.invoke("skill-models:get"),
  setSkillModels: (
    updates: Record<string, string>,
  ): Promise<SkillModelsConfig> =>
    ipcRenderer.invoke("skill-models:set", updates),

  // ── Path authorization ────────────────────────────────────────────
  /** Show system dialog to authorize an external path. */
  authorizePath: (params: {
    path: string;
    agentType: string;
    threadId?: string;
  }): Promise<AuthorizePathResult> =>
    ipcRenderer.invoke("authorize-path", params),
  /** List all user-granted paths (for settings UI). */
  listGrantedPaths: (): Promise<GrantedPathEntry[]> =>
    ipcRenderer.invoke("granted-paths:list"),
  /** Revoke a previously granted path. */
  revokeGrantedPath: (path: string): Promise<boolean> =>
    ipcRenderer.invoke("granted-paths:revoke", path),

  // ── Web-to-desktop migration ───────────────────────────────────────
  detectMigrationSources: (): Promise<DetectedSource[]> =>
    ipcRenderer.invoke("migration:detect-sources"),
  scanMigrationSource: (sourcePath?: string): Promise<unknown> =>
    ipcRenderer.invoke("migration:scan", sourcePath),
  executeMigration: (params: {
    sourceRepoRoot: string;
    options: MigrationOptions;
  }): Promise<unknown> => ipcRenderer.invoke("migration:execute", params),
  onMigrationAvailable: (
    handler: (sources: DetectedSource[]) => void,
  ): (() => void) => {
    const listener = (
      _evt: IpcRendererEvent,
      sources: DetectedSource[],
    ): void => {
      handler(sources);
    };
    ipcRenderer.on("migration:available", listener);
    return () => {
      ipcRenderer.removeListener("migration:available", listener);
    };
  },
});

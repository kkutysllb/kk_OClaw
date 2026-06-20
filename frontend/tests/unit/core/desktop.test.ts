// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  getBackendStatus,
  getBackendLogs,
  startBackend,
  stopBackend,
  restartBackend,
} from "@/core/desktop";
import type { BackendStatus, DesktopBridge } from "@/core/desktop/types";

/** A minimal Electron bridge stub used to drive the desktop code path. */
function makeBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  const stopped: BackendStatus = { status: "stopped", port: 19987 };
  const starting: BackendStatus = { status: "starting", port: 19987 };
  return {
    gatewayPort: 19987,
    getGatewayConfig: vi.fn(async () => ({ port: 19987 })),
    getBackendStatus: vi.fn(async (): Promise<BackendStatus> => stopped),
    startBackend: vi.fn(async (): Promise<BackendStatus> => starting),
    stopBackend: vi.fn(async (): Promise<BackendStatus> => stopped),
    restartBackend: vi.fn(async (): Promise<BackendStatus> => starting),
    getBackendLogs: vi.fn(async (): Promise<string[]> => []),
    pickFiles: vi.fn(async () => []),
    pickDirectory: vi.fn(async () => null),
    openExternal: vi.fn(async (_url: string) => undefined),
    openFolder: vi.fn(async (_path: string) => undefined),
    onFileDrop: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => ({ available: false })),
    installUpdate: vi.fn(async () => true),
    onCheckUpdateRequest: vi.fn(() => () => {}),
    onUpdateDownloading: vi.fn(() => () => {}),
    onUpdateReady: vi.fn(() => () => {}),
    getStartupInfo: vi.fn(async () => ({
      services: [],
      env_check: {
        repo_root: "",
        env_file: "",
        env_file_exists: false,
        gateway_port: 19987,
        frontend_port: 3000,
        uv_binary: "",
        uv_binary_exists: true,
        is_dev: true,
      },
      env_vars: [],
    })),
    getSkillModels: vi.fn(async () => ({ providers: [], vars: [], filePath: "" })),
    setSkillModels: vi.fn(async () => ({ providers: [], vars: [], filePath: "" })),
    authorizePath: vi.fn(async () => ({ authorized: true })),
    listGrantedPaths: vi.fn(async () => []),
    revokeGrantedPath: vi.fn(async () => true),
    detectMigrationSources: vi.fn(async () => []),
    scanMigrationSource: vi.fn(async () => ({
      sourceRepoRoot: "",
      categories: {
        skills: { available: false, count: 0, description: "", paths: [] },
        extensions: { available: false, count: 0, description: "", paths: [] },
        credentials: { available: false, count: 0, description: "", paths: [] },
        memory: { available: false, count: 0, description: "", paths: [] },
        agents: { available: false, count: 0, description: "", paths: [] },
      },
    })),
    executeMigration: vi.fn(async () => ({ success: true, results: [], targetHome: "" })),
    onMigrationAvailable: vi.fn(() => () => {}),
    ...overrides,
  };
}

function setDesktopMode(enabled: boolean, bridge?: DesktopBridge) {
  const w = window as unknown as Record<string, unknown>;
  if (enabled && bridge) {
    w.oclawDesktop = bridge;
  } else {
    delete w.oclawDesktop;
  }
}

const STOPPED: BackendStatus = { status: "stopped", port: 19987 };
const STARTING: BackendStatus = { status: "starting", port: 19987 };

describe("desktop integration — web mode (no Electron bridge)", () => {
  beforeEach(() => {
    setDesktopMode(false);
  });

  test("getBackendStatus returns null in web mode", async () => {
    expect(await getBackendStatus()).toBeNull();
  });

  test("startBackend returns null in web mode", async () => {
    expect(await startBackend()).toBeNull();
  });

  test("stopBackend returns null in web mode", async () => {
    expect(await stopBackend()).toBeNull();
  });

  test("restartBackend returns null in web mode", async () => {
    expect(await restartBackend()).toBeNull();
  });

  test("getBackendLogs returns empty array in web mode", async () => {
    expect(await getBackendLogs()).toEqual([]);
  });
});

describe("desktop integration — Electron mode", () => {
  let bridge: DesktopBridge;

  beforeEach(() => {
    bridge = makeBridge();
    setDesktopMode(true, bridge);
  });

  afterEach(() => {
    setDesktopMode(false);
  });

  test("getBackendStatus calls the bridge and returns data", async () => {
    (bridge.getBackendStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      STOPPED,
    );
    const result = await getBackendStatus();
    expect(bridge.getBackendStatus).toHaveBeenCalled();
    expect(result).toEqual(STOPPED);
  });

  test("getBackendStatus returns null on bridge error", async () => {
    (bridge.getBackendStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("IPC error"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getBackendStatus()).toBeNull();
    warnSpy.mockRestore();
  });

  test("startBackend calls the bridge", async () => {
    (bridge.startBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      STARTING,
    );
    expect(await startBackend()).toEqual(STARTING);
    expect(bridge.startBackend).toHaveBeenCalled();
  });

  test("stopBackend calls the bridge", async () => {
    (bridge.stopBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      STOPPED,
    );
    expect(await stopBackend()).toEqual(STOPPED);
    expect(bridge.stopBackend).toHaveBeenCalled();
  });

  test("restartBackend calls the bridge", async () => {
    (bridge.restartBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      STARTING,
    );
    expect(await restartBackend()).toEqual(STARTING);
    expect(bridge.restartBackend).toHaveBeenCalled();
  });

  test("getBackendLogs calls the bridge", async () => {
    (bridge.getBackendLogs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "line1",
      "line2",
    ]);
    expect(await getBackendLogs()).toEqual(["line1", "line2"]);
    expect(bridge.getBackendLogs).toHaveBeenCalled();
  });
});

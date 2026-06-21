// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

import { openExternalUrl } from "@/core/desktop/external-links";
import type { DesktopBridge } from "@/core/desktop/types";

function setDesktopBridge(bridge?: Partial<DesktopBridge>) {
  const w = window as unknown as Record<string, unknown>;
  const unsubscribe = () => undefined;
  if (bridge) {
    w.oclawDesktop = {
      gatewayPort: 19987,
      getGatewayConfig: vi.fn(),
      getBackendStatus: vi.fn(),
      startBackend: vi.fn(),
      stopBackend: vi.fn(),
      restartBackend: vi.fn(),
      getBackendLogs: vi.fn(),
      pickFiles: vi.fn(),
      pickDirectory: vi.fn(),
      openExternal: vi.fn(),
      openFolder: vi.fn(),
      startTerminal: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      stopTerminal: vi.fn(),
      onTerminalData: vi.fn(() => unsubscribe),
      onTerminalExit: vi.fn(() => unsubscribe),
      onFileDrop: vi.fn(),
      checkForUpdates: vi.fn(),
      installUpdate: vi.fn(),
      onCheckUpdateRequest: vi.fn(() => unsubscribe),
      onUpdateDownloading: vi.fn(() => unsubscribe),
      onUpdateReady: vi.fn(() => unsubscribe),
      getStartupInfo: vi.fn(),
      getSkillModels: vi.fn(),
      setSkillModels: vi.fn(),
      authorizePath: vi.fn(),
      listGrantedPaths: vi.fn(),
      revokeGrantedPath: vi.fn(),
      detectMigrationSources: vi.fn(),
      scanMigrationSource: vi.fn(),
      executeMigration: vi.fn(),
      onMigrationAvailable: vi.fn(),
      ...bridge,
    } satisfies DesktopBridge;
  } else {
    delete w.oclawDesktop;
  }
}

describe("desktop external links", () => {
  afterEach(() => {
    setDesktopBridge();
    vi.restoreAllMocks();
  });

  test("does not fall back to window.open when desktop bridge rejects", async () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    setDesktopBridge({
      openExternal: vi.fn(async () => {
        throw new Error("blocked");
      }),
    });

    await openExternalUrl("file:///tmp/secret.txt");

    expect(openSpy).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  getBackendStatus,
  getBackendLogs,
  startBackend,
  stopBackend,
  restartBackend,
} from "@/core/desktop";

// Helper to toggle desktop mode
function setDesktopMode(enabled: boolean) {
  if (enabled) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

describe("desktop integration — web mode (no Tauri)", () => {
  beforeEach(() => {
    setDesktopMode(false);
    mockInvoke.mockReset();
  });

  test("getBackendStatus returns null in web mode", async () => {
    const result = await getBackendStatus();
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("startBackend returns null in web mode", async () => {
    const result = await startBackend();
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("stopBackend returns null in web mode", async () => {
    const result = await stopBackend();
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("restartBackend returns null in web mode", async () => {
    const result = await restartBackend();
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("getBackendLogs returns empty array in web mode", async () => {
    const result = await getBackendLogs();
    expect(result).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("desktop integration — Tauri mode", () => {
  beforeEach(() => {
    setDesktopMode(true);
    mockInvoke.mockReset();
  });

  afterEach(() => {
    setDesktopMode(false);
  });

  test("getBackendStatus calls invoke and returns data", async () => {
    const mockStatus = { status: "running", port: 9987 };
    mockInvoke.mockResolvedValueOnce(mockStatus);

    const result = await getBackendStatus();
    expect(mockInvoke).toHaveBeenCalledWith("get_backend_status");
    expect(result).toEqual(mockStatus);
  });

  test("getBackendStatus returns null on invoke error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("IPC error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getBackendStatus();
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  test("startBackend calls invoke without parameters", async () => {
    const mockStatus = { status: "running", port: 9987 };
    mockInvoke.mockResolvedValueOnce(mockStatus);

    await startBackend();
    expect(mockInvoke).toHaveBeenCalledWith("start_backend");
  });

  test("stopBackend calls correct command", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "stopped", port: 9987 });
    await stopBackend();
    expect(mockInvoke).toHaveBeenCalledWith("stop_backend");
  });

  test("restartBackend calls correct command", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "running", port: 9987 });
    await restartBackend();
    expect(mockInvoke).toHaveBeenCalledWith("restart_backend");
  });

  test("getBackendLogs returns log array", async () => {
    const mockLogs = ["[INFO] line 1", "[WARN] line 2"];
    mockInvoke.mockResolvedValueOnce(mockLogs);

    const result = await getBackendLogs();
    expect(mockInvoke).toHaveBeenCalledWith("get_backend_logs");
    expect(result).toEqual(mockLogs);
  });

  test("getBackendLogs returns empty array on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("IPC error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getBackendLogs();
    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });
});

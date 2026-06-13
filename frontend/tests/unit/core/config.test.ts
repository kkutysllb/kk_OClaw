// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock @/env before importing config
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BACKEND_BASE_URL: "",
    NEXT_PUBLIC_LANGGRAPH_BASE_URL: "",
  },
}));

import { getBackendBaseURL, getLangGraphBaseURL, isDesktop } from "@/core/config";

describe("isDesktop", () => {
  afterEach(() => {
    // Clean up __TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  test("returns false in a regular browser", () => {
    expect(isDesktop()).toBe(false);
  });

  test("returns true when __TAURI_INTERNALS__ is present", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
  });
});

describe("getBackendBaseURL", () => {
  const originalPort = window.location.port;

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    // Restore port is tricky in jsdom; we use defineProperty to reset
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: originalPort },
      writable: true,
    });
  });

  test("returns empty string in web mode without env var", () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(getBackendBaseURL()).toBe("");
  });

  test("returns empty string in desktop dev mode (port 8659)", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: "8659" },
      writable: true,
    });
    expect(getBackendBaseURL()).toBe("");
  });

  test("returns direct gateway URL in desktop production mode (non-8659 port)", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: "" },
      writable: true,
    });
    const url = getBackendBaseURL();
    expect(url).toContain("127.0.0.1");
    expect(url).toContain("9987");
  });

  test("returns correct default gateway port in production mode", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: "" },
      writable: true,
    });
    // DESKTOP_GATEWAY_PORT is evaluated at module load; default is 9987
    const url = getBackendBaseURL();
    expect(url).toBe("http://127.0.0.1:9987");
  });
});

describe("getLangGraphBaseURL", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  test("returns origin-based URL in web mode", () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const url = getLangGraphBaseURL();
    expect(url).toContain("/api/langgraph");
  });

  test("returns rewrite proxy URL in desktop dev mode (port 8659)", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: "8659", origin: "http://localhost:8659" },
      writable: true,
    });
    const url = getLangGraphBaseURL();
    expect(url).toContain("/api/langgraph");
  });

  test("returns direct gateway URL in desktop production mode", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    Object.defineProperty(window, "location", {
      value: { ...window.location, port: "" },
      writable: true,
    });
    const url = getLangGraphBaseURL();
    expect(url).toContain("127.0.0.1");
    expect(url).toContain("/api");
  });
});

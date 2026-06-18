// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BACKEND_BASE_URL: "http://127.0.0.1:19987",
    NEXT_PUBLIC_LANGGRAPH_BASE_URL: "http://127.0.0.1:19987/api",
  },
}));

vi.mock("@/core/auth/session", () => ({
  getDesktopSessionToken: vi.fn(() => "desktop-token"),
}));

import { prepareLangGraphRequest } from "@/core/api/api-client";

function setDesktopMode(enabled: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (enabled) {
    w.oclawDesktop = { gatewayPort: 19987 };
  } else {
    delete w.oclawDesktop;
  }
}

function setDesktopModeWithFrontendPort(frontendPort: number) {
  const w = window as unknown as Record<string, unknown>;
  w.oclawDesktop = { gatewayPort: 19987, frontendPort };
}

function stubLocationPort(port: string) {
  Object.defineProperty(window, "location", {
    value: {
      ...window.location,
      port,
      origin: `http://localhost:${port}`,
    },
    writable: true,
  });
}

describe("LangGraph API client request hook", () => {
  beforeEach(() => {
    setDesktopMode(false);
  });

  afterEach(() => {
    setDesktopMode(false);
    vi.restoreAllMocks();
  });

  test("adds bearer token in desktop production mode", () => {
    setDesktopMode(true);
    stubLocationPort("");

    const init = prepareLangGraphRequest(
      new URL("http://127.0.0.1:19987/api/threads/search"),
      { method: "POST" },
    );

    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer desktop-token");
  });

  test("uses csrf cookie and no bearer token in desktop dev mode with dynamic frontend port", () => {
    setDesktopModeWithFrontendPort(3000);
    stubLocationPort("3000");
    document.cookie = "csrf_token=csrf-dev-token";

    const init = prepareLangGraphRequest(
      new URL("http://localhost:3000/api/threads/search"),
      { method: "POST" },
    );

    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-CSRF-Token")).toBe("csrf-dev-token");
  });
});

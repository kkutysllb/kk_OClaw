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
});

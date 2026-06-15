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

import {
  createAuthenticatedArtifactObjectUrl,
  downloadArtifactUrl,
  openArtifactUrl,
  requiresAuthenticatedArtifactFetch,
} from "@/core/artifacts/authenticated-url";

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
      origin: port ? `http://localhost:${port}` : "app://-",
    },
    writable: true,
  });
}

describe("desktop authenticated artifact URLs", () => {
  beforeEach(() => {
    setDesktopMode(true);
    stubLocationPort("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("artifact", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:artifact"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    setDesktopMode(false);
    vi.restoreAllMocks();
  });

  test("requires authenticated fetch only for desktop production artifact API URLs", () => {
    expect(
      requiresAuthenticatedArtifactFetch(
        "http://127.0.0.1:19987/api/threads/t1/artifacts/mnt/out/report.txt",
      ),
    ).toBe(true);

    expect(
      requiresAuthenticatedArtifactFetch(
        "http://127.0.0.1:19987/api/models",
      ),
    ).toBe(false);

    stubLocationPort("18659");
    expect(
      requiresAuthenticatedArtifactFetch(
        "http://127.0.0.1:19987/api/threads/t1/artifacts/mnt/out/report.txt",
      ),
    ).toBe(false);
  });

  test("fetches artifact blobs with the desktop bearer token", async () => {
    const url = await createAuthenticatedArtifactObjectUrl(
      "http://127.0.0.1:19987/api/threads/t1/artifacts/mnt/out/report.txt",
    );

    expect(url).toBe("blob:artifact");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get("Authorization")).toBe("Bearer desktop-token");
  });

  test("desktop downloads protected artifacts through a blob URL instead of opening the raw backend URL", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await downloadArtifactUrl(
      "http://127.0.0.1:19987/api/threads/t1/artifacts/mnt/out/report.txt?download=true",
      "report.txt",
    );

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  test("desktop open respects backend attachment disposition for active artifact content", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("<script>alert(1)</script>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": "attachment; filename*=UTF-8''report.html",
        },
      }),
    );
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await openArtifactUrl(
      "http://127.0.0.1:19987/api/threads/t1/artifacts/mnt/out/report.html",
      "report.html",
    );

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

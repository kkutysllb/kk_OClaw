import { afterEach, describe, expect, test, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("@/core/api/fetcher", () => ({
  fetch: fetchMock,
}));

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import { listAgents } from "@/core/agents/api";

describe("listAgents", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  test("returns an empty list when the agents API is disabled", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail:
            "Custom-agent management API is disabled. Set agents_api.enabled=true to expose agent and user-profile routes over HTTP.",
        }),
        { status: 403 },
      ),
    );

    await expect(listAgents()).resolves.toEqual([]);
  });
});

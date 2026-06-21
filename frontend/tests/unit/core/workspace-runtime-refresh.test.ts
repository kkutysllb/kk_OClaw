// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentThreadState } from "@/core/threads/types";
import {
  clearThreadRuntimeSnapshot,
  getThreadRuntimeSnapshot,
  refreshRuntimeTargetsOnce,
} from "@/core/workspace-runtime";

function makeState(): AgentThreadState {
  return {
    title: "",
    messages: [],
    artifacts: [],
  };
}

describe("workspace runtime refresh", () => {
  afterEach(() => {
    clearThreadRuntimeSnapshot("thread-a");
    clearThreadRuntimeSnapshot("thread-b");
    vi.clearAllMocks();
  });

  test("refreshes active run messages into runtime snapshots", async () => {
    const listRuns = vi.fn(async () => [
      { run_id: "run-a", status: "running" as const },
    ]);
    const fetchRunMessages = vi.fn(async () => [
      {
        run_id: "run-a",
        content: {
          type: "human" as const,
          id: "m-a",
          content: "background update",
        },
        metadata: { caller: "agent" },
        created_at: "2026-06-21T00:00:00Z",
      },
    ]);
    const invalidateQueries = vi.fn();

    await refreshRuntimeTargetsOnce(
      [
        {
          taskId: "chat:thread-a",
          kind: "chat",
          threadId: "thread-a",
        },
      ],
      {
        listRuns,
        fetchRunMessages,
        invalidateQueries,
        getFallbackState: makeState,
      },
    );

    expect(getThreadRuntimeSnapshot("thread-a")?.messages).toEqual([
      { type: "human", id: "m-a", content: "background update" },
    ]);
    expect(getThreadRuntimeSnapshot("thread-a")?.isLoading).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith(["thread", "thread-a"]);
    expect(invalidateQueries).toHaveBeenCalledWith(["threads", "search"]);
  });

  test("hides internal middleware summary messages during runtime refresh", async () => {
    const invalidateQueries = vi.fn();

    await refreshRuntimeTargetsOnce(
      [
        {
          taskId: "chat:thread-a",
          kind: "chat",
          threadId: "thread-a",
        },
      ],
      {
        listRuns: vi.fn(async () => [
          { run_id: "run-a", status: "running" as const },
        ]),
        fetchRunMessages: vi.fn(async () => [
          {
            run_id: "run-a",
            content: {
              type: "human" as const,
              id: "summary-a",
              name: "summary",
              content:
                "SESSION INTENT\nThe user wants status.\n\nSUMMARY\nInternal state only.",
            },
            metadata: { caller: "agent" },
            created_at: "2026-06-21T00:00:00Z",
          },
          {
            run_id: "run-a",
            content: {
              type: "human" as const,
              id: "m-a",
              content: "visible update",
            },
            metadata: { caller: "agent" },
            created_at: "2026-06-21T00:00:01Z",
          },
        ]),
        invalidateQueries,
        getFallbackState: makeState,
      },
    );

    expect(getThreadRuntimeSnapshot("thread-a")?.messages).toEqual([
      { type: "human", id: "m-a", content: "visible update" },
    ]);
  });

  test("uses task adapters to refresh coding-specific queries", async () => {
    const invalidateQueries = vi.fn();

    await refreshRuntimeTargetsOnce(
      [
        {
          taskId: "coding:project-a",
          kind: "coding",
          threadId: "thread-a",
          projectId: "project-a",
        },
      ],
      {
        listRuns: vi.fn(async () => [
          { run_id: "run-a", status: "pending" as const },
        ]),
        fetchRunMessages: vi.fn(async () => []),
        invalidateQueries,
        getFallbackState: makeState,
      },
    );

    expect(invalidateQueries).toHaveBeenCalledWith([
      "projects",
      "project-a",
      "files",
    ]);
    expect(invalidateQueries).toHaveBeenCalledWith(["coding", "projects"]);
    expect(invalidateQueries).toHaveBeenCalledWith(["coding", "sessions"]);
  });
});

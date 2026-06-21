// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

import {
  getRuntimeTargetForWorkspaceTask,
  getRuntimeRefreshQueries,
} from "@/core/workspace-runtime/task-runtime-adapters";
import type { WorkspaceTaskTab } from "@/core/workspace-task-tabs";

function makeTab(tab: Partial<WorkspaceTaskTab>): WorkspaceTaskTab {
  return {
    id: tab.id ?? "chat:thread-a",
    href: tab.href ?? "/workspace/chats/thread-a",
    kind: tab.kind ?? "chat",
    title: tab.title ?? "Task",
    lastActiveAt: tab.lastActiveAt ?? 1,
    threadId: tab.threadId,
    agentName: tab.agentName,
    projectId: tab.projectId,
  };
}

describe("task runtime adapters", () => {
  test("uses the thread id directly for chat and agent tasks", () => {
    expect(
      getRuntimeTargetForWorkspaceTask(makeTab({ kind: "chat", threadId: "chat-thread" })),
    ).toEqual({
      taskId: "chat:thread-a",
      kind: "chat",
      threadId: "chat-thread",
    });

    expect(
      getRuntimeTargetForWorkspaceTask(
        makeTab({
          id: "agent:research:agent-thread",
          kind: "agent",
          threadId: "agent-thread",
          agentName: "research",
        }),
      ),
    ).toEqual({
      taskId: "agent:research:agent-thread",
      kind: "agent",
      threadId: "agent-thread",
    });
  });

  test("resolves coding task threads from per-project storage", () => {
    const storage = {
      getItem: (key: string) =>
        key === "coding:thread:project-a" ? "coding-thread" : null,
    } as Storage;

    expect(
      getRuntimeTargetForWorkspaceTask(
        makeTab({
          id: "coding:project-a",
          kind: "coding",
          projectId: "project-a",
          threadId: undefined,
        }),
        storage,
      ),
    ).toEqual({
      taskId: "coding:project-a",
      kind: "coding",
      threadId: "coding-thread",
      projectId: "project-a",
    });
  });

  test("returns task-specific query refresh keys", () => {
    expect(
      getRuntimeRefreshQueries({
        taskId: "chat:thread-a",
        kind: "chat",
        threadId: "thread-a",
      }),
    ).toEqual([["thread", "thread-a"], ["threads", "search"]]);

    expect(
      getRuntimeRefreshQueries({
        taskId: "coding:project-a",
        kind: "coding",
        threadId: "thread-a",
        projectId: "project-a",
      }),
    ).toEqual([
      ["thread", "thread-a"],
      ["threads", "search"],
      ["projects", "project-a", "files"],
      ["projects", "project-a", "file"],
      ["projects", "project-a", "diff"],
      ["coding", "projects"],
      ["coding", "sessions", "thread-a"],
      ["coding", "sessions"],
    ]);
  });
});

import { describe, expect, test } from "vitest";

import {
  closeWorkspaceTaskTab,
  createWorkspaceTaskTabFromPath,
  mergeWorkspaceTaskTabs,
  mergeWorkspaceTaskTabsWithThreads,
  upsertWorkspaceTaskTab,
} from "@/core/workspace-task-tabs";

describe("workspace task tabs", () => {
  test("creates a chat tab from a chat route", () => {
    expect(createWorkspaceTaskTabFromPath("/workspace/chats/thread-123")).toMatchObject({
      id: "chat:thread-123",
      href: "/workspace/chats/thread-123",
      kind: "chat",
      title: "thread-123",
      threadId: "thread-123",
    });
  });

  test("creates an agent chat tab from an agent route", () => {
    expect(
      createWorkspaceTaskTabFromPath("/workspace/agents/coder/chats/thread-456"),
    ).toMatchObject({
      id: "agent:coder:thread-456",
      href: "/workspace/agents/coder/chats/thread-456",
      kind: "agent",
      title: "thread-456",
      threadId: "thread-456",
      agentName: "coder",
    });
  });

  test("creates a coding tab from the coding project route", () => {
    expect(createWorkspaceTaskTabFromPath("/workspace/coding/proj-1")).toMatchObject({
      id: "coding:proj-1",
      href: "/workspace/coding/proj-1",
      kind: "coding",
      title: "Coding proj-1",
      projectId: "proj-1",
    });
  });

  test("ignores non-task workspace routes", () => {
    expect(createWorkspaceTaskTabFromPath("/workspace")).toBeNull();
    expect(createWorkspaceTaskTabFromPath("/workspace/skills")).toBeNull();
  });

  test("upserts active tab and keeps most recent tabs bounded", () => {
    const first = createWorkspaceTaskTabFromPath("/workspace/chats/a")!;
    const second = createWorkspaceTaskTabFromPath("/workspace/coding/p")!;
    const updatedFirst = createWorkspaceTaskTabFromPath("/workspace/chats/a")!;

    const tabs = upsertWorkspaceTaskTab(
      upsertWorkspaceTaskTab(upsertWorkspaceTaskTab([], first, 2), second, 2),
      updatedFirst,
      2,
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["coding:p", "chat:a"]);
    expect(tabs[1]?.lastActiveAt).toBeGreaterThanOrEqual(first.lastActiveAt);
  });

  test("does not downgrade a refreshed thread title back to the short id on navigation", () => {
    const existing = {
      ...createWorkspaceTaskTabFromPath("/workspace/chats/thread-123")!,
      title: "修复登录跳转",
    };
    const fromRoute = createWorkspaceTaskTabFromPath("/workspace/chats/thread-123")!;

    expect(upsertWorkspaceTaskTab([existing], fromRoute)[0]).toMatchObject({
      id: "chat:thread-123",
      title: "修复登录跳转",
    });
  });

  test("closing active tab selects the nearest remaining tab", () => {
    const tabs = [
      createWorkspaceTaskTabFromPath("/workspace/chats/a")!,
      createWorkspaceTaskTabFromPath("/workspace/chats/b")!,
      createWorkspaceTaskTabFromPath("/workspace/coding/p")!,
    ];

    expect(closeWorkspaceTaskTab(tabs, "chat:b", "chat:b")).toMatchObject({
      tabs: [tabs[0], tabs[2]],
      nextHref: "/workspace/coding/p",
    });
  });

  test("uses refreshed thread titles for chat and agent tabs", () => {
    const tabs = [
      createWorkspaceTaskTabFromPath("/workspace/chats/thread-123")!,
      createWorkspaceTaskTabFromPath("/workspace/agents/coder/chats/thread-456")!,
      createWorkspaceTaskTabFromPath("/workspace/coding/proj-1")!,
    ];

    const merged = mergeWorkspaceTaskTabsWithThreads(tabs, [
      {
        thread_id: "thread-123",
        values: { title: "修复登录跳转" },
      },
      {
        thread_id: "thread-456",
        values: { title: "审查支付 diff" },
      },
    ]);

    expect(merged.map((tab) => tab.title)).toEqual([
      "修复登录跳转",
      "审查支付 diff",
      "Coding proj-1",
    ]);
  });

  test("merges local and remote tabs by recency without downgrading titles", () => {
    const local = {
      ...createWorkspaceTaskTabFromPath("/workspace/chats/thread-123", 20)!,
      title: "修复登录跳转",
    };
    const remote = createWorkspaceTaskTabFromPath("/workspace/chats/thread-123", 30)!;
    const coding = createWorkspaceTaskTabFromPath("/workspace/coding/proj-1", 10)!;

    const merged = mergeWorkspaceTaskTabs([local], [remote, coding]);

    expect(merged.map((tab) => tab.id)).toEqual(["coding:proj-1", "chat:thread-123"]);
    expect(merged[1]).toMatchObject({
      id: "chat:thread-123",
      title: "修复登录跳转",
      lastActiveAt: 30,
    });
  });
});

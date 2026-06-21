// @vitest-environment happy-dom
import type { Message } from "@langchain/langgraph-sdk";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentThreadState } from "@/core/threads/types";
import {
  clearThreadRuntimeSnapshot,
  configureThreadRuntimeStore,
  publishThreadRuntimeSnapshot,
  pruneThreadRuntimeSnapshots,
  useThreadRuntimeSnapshot,
} from "@/core/workspace-runtime/thread-runtime-store";

function makeState(messages: Message[] = []): AgentThreadState {
  return {
    title: "",
    messages,
    artifacts: [],
  };
}

function textOf(message: Message): string {
  return typeof message.content === "string" ? message.content : "";
}

function SnapshotView({ threadId }: { threadId: string }) {
  const snapshot = useThreadRuntimeSnapshot(threadId);
  return React.createElement(
    "div",
    null,
    snapshot?.messages.map((message) => textOf(message)).join("|") ?? "empty",
  );
}

describe("thread runtime store", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = undefined;
    container = undefined;
    clearThreadRuntimeSnapshot("thread-a");
    clearThreadRuntimeSnapshot("thread-b");
    clearThreadRuntimeSnapshot("thread-c");
    configureThreadRuntimeStore({ maxSnapshots: 30, snapshotTtlMs: 30 * 60_000 });
  });

  test("publishes snapshots by thread id and notifies subscribers", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(SnapshotView, { threadId: "thread-a" }));
    });
    expect(container.textContent).toBe("empty");

    act(() => {
      publishThreadRuntimeSnapshot("thread-a", {
        messages: [{ type: "human", id: "a", content: "thread a" }],
        values: makeState(),
        isLoading: true,
        error: null,
      });
    });

    expect(container.textContent).toBe("thread a");
  });

  test("keeps snapshots isolated between thread ids", () => {
    publishThreadRuntimeSnapshot("thread-a", {
      messages: [{ type: "human", id: "a", content: "thread a" }],
      values: makeState(),
      isLoading: false,
      error: null,
    });
    publishThreadRuntimeSnapshot("thread-b", {
      messages: [{ type: "human", id: "b", content: "thread b" }],
      values: makeState(),
      isLoading: false,
      error: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(SnapshotView, { threadId: "thread-b" }));
    });

    expect(container.textContent).toBe("thread b");
  });

  test("evicts the oldest snapshots when capacity is exceeded", () => {
    configureThreadRuntimeStore({ maxSnapshots: 2, snapshotTtlMs: 30 * 60_000 });

    publishThreadRuntimeSnapshot("thread-a", {
      messages: [{ type: "human", id: "a", content: "thread a" }],
      values: makeState(),
      isLoading: false,
      error: null,
      updatedAt: 1,
    });
    publishThreadRuntimeSnapshot("thread-b", {
      messages: [{ type: "human", id: "b", content: "thread b" }],
      values: makeState(),
      isLoading: false,
      error: null,
      updatedAt: 2,
    });
    publishThreadRuntimeSnapshot("thread-c", {
      messages: [{ type: "human", id: "c", content: "thread c" }],
      values: makeState(),
      isLoading: false,
      error: null,
      updatedAt: 3,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(SnapshotView, { threadId: "thread-a" }));
    });

    expect(container.textContent).toBe("empty");
  });

  test("prunes completed snapshots after the ttl while keeping active ones", () => {
    configureThreadRuntimeStore({ maxSnapshots: 30, snapshotTtlMs: 100 });

    publishThreadRuntimeSnapshot("thread-a", {
      messages: [{ type: "human", id: "a", content: "old completed" }],
      values: makeState(),
      isLoading: false,
      error: null,
      updatedAt: 1_000,
    });
    publishThreadRuntimeSnapshot("thread-b", {
      messages: [{ type: "human", id: "b", content: "old active" }],
      values: makeState(),
      isLoading: true,
      error: null,
      updatedAt: 1_000,
    });

    pruneThreadRuntimeSnapshots(1_200);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(SnapshotView, { threadId: "thread-a" }),
          React.createElement(SnapshotView, { threadId: "thread-b" }),
        ),
      );
    });

    expect(container.textContent).toBe("emptyold active");
  });
});

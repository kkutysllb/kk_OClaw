// @vitest-environment happy-dom
import type { Message, Run } from "@langchain/langgraph-sdk";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  streamState,
  submitMock,
  stopMock,
  runsListMock,
  runsCancelMock,
  fetchMock,
  queryState,
  queryClient,
  updateSubtask,
  streamOptions,
  toastError,
} = vi.hoisted(() => ({
  streamState: {
    messages: [] as Message[],
    isLoading: false,
  },
  submitMock: vi.fn(),
  stopMock: vi.fn(async () => undefined),
  runsListMock: vi.fn(async (): Promise<Run[]> => []),
  runsCancelMock: vi.fn(async () => undefined),
  fetchMock: vi.fn(),
  queryState: {
    data: [] as unknown,
  },
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueriesData: vi.fn(),
  },
  updateSubtask: vi.fn(),
  streamOptions: {
    current: undefined as { onError?: (error: unknown) => void } | undefined,
  },
  toastError: vi.fn(),
}));

vi.mock("@langchain/langgraph-sdk/react", () => ({
  useStream: vi.fn((options) => {
    streamOptions.current = options;
    return {
      messages: streamState.messages,
      isLoading: streamState.isLoading,
      values: {},
      error: null,
      submit: submitMock,
      stop: stopMock,
      joinStream: vi.fn(),
    };
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(() => ({ data: queryState.data })),
  useQueryClient: vi.fn(() => queryClient),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      uploads: {
        uploadingFiles: "Uploading files",
      },
    },
  }),
}));

vi.mock("@/core/api", () => ({
  getAPIClient: () => ({
    runs: {
      list: runsListMock,
      cancel: runsCancelMock,
    },
  }),
}));

vi.mock("@/core/api/fetcher", () => ({
  fetch: fetchMock,
}));

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
  isDesktop: () => false,
}));

vi.mock("@/core/tasks/context", () => ({
  useUpdateSubtask: () => updateSubtask,
}));

vi.mock("@/core/uploads", () => ({
  promptInputFilePartToFile: vi.fn(),
  uploadFiles: vi.fn(),
}));

import { useThreadStream } from "@/core/threads/hooks";
import { setCachedThreadState } from "@/core/threads/thread-state-store";
import type { AgentThreadState } from "@/core/threads/types";
import {
  clearThreadRuntimeSnapshot,
  useThreadRuntimeSnapshot,
} from "@/core/workspace-runtime";

function makeState(messages: Message[] = []): AgentThreadState {
  return {
    title: "",
    messages,
    artifacts: [],
  };
}

function visibleText(message: Message): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function makeRun(runId: string, status: Run["status"]): Run {
  return {
    run_id: runId,
    thread_id: "thread-a",
    assistant_id: "lead_agent",
    status,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    metadata: {},
    kwargs: {},
    multitask_strategy: "reject",
  } as Run;
}

function Harness({ threadId }: { threadId: string }) {
  const { thread } = useThreadStream({
    threadId,
    context: { mode: undefined },
    isMock: true,
  });
  return React.createElement(
    "div",
    { "data-testid": "messages" },
    thread.messages.map((message) => visibleText(message)).join("|"),
  );
}

function SubmitHarness({ threadId }: { threadId: string }) {
  const { sendMessage } = useThreadStream({
    threadId,
    context: { mode: undefined },
    isMock: false,
  });
  return React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        void sendMessage(threadId, { text: "keep working", files: [] });
      },
    },
    "submit",
  );
}

function StopHarness({ threadId }: { threadId: string }) {
  const { thread } = useThreadStream({
    threadId,
    context: { mode: undefined },
    isMock: false,
  });
  return React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        void thread.stop();
      },
    },
    "stop",
  );
}

function RuntimeSnapshotHarness({ threadId }: { threadId: string }) {
  const snapshot = useThreadRuntimeSnapshot(threadId);
  return React.createElement(
    "div",
    { "data-testid": "runtime" },
    snapshot?.messages.map((message) => visibleText(message)).join("|") ??
      "empty",
  );
}

function StreamAndRuntimeHarness({ threadId }: { threadId: string }) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Harness, { threadId }),
    React.createElement(RuntimeSnapshotHarness, { threadId }),
  );
}

function installLocalStorageStub() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  });
}

describe("useThreadStream cache bridge", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    installLocalStorageStub();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = undefined;
    container = undefined;
    streamState.messages = [];
    streamState.isLoading = false;
    queryState.data = [];
    fetchMock.mockReset();
    submitMock.mockReset();
    stopMock.mockReset();
    runsListMock.mockReset();
    runsListMock.mockResolvedValue([]);
    runsCancelMock.mockReset();
    runsCancelMock.mockResolvedValue(undefined);
    toastError.mockReset();
    streamOptions.current = undefined;
    window.localStorage.clear();
    clearThreadRuntimeSnapshot("thread-a");
    clearThreadRuntimeSnapshot("thread-b");
    vi.clearAllMocks();
  });

  test("refreshes restored cache when the thread id changes", () => {
    setCachedThreadState("thread-a", {
      messages: [
        {
          type: "human",
          id: "a-message",
          content: "上一条历史需求",
        },
      ],
      values: makeState(),
      isLoading: true,
      error: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(Harness, { threadId: "thread-a" }));
    });

    expect(container.textContent).toContain("上一条历史需求");

    act(() => {
      root!.render(React.createElement(Harness, { threadId: "thread-b" }));
    });

    expect(container.textContent).not.toContain("上一条历史需求");
  });

  test("does not auto-fetch run history when a task snapshot can restore the view", () => {
    queryState.data = [{ run_id: "run-a" }];
    setCachedThreadState("thread-a", {
      messages: [
        {
          type: "human",
          id: "a-message",
          content: "cached task state",
        },
      ],
      values: makeState(),
      isLoading: false,
      error: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(Harness, { threadId: "thread-a" }));
    });

    expect(container.textContent).toContain("cached task state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps backend runs alive when a top-level task tab unmounts on web", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(SubmitHarness, { threadId: "thread-a" }));
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submitOptions = submitMock.mock.calls[0]?.[1] as
      | { onDisconnect?: string }
      | undefined;
    expect(submitOptions?.onDisconnect).toBe("continue");
  });

  test("stop cancels the active backend run even when the SDK stream key is missing", async () => {
    runsListMock.mockResolvedValue([
      makeRun("old-success", "success"),
      makeRun("run-active", "running"),
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(React.createElement(StopHarness, { threadId: "thread-a" }));
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalled();
    expect(runsListMock).toHaveBeenCalledWith("thread-a");
    expect(runsCancelMock).toHaveBeenCalledWith(
      "thread-a",
      "run-active",
      false,
      "interrupt",
    );
  });

  test("stop still cancels the backend run if the SDK local stop fails", async () => {
    stopMock.mockRejectedValueOnce(new Error("local stream already closed"));
    runsListMock.mockResolvedValue([makeRun("run-active", "running")]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(React.createElement(StopHarness, { threadId: "thread-a" }));
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalled();
    expect(runsCancelMock).toHaveBeenCalledWith(
      "thread-a",
      "run-active",
      false,
      "interrupt",
    );
  });

  test("clears stale stream reconnect keys without showing an error toast", () => {
    window.localStorage.setItem("lg:stream:thread-a", "run-a");

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(React.createElement(Harness, { threadId: "thread-a" }));
    });

    act(() => {
      streamOptions.current?.onError?.({
        status: 409,
        detail: "Run run-a is not active on this worker and cannot be streamed",
      });
    });

    expect(window.localStorage.getItem("lg:stream:thread-a")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  test("publishes display snapshots to the workspace runtime store", () => {
    streamState.messages = [
      {
        type: "human",
        id: "live-message",
        content: "runtime bridge",
      },
    ];

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        React.createElement(StreamAndRuntimeHarness, { threadId: "thread-a" }),
      );
    });

    expect(container.textContent).toContain("runtime bridge");
  });
});

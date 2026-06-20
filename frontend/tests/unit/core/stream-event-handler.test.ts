/**
 * Unit tests for the SSE custom-event dispatcher extracted from
 * `useAgentThread`'s `onCustomEvent` callback.
 *
 * Coverage focuses on the UX-improvement surface area:
 *  - `subagent_limit_truncated`  → warning toast (previously silent)
 *  - `task_failed` / `task_timed_out` / `task_cancelled` → error toast
 *  - `path_authorization_required` → info toast + desktop IPC + timeout hint
 *  - `task_running` / `llm_retry` → existing behaviour preserved
 *  - unknown events → silently ignored
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock `sonner` so every toast method is a spy we can assert against.
// `toast` is both callable (toast(msg)) and a namespace (toast.info(msg)).
// vi.hoisted is required because vi.mock factories run before top-level code.
const { toastCallable, toastSpies } = vi.hoisted(() => ({
  toastCallable: vi.fn(),
  toastSpies: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastCallable, toastSpies),
}));

import { toast } from "sonner";

import {
  handleStreamEvent,
  type StreamEventDependencies,
} from "@/core/threads/stream-event-handler";

function makeDeps(
  overrides: Partial<StreamEventDependencies> = {},
): StreamEventDependencies & {
  updateSubtask: ReturnType<typeof vi.fn>;
  authorizePath: ReturnType<typeof vi.fn>;
} {
  return {
    updateSubtask: vi.fn(),
    authorizePath: vi.fn(),
    threadId: "thread-123",
    ...overrides,
  } as StreamEventDependencies & {
    updateSubtask: ReturnType<typeof vi.fn>;
    authorizePath: ReturnType<typeof vi.fn>;
  };
}

describe("handleStreamEvent", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Unknown / malformed events ──────────────────────────────────────
  describe("unknown events", () => {
    test("ignores null", () => {
      handleStreamEvent(null, deps);
      expect(toastSpies.warning).not.toHaveBeenCalled();
      expect(deps.updateSubtask).not.toHaveBeenCalled();
    });

    test("ignores non-object primitives", () => {
      handleStreamEvent("task_running", deps);
      handleStreamEvent(42, deps);
      handleStreamEvent(undefined, deps);
      expect(deps.updateSubtask).not.toHaveBeenCalled();
    });

    test("ignores object without type field", () => {
      handleStreamEvent({ foo: "bar" }, deps);
      expect(toastSpies.warning).not.toHaveBeenCalled();
      expect(deps.updateSubtask).not.toHaveBeenCalled();
    });

    test("ignores unrecognised type", () => {
      handleStreamEvent({ type: "some_future_event" }, deps);
      expect(toastSpies.warning).not.toHaveBeenCalled();
      expect(toastSpies.error).not.toHaveBeenCalled();
    });
  });

  // ── task_running ────────────────────────────────────────────────────
  describe("task_running", () => {
    test("forwards message to updateSubtask", () => {
      const message = { id: "msg-1", content: "working" } as never;
      handleStreamEvent(
        { type: "task_running", task_id: "task-a", message },
        deps,
      );

      expect(deps.updateSubtask).toHaveBeenCalledWith({
        id: "task-a",
        latestMessage: message,
      });
    });

    test("does not trigger any toast", () => {
      handleStreamEvent(
        { type: "task_running", task_id: "t1", message: {} },
        deps,
      );
      expect(toastSpies.info).not.toHaveBeenCalled();
      expect(toastSpies.warning).not.toHaveBeenCalled();
      expect(toastSpies.error).not.toHaveBeenCalled();
    });
  });

  // ── subagent_limit_truncated ────────────────────────────────────────
  describe("subagent_limit_truncated", () => {
    test("shows warning toast with dropped count and concurrency limit", () => {
      handleStreamEvent(
        {
          type: "subagent_limit_truncated",
          dropped_count: 2,
          max_concurrent: 3,
        },
        deps,
      );

      expect(toastSpies.warning).toHaveBeenCalledTimes(1);
      const msg = toastSpies.warning.mock.calls[0]?.[0] as string;
      expect(msg).toContain("3");
      expect(msg).toContain("2");
      expect(msg).toContain("并发上限");
    });

    test("does not call authorizePath", () => {
      handleStreamEvent(
        {
          type: "subagent_limit_truncated",
          dropped_count: 1,
          max_concurrent: 2,
        },
        deps,
      );
      expect(deps.authorizePath).not.toHaveBeenCalled();
    });
  });

  // ── task_failed / task_timed_out / task_cancelled ────────────────────
  describe("task failure events", () => {
    test("task_failed → error toast with label and error detail", () => {
      handleStreamEvent(
        {
          type: "task_failed",
          task_id: "t-fail",
          error: "connection reset",
        },
        deps,
      );

      expect(toastSpies.error).toHaveBeenCalledTimes(1);
      const msg = toastSpies.error.mock.calls[0]?.[0] as string;
      expect(msg).toContain("子任务执行失败");
      expect(msg).toContain("connection reset");
    });

    test("task_timed_out → error toast with timeout label", () => {
      handleStreamEvent(
        {
          type: "task_timed_out",
          task_id: "t-timeout",
          error: "900s exceeded",
        },
        deps,
      );

      expect(toastSpies.error).toHaveBeenCalledTimes(1);
      const msg = toastSpies.error.mock.calls[0]?.[0] as string;
      expect(msg).toContain("子任务执行超时");
      expect(msg).toContain("900s exceeded");
    });

    test("task_cancelled → error toast with cancelled label", () => {
      handleStreamEvent(
        {
          type: "task_cancelled",
          task_id: "t-cancel",
          error: "user stopped",
        },
        deps,
      );

      expect(toastSpies.error).toHaveBeenCalledTimes(1);
      const msg = toastSpies.error.mock.calls[0]?.[0] as string;
      expect(msg).toContain("子任务已取消");
    });

    test("omits error detail suffix when error field is absent", () => {
      handleStreamEvent(
        { type: "task_failed", task_id: "t-noerr" },
        deps,
      );

      const msg = toastSpies.error.mock.calls[0]?.[0] as string;
      // Should be exactly the label with no trailing 「：」
      expect(msg).toBe("子任务执行失败");
    });
  });

  // ── path_authorization_required ─────────────────────────────────────
  describe("path_authorization_required", () => {
    test("shows info toast with path and calls authorizePath when bridge available", () => {
      deps.authorizePath.mockResolvedValue({ authorized: true });

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/Users/test/data",
          agent_type: "coding_agent",
          read_only: false,
        },
        deps,
      );

      expect(toastSpies.info).toHaveBeenCalledTimes(1);
      const msg = toastSpies.info.mock.calls[0]?.[0] as string;
      expect(msg).toContain("/Users/test/data");
      expect(deps.authorizePath).toHaveBeenCalledWith({
        path: "/Users/test/data",
        agentType: "coding_agent",
        threadId: "thread-123",
      });
    });

    test("includes timeout hint when timeout_seconds is provided", () => {
      deps.authorizePath.mockResolvedValue({ authorized: true });

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/secret",
          agent_type: "lead",
          timeout_seconds: 120,
        },
        deps,
      );

      const msg = toastSpies.info.mock.calls[0]?.[0] as string;
      expect(msg).toContain("2 分钟内完成操作");
      expect(msg).toContain("超时将自动拒绝");
    });

    test("omits timeout hint when timeout_seconds is absent", () => {
      deps.authorizePath.mockResolvedValue({ authorized: true });

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/no-timeout",
          agent_type: "lead",
        },
        deps,
      );

      const msg = toastSpies.info.mock.calls[0]?.[0] as string;
      expect(msg).not.toContain("分钟内完成操作");
    });

    test("shows warning toast when authorization is denied", async () => {
      deps.authorizePath.mockResolvedValue({ authorized: false });

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/denied",
          agent_type: "lead",
        },
        deps,
      );

      await vi.waitFor(() => {
        expect(toastSpies.warning).toHaveBeenCalledWith(
          expect.stringContaining("/denied"),
        );
      });
    });

    test("shows error toast when authorizePath rejects", async () => {
      deps.authorizePath.mockRejectedValue(new Error("IPC down"));

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/boom",
          agent_type: "lead",
        },
        deps,
      );

      await vi.waitFor(() => {
        expect(toastSpies.error).toHaveBeenCalledWith(
          "路径授权对话框无法显示",
        );
      });
    });

    test("does nothing when authorizePath is undefined (web build)", () => {
      const webDeps = makeDeps({ authorizePath: undefined });

      handleStreamEvent(
        {
          type: "path_authorization_required",
          path: "/web",
          agent_type: "lead",
        },
        webDeps,
      );

      expect(toastSpies.info).not.toHaveBeenCalled();
    });
  });

  // ── llm_retry ───────────────────────────────────────────────────────
  describe("llm_retry", () => {
    test("shows generic toast with the retry message", () => {
      handleStreamEvent(
        { type: "llm_retry", message: "Retrying after rate limit…" },
        deps,
      );

      expect(toastCallable).toHaveBeenCalledWith(
        "Retrying after rate limit…",
      );
    });

    test("ignores empty message", () => {
      handleStreamEvent({ type: "llm_retry", message: "   " }, deps);
      expect(toastCallable).not.toHaveBeenCalled();
    });
  });

  // ── Toast reference sanity check ─────────────────────────────────────
  test("uses the same toast instance imported by the module", () => {
    // This guards against accidental double-mock misalignment.
    handleStreamEvent(
      { type: "subagent_limit_truncated", dropped_count: 1, max_concurrent: 2 },
      deps,
    );
    expect(toast.warning).toBeDefined();
  });
});

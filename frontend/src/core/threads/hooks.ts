import type { Message, Run } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { fetch } from "../api/fetcher";
import { getBackendBaseURL, isDesktop } from "../config";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
import { promptInputFilePartToFile, uploadFiles } from "../uploads";

import type { AgentThread, AgentThreadState, RunMessage } from "./types";
import { handleStreamEvent } from "./stream-event-handler";
import {
  getCachedThreadState,
  setCachedThreadState,
  type CachedThreadState,
} from "./thread-state-store";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: LocalSettings["context"];
  isMock?: boolean;
  /** LangGraph assistant/graph id to run. Defaults to ``"lead_agent"``. */
  assistantId?: string;
  onSend?: (threadId: string) => void;
  onStart?: (threadId: string, runId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

type SendMessageOptions = {
  additionalKwargs?: Record<string, unknown>;
};

function mergeMessages(
  historyMessages: Message[],
  threadMessages: Message[],
  optimisticMessages: Message[],
): Message[] {
  const threadMessageIds = new Set(
    threadMessages
      .map((m) => ("tool_call_id" in m ? m.tool_call_id : m.id))
      .filter(Boolean),
  );

  // The overlap is a contiguous suffix of historyMessages (newest history == oldest thread).
  // Scan from the end: shrink cutoff while messages are already in thread, stop as soon as
  // we hit one that isn't — everything before that point is non-overlapping.
  let cutoff = historyMessages.length;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i];
    if (!msg) {
      continue;
    }
    if (
      (msg?.id && threadMessageIds.has(msg.id)) ||
      ("tool_call_id" in msg && threadMessageIds.has(msg.tool_call_id))
    ) {
      cutoff = i;
    } else {
      break;
    }
  }

  return [
    ...historyMessages.slice(0, cutoff),
    ...threadMessages,
    ...optimisticMessages,
  ];
}

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const nestedError = Reflect.get(error, "error");
    if (nestedError instanceof Error && nestedError.message.trim()) {
      return nestedError.message;
    }
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError;
    }
  }
  return "Request failed.";
}

/**
 * Detect a 409 Conflict from the backend, raised when a thread already has
 * an active run and a new run was created with the default "reject"
 * multitask strategy. In the desktop app this is common: switching tabs
 * unmounts the chat page (dropping the SSE connection) but
 * `onDisconnect:"continue"` keeps the run alive, so coming back and
 * resuming the conversation collides with the orphaned run. Detected in
 * `sendMessage` to retry with the "interrupt" strategy instead of leaving
 * the user stuck until the backend is restarted.
 */
function isThreadBusyConflict(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }
  const status = Reflect.get(error, "status");
  if (status === 409 || status === "409") {
    return true;
  }
  const message = Reflect.get(error, "message");
  if (
    typeof message === "string" &&
    /409|conflict|already running/i.test(message)
  ) {
    return true;
  }
  const detail = Reflect.get(error, "detail");
  if (typeof detail === "string" && /already running|conflict/i.test(detail)) {
    return true;
  }
  return false;
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  assistantId = "lead_agent",
  onSend,
  onStart,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  // ── Cross-mount state restoration ───────────────────────────────
  // On component remount (e.g. desktop workspace-tab switch), `useStream`
  // reinitialises with empty messages and `isLoading=false`. The user would
  // see a flash of empty content + ready→streaming state toggle before the
  // stream reconnects. We bridge that gap with a module-level cache of the
  // last displayed state so the remounted component renders the previous
  // messages immediately while the SSE reconnects silently in the background.
  const restoredStateRef = useRef<CachedThreadState | null | undefined>(
    undefined,
  );
  if (restoredStateRef.current === undefined && threadId) {
    restoredStateRef.current = getCachedThreadState(threadId) ?? null;
  }
  // Track the thread ID that is currently streaming to handle thread changes during streaming
  const [onStreamThreadId, setOnStreamThreadId] = useState(() => threadId);
  // Ref to track current thread ID across async callbacks without causing re-renders,
  // and to allow access to the current thread id in onUpdateEvent
  const threadIdRef = useRef<string | null>(threadId ?? null);
  const startedRef = useRef(false);
  const listeners = useRef({
    onSend,
    onStart,
    onFinish,
    onToolEnd,
  });

  const {
    messages: history,
    hasMore: hasMoreHistory,
    loadMore: loadMoreHistory,
    loading: isHistoryLoading,
    appendMessages,
  } = useThreadHistory(onStreamThreadId ?? "");

  // Keep listeners ref updated with latest callbacks
  useEffect(() => {
    listeners.current = { onSend, onStart, onFinish, onToolEnd };
  }, [onSend, onStart, onFinish, onToolEnd]);

  useEffect(() => {
    const normalizedThreadId = threadId ?? null;
    if (!normalizedThreadId) {
      // Reset when the UI moves back to a brand new unsaved thread.
      startedRef.current = false;
      setOnStreamThreadId(normalizedThreadId);
    } else {
      setOnStreamThreadId(normalizedThreadId);
    }
    threadIdRef.current = normalizedThreadId;
  }, [threadId]);

  const handleStreamStart = useCallback((_threadId: string, _runId: string) => {
    threadIdRef.current = _threadId;
    if (!startedRef.current) {
      listeners.current.onStart?.(_threadId, _runId);
      startedRef.current = true;
    }
    setOnStreamThreadId(_threadId);
  }, []);

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();

  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId,
    threadId: onStreamThreadId,
    // SDK calls onThreadId immediately after client.threads.create()
    // succeeds — BEFORE runs.stream() and thus before onCreated.  This is
    // the most reliable notification of a new thread ID.  We call
    // handleStreamStart here so onStart fires and setOnStreamThreadId
    // updates even if the onCreated callback (which depends on the
    // onRunCreated SSE event from the server) is delayed or lost.
    onThreadId: (newThreadId: string) => {
      handleStreamStart(newThreadId, "");
    },
    // Use localStorage (not sessionStorage) for the run-resume key so the
    // runId survives workspace-tab switches in the desktop app.  The SDK's
    // default `true` uses sessionStorage which — while technically persistent
    // across client-side navigations — has been observed to lose the key in
    // certain Electron packaged-build scenarios (custom scheme, background
    // throttling).  localStorage is more durable and the key is cleaned up
    // automatically by the SDK's onSuccess/onError callbacks.
    reconnectOnMount:
      typeof window !== "undefined" ? () => window.localStorage : false,
    fetchStateHistory: { limit: 1 },
    onCreated(meta) {
      handleStreamStart(meta.thread_id, meta.run_id);
      if (context.agent_name && !isMock) {
        void getAPIClient()
          .threads.update(meta.thread_id, {
            metadata: { agent_name: context.agent_name },
          })
          .catch(() => ({}));
      }
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        listeners.current.onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onUpdateEvent(data) {
      const keys = Object.keys(data || {});
      if (data["SummarizationMiddleware.before_model"]) {
        const _messages = [
          ...(data["SummarizationMiddleware.before_model"].messages ?? []),
        ];

        if (_messages.length < 2) {
          return;
        }
        for (const m of _messages) {
          if (m.name === "summary" && m.type === "human") {
            summarizedRef.current?.add(m.id ?? "");
          }
        }
        const _lastKeepMessage = _messages[2];
        const _currentMessages = [...messagesRef.current];
        const _movedMessages: Message[] = [];
        for (const m of _currentMessages) {
          if (m.id !== undefined && m.id === _lastKeepMessage?.id) {
            break;
          }
          if (!summarizedRef.current?.has(m.id ?? "")) {
            _movedMessages.push(m);
          }
        }
        appendMessages(_movedMessages);
        messagesRef.current = [];
      }

      const updates: Array<Partial<AgentThreadState> | null> = Object.values(
        data || {},
      );
      for (const update of updates) {
        if (update && "title" in update && update.title) {
          void queryClient.setQueriesData(
            {
              queryKey: ["threads", "search"],
              exact: false,
            },
            (oldData: Array<AgentThread> | undefined) => {
              return oldData?.map((t) => {
                if (t.thread_id === threadIdRef.current) {
                  return {
                    ...t,
                    values: {
                      ...t.values,
                      title: update.title,
                    },
                  };
                }
                return t;
              });
            },
          );
        }
      }
    },
    onCustomEvent(event: unknown) {
      handleStreamEvent(event, {
        updateSubtask,
        authorizePath:
          typeof window !== "undefined"
            ? window.oclawDesktop?.authorizePath
            : undefined,
        threadId: threadIdRef.current ?? undefined,
      });
    },
    onError(error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setOptimisticMessages([]);
      // In the desktop packaged build, a "TypeError: network error" on the
      // SSE stream is usually caused by the renderer process being reloaded
      // (e.g. RSC navigation fallback) rather than a real server error.
      // Don't show a toast — the fallback reconnection will silently rejoin
      // the stream once the component remounts.
      if (
        isDesktop() &&
        (errMsg.includes("network error") || errMsg.includes("Failed to fetch"))
      ) {
        return;
      }
      toast.error(getStreamErrorMessage(error));
    },
    onFinish(state) {
      listeners.current.onFinish?.(state.values);
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      // Refresh Coding delivery-stage state. The Coding Agent may have
      // invoked `suggest_delivery_stage` during this turn, which writes a
      // pending_suggestion the Workflow panel must surface to the user.
      // Use a predicate match so this is a no-op outside coding sessions
      // (where these queries are disabled anyway).
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key[0] !== "coding") return false;
          // ["coding", "projects", <root>, "stage"]
          if (key[1] === "projects" && key[3] === "stage") return true;
          // ["coding", "sessions", <threadId>, "session"]
          if (key[1] === "sessions" && key[3] === "session") return true;
          return false;
        },
      });
    },
  });

  // Optimistic messages shown before the server stream responds
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const sendInFlightRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const summarizedRef = useRef<Set<string>>(null);
  // Track message count before sending so we know when server has responded
  const prevMsgCountRef = useRef(thread.messages.length);

  summarizedRef.current ??= new Set<string>();

  // Reset thread-local pending UI state when switching between threads so
  // optimistic messages and in-flight guards do not leak across chat views.
  useEffect(() => {
    startedRef.current = false;
    sendInFlightRef.current = false;
  }, [threadId]);

  // ── Fallback run reconnection ────────────────────────────────────────────
  //
  // When the component remounts (e.g. desktop workspace-tab switch), the
  // SDK's built-in ``reconnectOnMount`` logic reads the stored runId and
  // calls ``joinStream``.  However this can fail silently if:
  //   • the stored runId was already cleaned up by a previous onSuccess,
  //   • the joinStream HTTP request loses a race with state history fetch,
  //   • macOS App Nap delayed the reconnection past the bridge TTL.
  //
  // As a safety net, after mount we poll the backend for any active run on
  // this thread.  If one exists AND the SDK has not already reconnected
  // (``thread.isLoading`` is still false), we manually join it.  This is
  // idempotent — if the SDK already reconnected, the manual join is skipped.
  //
  // The polling uses a ref guard (``reconnectAttemptedRef``) so it only runs
  // once per mount, and the effect cleanup cancels the timeout on unmount.
  const reconnectAttemptedRef = useRef<string | null>(null);
  const threadJoinStreamRef = useRef(thread.joinStream);
  threadJoinStreamRef.current = thread.joinStream;
  const threadIsLoadingRef = useRef(thread.isLoading);
  threadIsLoadingRef.current = thread.isLoading;

  useEffect(() => {
    if (!threadId || isMock) return;
    // Only attempt once per threadId per mount.
    if (reconnectAttemptedRef.current === threadId) return;
    reconnectAttemptedRef.current = threadId;

    let cancelled = false;

    const attemptFallbackReconnect = async () => {
      // Give the SDK's built-in reconnection a short window (~800ms) to succeed.
      // Reduced from 2.5s — in the desktop packaged build the reconnectOnMount
      // joinStream fires synchronously on mount; a long delay just makes the
      // user stare at a blank panel while the coding agent is running.
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (cancelled) return;

      // If the SDK already reconnected, nothing to do.
      if (threadIsLoadingRef.current) return;

      try {
        const apiClient = getAPIClient();
        const runs = await apiClient.runs.list(threadId!);
        if (cancelled) return;

        // Find the most recent active run (running or pending).
        // Runs are typically returned newest-first.
        const activeRun = runs.find(
          (r) => r.status === "running" || r.status === "pending",
        );

        if (activeRun && !threadIsLoadingRef.current) {
          // Manually join the active run's stream.
          // Pass explicit stream modes — joinStream doesn't auto-track
          // modes like submit does, so without this the reconnected
          // stream would only carry callback modes (updates/custom)
          // and thread.messages would remain empty.
          await threadJoinStreamRef.current?.(activeRun.run_id, undefined, {
            streamMode: ["values", "messages-tuple"],
          });
        } else if (!activeRun) {
          // No active run on the backend — clean up any stale reconnect key
          // so it doesn't cause spurious joinStream errors on the next mount.
          // This is especially important now that we use localStorage (which
          // persists across app restarts) instead of sessionStorage.
          try {
            window.localStorage.removeItem(`lg:stream:${threadId}`);
          } catch {
            // ignore
          }
        }
      } catch {
        // Best-effort: if the backend is unreachable or the run list fails,
        // silently give up. The user can still send a new message.
      }
    };

    // Offset the timer so the SDK's reconnectOnMount (which fires in the same
    // render tick on mount) has a chance to win the race and call joinStream
    // before we start polling for active runs.
    const timer = setTimeout(
      () => void attemptFallbackReconnect(),
      800,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [threadId, isMock]);

  // Clear optimistic when server messages arrive (count increases)
  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      thread.messages.length > prevMsgCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [thread.messages.length, optimisticMessages.length]);

  const sendMessage = useCallback(
    async (
      threadId: string | undefined,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
      options?: SendMessageOptions,
    ) => {
      if (sendInFlightRef.current) {
        return;
      }
      sendInFlightRef.current = true;

      const text = message.text.trim();

      // Capture current count before showing optimistic messages
      prevMsgCountRef.current = thread.messages.length;

      // Build optimistic files list with uploading status
      const optimisticFiles: FileInMessage[] = (message.files ?? []).map(
        (f) => ({
          filename: f.filename ?? "",
          size: 0,
          status: "uploading" as const,
        }),
      );

      const hideFromUI = options?.additionalKwargs?.hide_from_ui === true;
      const optimisticAdditionalKwargs = {
        ...options?.additionalKwargs,
        ...(optimisticFiles.length > 0 ? { files: optimisticFiles } : {}),
      };

      const newOptimistic: Message[] = [];
      if (!hideFromUI) {
        newOptimistic.push({
          type: "human",
          id: `opt-human-${Date.now()}`,
          content: text ? [{ type: "text", text }] : "",
          additional_kwargs: optimisticAdditionalKwargs,
        });
      }

      if (optimisticFiles.length > 0 && !hideFromUI) {
        // Mock AI message while files are being uploaded
        newOptimistic.push({
          type: "ai",
          id: `opt-ai-${Date.now()}`,
          content: t.uploads.uploadingFiles,
          additional_kwargs: { element: "task" },
        });
      }
      setOptimisticMessages(newOptimistic);

      listeners.current.onSend?.(threadId!);

      let uploadedFileInfo: UploadedFileInfo[] = [];

      try {
        // Upload files first if any
        if (message.files && message.files.length > 0) {
          setIsUploading(true);
          try {
            const filePromises = message.files.map((fileUIPart) =>
              promptInputFilePartToFile(fileUIPart),
            );

            const conversionResults = await Promise.all(filePromises);
            const files = conversionResults.filter(
              (file): file is File => file !== null,
            );
            const failedConversions = conversionResults.length - files.length;

            if (failedConversions > 0) {
              throw new Error(
                `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
              );
            }

            if (!threadId) {
              throw new Error("Thread is not ready for file upload.");
            }

            if (files.length > 0) {
              const uploadResponse = await uploadFiles(threadId, files);
              uploadedFileInfo = uploadResponse.files;

              // Update optimistic human message with uploaded status + paths
              const uploadedFiles: FileInMessage[] = uploadedFileInfo.map(
                (info) => ({
                  filename: info.filename,
                  size: info.size,
                  path: info.virtual_path,
                  status: "uploaded" as const,
                }),
              );
              setOptimisticMessages((messages) => {
                if (messages.length > 1 && messages[0]) {
                  const humanMessage: Message = messages[0];
                  return [
                    {
                      ...humanMessage,
                      additional_kwargs: { files: uploadedFiles },
                    },
                    ...messages.slice(1),
                  ];
                }
                return messages;
              });
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          } finally {
            setIsUploading(false);
          }
        }

        // Build files metadata for submission (included in additional_kwargs)
        const filesForSubmit: FileInMessage[] = uploadedFileInfo.map(
          (info) => ({
            filename: info.filename,
            size: info.size,
            path: info.virtual_path,
            status: "uploaded" as const,
          }),
        );

        // Wrap submit so we can retry with the "interrupt" multitask strategy
        // when the default "reject" returns 409. Desktop tab-switch leaves an
        // orphaned run alive (onDisconnect:"continue"); without this retry the
        // user is stuck and must restart the backend to clear the orphan.
        const doSubmit = async (strategy?: "interrupt") => {
          await thread.submit(
            {
              messages: [
                {
                  type: "human",
                  content: [
                    {
                      type: "text",
                      text,
                    },
                  ],
                  additional_kwargs: {
                    ...options?.additionalKwargs,
                    ...(filesForSubmit.length > 0
                      ? { files: filesForSubmit }
                      : {}),
                  },
                },
              ],
            },
            {
              threadId: threadId,
              // Explicitly request values + messages-tuple stream modes.
              // In SDK 1.6.0 these modes are auto-tracked via property getters
              // (thread.messages / thread.values), but the tracking ref can
              // lose its entries after stream.clear() fires on threadId change.
              // Without these modes the backend never sends full-state snapshots,
              // so thread.messages stays empty and the user sees no output.
              streamMode: ["values", "messages-tuple"],
              streamSubgraphs: true,
              streamResumable: true,
              // Desktop: keep the task running even if the SSE connection drops
              // (e.g. macOS App Nap throttling, window switching).  The frontend
              // will rejoin the stream when it reconnects.
              onDisconnect: isDesktop() ? "continue" : undefined,
              multitaskStrategy: strategy,
              config: {
                recursion_limit: 10000,
              },
              context: {
                ...extraContext,
                ...context,
                thinking_enabled: context.mode !== "flash",
                is_plan_mode: context.mode === "pro" || context.mode === "ultra",
                subagent_enabled: context.mode === "ultra",
                reasoning_effort:
                  context.reasoning_effort ??
                  (context.mode === "ultra"
                    ? "high"
                    : context.mode === "pro"
                      ? "medium"
                      : context.mode === "thinking"
                        ? "low"
                        : undefined),
                thread_id: threadId,
              },
            },
          );
        };

        try {
          await doSubmit();
        } catch (error) {
          if (isThreadBusyConflict(error)) {
            toast.info("已有任务在运行，正在接管并继续…");
            await doSubmit("interrupt");
          } else {
            throw error;
          }
        }
        void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      } catch (error) {
        setOptimisticMessages([]);
        setIsUploading(false);
        throw error;
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [thread, t.uploads.uploadingFiles, context, queryClient],
  );

  // Cache the latest thread messages in a ref to compare against incoming history messages for deduplication,
  // and to allow access to the full message list in onUpdateEvent without causing re-renders.
  if (thread.messages.length >= messagesRef.current.length) {
    messagesRef.current = thread.messages;
  }

  // Filter out middleware messages from thread.messages before merging
  const filteredThreadMessages = thread.messages.filter(
    (msg) => {
      const meta = (msg as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined;
      return !(typeof meta?.caller === "string" && meta.caller.startsWith("middleware:"));
    }
  );

  // Always merge all three sources.  When the outer `threadId` prop is still
  // undefined (brand-new thread — the SDK creates the thread inside submit()
  // and only later calls onStart → setThreadId in the parent), the SDK's
  // internal stream may already be delivering messages.  The previous guard
  // `threadId ? merge : optimistic-only` discarded those live stream messages
  // during the ~100ms window between stream-start and parent re-render,
  // causing the user's message to "flash and disappear".
  //
  // Safe because when nothing has arrived yet, all three arrays are empty
  // and mergeMessages returns [].  When history loads for an existing thread,
  // it merges correctly.  When the stream delivers messages before the parent
  // propagates the new threadId, they still display.
  const mergedMessages = mergeMessages(
    history,
    filteredThreadMessages,
    optimisticMessages,
  );

  // ── Cross-mount display bridge ─────────────────────────────────
  // While `useStream` is reconnecting after a remount, `thread.messages` is
  // empty and `thread.isLoading` resets to false — causing a flash of empty
  // content and a ready→streaming status toggle.  Until the live stream
  // produces its first message, fall back to the cached display state so the
  // UI stays visually identical across tab switches.  Once the stream has
  // data (or has definitively settled with no messages) the live values take
  // over seamlessly.
  const restored = restoredStateRef.current;
  const streamHasData = filteredThreadMessages.length > 0;
  const inReconnectTransition =
    !!threadId && !streamHasData && !!restored;
  const displayMessages = inReconnectTransition
    ? (restored!.messages as typeof mergedMessages)
    : mergedMessages;
  const displayIsLoading = inReconnectTransition
    ? restored!.isLoading
    : thread.isLoading;

  // Persist the current display state so the next mount can restore it.
  // Only cache when we have meaningful data (non-empty messages or an active
  // streaming state) to avoid overwriting a good cache with an empty one.
  useEffect(() => {
    if (!threadId) return;
    const hasContent = displayMessages.length > 0 || displayIsLoading;
    if (!hasContent) return;
    setCachedThreadState(threadId, {
      messages: displayMessages as Message[],
      values: thread.values as AgentThreadState,
      isLoading: displayIsLoading,
      error: thread.error,
    });
  }, [
    threadId,
    displayMessages,
    displayIsLoading,
    thread.values,
    thread.error,
  ]);

  // Merge history, live stream, and optimistic messages for display
  // History messages may overlap with thread.messages; thread.messages take precedence
  const mergedThread = {
    ...thread,
    messages: displayMessages,
    isLoading: displayIsLoading,
  } as typeof thread;

  return {
    thread: mergedThread,
    sendMessage,
    isUploading,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
    // The real thread ID currently being streamed.  Updated by the SDK's
    // onCreated callback (handleStreamStart).  Exposed so callers that need
    // the live thread ID (e.g. coding-workbench panels querying session/event/
    // roi APIs) don't have to rely solely on the onStart callback chain.
    streamThreadId: onStreamThreadId ?? undefined,
  } as const;
}

export function useThreadHistory(threadId: string) {
  const runs = useThreadRuns(threadId);
  const threadIdRef = useRef(threadId);
  const runsRef = useRef(runs.data ?? []);
  const indexRef = useRef(-1);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  loadingRef.current = loading;
  const loadMessages = useCallback(async () => {
    if (runsRef.current.length === 0) {
      return;
    }
    const run = runsRef.current[indexRef.current];
    if (!run || loadingRef.current) {
      return;
    }
    try {
      setLoading(true);
      const result: { data: RunMessage[]; hasMore: boolean } = await fetch(
        `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadIdRef.current)}/runs/${encodeURIComponent(run.run_id)}/messages`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        },
      ).then((res) => {
        return res.json();
      });
      const _messages = result.data
        .filter((m) => !m.metadata.caller?.startsWith("middleware:"))
        .map((m) => m.content);
      setMessages((prev) => [..._messages, ...prev]);
      indexRef.current -= 1;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);
  // Clear messages and pagination cursors whenever the thread changes so
  // that history from the previous thread does not leak into the new view.
  // This is critical when navigating from a historical thread to a brand-new
  // chat: `useThreadRuns("")` returns an empty list and `loadMessages()`
  // early-returns, so without this reset the previous thread's messages would
  // persist in state and render behind the new-chat InputBox/Welcome.
  useEffect(() => {
    setMessages([]);
    indexRef.current = -1;
    runsRef.current = [];
  }, [threadId]);

  useEffect(() => {
    threadIdRef.current = threadId;
    if (runs.data && runs.data.length > 0) {
      runsRef.current = runs.data ?? [];
      indexRef.current = runs.data.length - 1;
    }
    loadMessages().catch(() => {
      toast.error("Failed to load thread history.");
    });
  }, [threadId, runs.data, loadMessages]);

  const appendMessages = useCallback((_messages: Message[]) => {
    setMessages((prev) => {
      return [...prev, ..._messages];
    });
  }, []);
  const hasMore = indexRef.current >= 0 || !runs.data;
  return {
    runs: runs.data,
    messages,
    loading,
    appendMessages,
    hasMore,
    loadMore: loadMessages,
  };
}

export function useThreads(
  params: Parameters<ThreadsClient["search"]>[0] = {
    limit: 50,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values", "metadata"],
  },
) {
  const apiClient = getAPIClient();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: async () => {
      const maxResults = params.limit;
      const initialOffset = params.offset ?? 0;
      const DEFAULT_PAGE_SIZE = 50;

      // Preserve prior semantics: if a non-positive limit is explicitly provided,
      // delegate to a single search call with the original parameters.
      if (maxResults !== undefined && maxResults <= 0) {
        const response =
          await apiClient.threads.search<AgentThreadState>(params);
        return response as AgentThread[];
      }

      const pageSize =
        typeof maxResults === "number" && maxResults > 0
          ? Math.min(DEFAULT_PAGE_SIZE, maxResults)
          : DEFAULT_PAGE_SIZE;

      const threads: AgentThread[] = [];
      let offset = initialOffset;

      while (true) {
        if (typeof maxResults === "number" && threads.length >= maxResults) {
          break;
        }

        const currentLimit =
          typeof maxResults === "number"
            ? Math.min(pageSize, maxResults - threads.length)
            : pageSize;

        if (typeof maxResults === "number" && currentLimit <= 0) {
          break;
        }

        const response = (await apiClient.threads.search<AgentThreadState>({
          ...params,
          limit: currentLimit,
          offset,
        })) as AgentThread[];

        threads.push(...response);

        if (response.length < currentLimit) {
          break;
        }

        offset += response.length;
      }

      return threads;
    },
    refetchOnWindowFocus: false,
  });
}

export function useThreadRuns(threadId?: string) {
  const apiClient = getAPIClient();
  return useQuery<Run[]>({
    queryKey: ["thread", threadId],
    queryFn: async () => {
      if (!threadId) {
        return [];
      }
      const response = await apiClient.runs.list(threadId);
      return response;
    },
    refetchOnWindowFocus: false,
  });
}

export function useRunDetail(threadId: string, runId: string) {
  const apiClient = getAPIClient();
  return useQuery<Run>({
    queryKey: ["thread", threadId, "run", runId],
    queryFn: async () => {
      const response = await apiClient.runs.get(threadId, runId);
      return response;
    },
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await apiClient.threads.delete(threadId);

      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ detail: "Failed to delete local thread data." }));
        throw new Error(error.detail ?? "Failed to delete local thread data.");
      }
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread> | undefined) => {
          if (oldData == null) {
            return oldData;
          }
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}

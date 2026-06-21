"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  FileDiffIcon,
  Loader2Icon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { ChatBox } from "@/components/workspace/chats";
import { FollowupsProvider } from "@/components/workspace/followups-context";
import { InputBox } from "@/components/workspace/input-box";
import {
  MessageList,
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM,
} from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { notifyWorkspaceTaskRouteChanged } from "@/components/workspace/workspace-task-tabs";
import { useCodingSessionChanges, useProject } from "@/core/projects";
import type { QiongqiChange } from "@/core/projects";
import { useThreadSettings } from "@/core/settings";
import { SubtasksProvider } from "@/core/tasks/context";
import { useThreadStream } from "@/core/threads/hooks";
import { cn } from "@/lib/utils";

interface AgentPanelProps {
  projectId: string;
  onThreadIdChange?: (threadId: string | undefined) => void;
  onFocusFile?: (
    filePath: string,
    target?: "code" | "task-changes" | "diff" | "review",
    taskId?: string,
    line?: number | null,
  ) => void;
}

type CodingAgentStatus =
  | "idle"
  | "thinking"
  | "running_tool"
  | "syncing_files"
  | "completed"
  | "error";

const MESSAGE_LIST_CODING_CHANGES_EXTRA_PADDING_BOTTOM = 150;

/**
 * Right-hand Coding Agent chat panel.
 *
 * Talks to the ``coding_agent`` LangGraph graph (routed by the gateway when
 * ``assistantId === "coding_agent"``) and scopes the agent to the open
 * project by passing ``project_root`` (the project's absolute path) as run
 * context. One thread is derived per project so conversations persist across
 * page reloads within a session.
 */
export function AgentPanel({ projectId, onThreadIdChange }: AgentPanelProps) {
  return (
    <FollowupsProvider>
      <SubtasksProvider>
        <PromptInputProvider>
          <AgentPanelInner
            projectId={projectId}
            onThreadIdChange={onThreadIdChange}
          />
        </PromptInputProvider>
      </SubtasksProvider>
    </FollowupsProvider>
  );
}

function AgentPanelInner({ projectId, onThreadIdChange, onFocusFile }: AgentPanelProps) {
  const { project } = useProject(projectId);
  const queryClient = useQueryClient();
  // Persist the coding agent thread ID per-project so switching workspace tabs
  // (which unmounts this component) and coming back can rejoin the same run.
  // Without this, the backend keeps the run alive (onDisconnect:"continue") but
  // the frontend loses track of which thread to reconnect to.
  const threadIdStorageKey = `coding:thread:${projectId}`;
  const [threadId, setThreadId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return window.localStorage.getItem(threadIdStorageKey) ?? undefined;
  });
  useEffect(() => {
    if (threadId) {
      window.localStorage.setItem(threadIdStorageKey, threadId);
      notifyWorkspaceTaskRouteChanged(`/workspace/coding/${projectId}`);
    } else {
      window.localStorage.removeItem(threadIdStorageKey);
    }
  }, [projectId, threadId, threadIdStorageKey]);
  const uiThreadId = threadId ?? projectId;
  const { changes } = useCodingSessionChanges(uiThreadId);
  const [settings, setSettings] = useThreadSettings(`coding:${projectId}`);
  const [showFollowups, setShowFollowups] = useState(false);
  const [agentStatus, setAgentStatus] = useState<CodingAgentStatus>("idle");
  const [lastToolLabel, setLastToolLabel] = useState<string | null>(null);
  const { textInput } = usePromptInputController();
  const [draggingCodingPath, setDraggingCodingPath] = useState(false);

  const refreshProjectFiles = useCallback(() => {
    setAgentStatus("syncing_files");
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "files"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "file"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "diff"],
    });
  }, [projectId, queryClient]);

  // Invalidate the project delivery-stage query so the Workflow panel
  // picks up auto-accepted transitions and pending suggestions in real
  // time during the run, not just after remount.
  //
  // The stage query key is ["coding", "projects", projectRoot, "stage"].
  // We invalidate the ["coding", "projects"] prefix (exact:false) to
  // cover the current project regardless of whether ``project?.path``
  // is available yet (it may be undefined during initial load).
  const refreshStageState = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["coding", "projects"],
      exact: false,
    });
  }, [queryClient]);

  // Silent refresh: invalidates stage + files + sessions queries WITHOUT
  // touching agentStatus.  Used by the polling mechanism below so the UI
  // doesn't flicker between "syncing_files" and "running_tool" every poll.
  //
  // This exists because the gateway does not support the ``events`` stream
  // mode, so ``onToolEnd`` never fires, and the backend does not push
  // ``adispatch_custom_event`` so ``onCustomEvent`` never fires either.
  // The ONLY reliable signal during a run is ``thread.isLoading``.
  const silentRefreshAll = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "files"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "file"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, "diff"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["coding", "projects"],
      exact: false,
    });
    void queryClient.invalidateQueries({
      queryKey: ["coding", "sessions"],
      exact: false,
    });
  }, [projectId, queryClient]);

  const {
    thread,
    sendMessage,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
    streamThreadId,
  } = useThreadStream({
    threadId,
    assistantId: "coding_agent",
    context: settings.context,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      onThreadIdChange?.(createdThreadId);
      setAgentStatus("thinking");
      setLastToolLabel(null);
    },
    onToolEnd: (event) => {
      setLastToolLabel(labelOfTool(event.name));
      setAgentStatus("running_tool");
      if (isFileMutationTool(event.name)) {
        refreshProjectFiles();
      }
      // suggest_delivery_stage (and any tool that may indirectly change
      // the stage, e.g. cold-start bootstrap on first dynamic-context
      // build) → refresh the stage query so the Workflow panel updates.
      // We refresh on *every* tool end (not just suggest_delivery_stage)
      // because the stage can change as a side-effect of other tools and
      // the cost of an extra invalidate is negligible.
      refreshStageState();
      // Invalidate coding session/event/roi queries so the results panels
      // pick up data written by the backend during the run.  Without this,
      // the initial fetch (fired at thread-creation time) returns empty and
      // React Query never refetches.
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions"],
        exact: false,
      });
    },
    onFinish: () => {
      refreshProjectFiles();
      // Belt-and-suspenders: refresh stage state after the run completes
      // so any transitions that happened during the run are reflected even
      // if individual onToolEnd events were missed.
      refreshStageState();
      setAgentStatus("completed");
      // Final refresh of all coding session data after the run completes.
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions"],
        exact: false,
      });
    },
    // Reliable backup path: Qiongqi custom events are pushed by the
    // backend via SSE and do not depend on the SDK's on_tool_end LangChain
    // event dispatch (which can be unreliable in packaged/production builds).
    // We listen for file_changed events to refresh the file explorer and
    // always refresh the stage panel as a safety net.
    onQiongqiEvent: (event) => {
      if (
        event &&
        typeof event === "object" &&
        "type" in event &&
        (event as { type: string }).type === "file_changed"
      ) {
        refreshProjectFiles();
        refreshStageState();
      }
    },
  });

  // Belt-and-suspenders: propagate the SDK's internal stream thread ID
  // to the parent (coding-workbench) via useEffect.  The onStart callback
  // above already does this, but if the callback chain breaks for any
  // reason (timing, stale closure, SDK internals), this effect ensures
  // the parent always gets the real thread ID once the stream starts.
  useEffect(() => {
    if (streamThreadId) {
      onThreadIdChange?.(streamThreadId);
    }
  }, [streamThreadId, onThreadIdChange]);

  // ── Active-run polling refresh ────────────────────────────────────
  // The gateway does NOT support the ``events`` stream mode, so
  // ``onToolEnd`` (which relies on LangChain ``on_tool_end`` events) NEVER
  // fires.  The backend also does not push ``adispatch_custom_event``, so
  // ``onCustomEvent`` / ``onQiongqiEvent`` never fire either.
  //
  // This means the ONLY reliable indicator that the agent is actively
  // working is ``thread.isLoading``.  While it is true, we poll-silently-
  // refresh all derived UI state (stage transitions, file explorer, coding
  // session events) every 2 seconds so the Workflow panel and file tree
  // update in real time during the run.
  //
  // When the run finishes (isLoading→false), one final refresh ensures the
  // final state is reflected.
  const isLoading = thread.isLoading;
  useEffect(() => {
    if (!isLoading) return;
    // Immediate refresh when the run starts.
    silentRefreshAll();
    const interval = window.setInterval(silentRefreshAll, 2000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isLoading, silentRefreshAll]);
  // Final refresh when the run completes (isLoading transitions to false).
  useEffect(() => {
    if (!isLoading) {
      silentRefreshAll();
    }
  }, [isLoading, silentRefreshAll]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      // Scope the coding agent to this project's root directory. Read by
      // make_coding_agent (cfg["project_root"]) to inject the
      // "## Current Project" section into the system prompt.
      const project_root = project?.path;
      void sendMessage(
        threadId,
        message,
        project_root ? { project_root } : undefined,
      );
    },
    [sendMessage, threadId, project?.path],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const appendCodingPathToInput = useCallback(
    (payload: CodingPathDragPayload) => {
      const prefix = payload.type === "directory" ? "目录" : "文件";
      const snippet = `@${prefix}:${payload.path}`;
      textInput.setInput(
        textInput.value.trim()
          ? `${textInput.value.trimEnd()}\n${snippet}`
          : snippet,
      );
    },
    [textInput],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("application/x-oclaw-coding-path")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingCodingPath(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDraggingCodingPath(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData("application/x-oclaw-coding-path");
      if (!raw) return;
      event.preventDefault();
      setDraggingCodingPath(false);
      const payload = parseCodingPathDragPayload(raw);
      if (payload) {
        appendCodingPathToInput(payload);
      }
    },
    [appendCodingPathToInput],
  );

  const hasCodingChanges = changes.length > 0;
  const messageListPaddingBottom = showFollowups
    ? MESSAGE_LIST_DEFAULT_PADDING_BOTTOM +
      MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM +
      MESSAGE_LIST_CODING_CHANGES_EXTRA_PADDING_BOTTOM
    : MESSAGE_LIST_DEFAULT_PADDING_BOTTOM +
      (hasCodingChanges ? MESSAGE_LIST_CODING_CHANGES_EXTRA_PADDING_BOTTOM : 0);

  const status = thread.error
    ? "error"
    : thread.isLoading
      ? "streaming"
      : "ready";

  const visibleAgentStatus: CodingAgentStatus = thread.error
    ? "error"
    : thread.isLoading
      ? agentStatus === "idle" || agentStatus === "completed"
        ? "thinking"
        : agentStatus
      : agentStatus;

  return (
    <ThreadContext.Provider value={{ thread }}>
      <ChatBox threadId={uiThreadId} artifactsMode="disabled">
        <div
          className={cn(
            "relative flex size-full min-h-0 flex-col",
            draggingCodingPath && "ring-2 ring-emerald-500/50 ring-inset",
          )}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Status bar */}
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Coding Agent
            </span>
            <AgentStatusBadge
              status={visibleAgentStatus}
              lastToolLabel={lastToolLabel}
            />
          </div>

          {/* Messages */}
          <main className="relative flex min-h-0 grow flex-col">
            <MessageList
              className="size-full"
              threadId={uiThreadId}
              thread={thread}
              paddingBottom={messageListPaddingBottom}
              hasMoreHistory={hasMoreHistory}
              loadMoreHistory={loadMoreHistory}
              isHistoryLoading={isHistoryLoading}
            />
            <CodingChangeSummaryCard
              changes={changes}
              onFocusFile={onFocusFile}
            />

            {/* Input */}
            <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3">
              <div className="relative w-full">
                <InputBox
                  className="bg-background/5 w-full"
                  threadId={uiThreadId}
                  autoFocus={false}
                  status={status}
                  context={settings.context}
                  onContextChange={(context) => setSettings("context", context)}
                  onFollowupsVisibilityChange={setShowFollowups}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                />
              </div>
            </div>
          </main>

          {/* Empty-state hint shown before any messages */}
          {thread.messages.length === 0 && !thread.isLoading && (
            <div className="pointer-events-none absolute inset-0 top-9 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="bg-muted/50 flex h-12 w-12 items-center justify-center rounded-xl">
                <TerminalIcon className="text-muted-foreground h-6 w-6" />
              </div>
              <p className="text-sm font-medium">与 Coding Agent 对话</p>
              <p className="text-muted-foreground max-w-[16rem] text-xs">
                描述你的编程需求，Agent 可以读写文件、执行 Git
                操作、运行测试等。
              </p>
            </div>
          )}
          {draggingCodingPath && (
            <div className="bg-background/80 pointer-events-none absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm">
              <div className="rounded-md border px-3 py-2 text-sm shadow-sm">
                拖放到这里引用文件或目录
              </div>
            </div>
          )}
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}

interface CodingPathDragPayload {
  path: string;
  type: "file" | "directory";
}

function parseCodingPathDragPayload(raw: string): CodingPathDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CodingPathDragPayload>;
    if (
      typeof parsed.path === "string" &&
      (parsed.type === "file" || parsed.type === "directory")
    ) {
      return { path: parsed.path, type: parsed.type };
    }
  } catch {
    return null;
  }
  return null;
}

function CodingChangeSummaryCard({
  changes,
  onFocusFile,
}: {
  changes: QiongqiChange[];
  onFocusFile?: (
    filePath: string,
    target?: "code" | "task-changes" | "diff" | "review",
    taskId?: string,
    line?: number | null,
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const changedFiles = useMemo(() => {
    const latestTaskId = changes.reduce<string | null>((latest, change) => {
      if (!latest) return change.task_id;
      const latestChange = changes.find((item) => item.task_id === latest);
      if (!latestChange) return change.task_id;
      return change.created_at > latestChange.created_at ? change.task_id : latest;
    }, null);
    const scopedChanges = latestTaskId
      ? changes.filter((change) => change.task_id === latestTaskId)
      : changes;
    const byPath = new Map<
      string,
      {
        path: string;
        taskId: string;
        additions: number;
        deletions: number;
        lastChangedAt: string;
      }
    >();
    for (const change of scopedChanges) {
      const existing = byPath.get(change.path);
      if (!existing) {
        byPath.set(change.path, {
          path: change.path,
          taskId: change.task_id,
          additions: change.additions,
          deletions: change.deletions,
          lastChangedAt: change.created_at,
        });
        continue;
      }
      existing.additions += change.additions;
      existing.deletions += change.deletions;
      if (change.created_at > existing.lastChangedAt) {
        existing.lastChangedAt = change.created_at;
        existing.taskId = change.task_id;
      }
    }
    return Array.from(byPath.values())
      .sort((a, b) => b.lastChangedAt.localeCompare(a.lastChangedAt))
      .slice(0, 24);
  }, [changes]);
  const latestTaskId = changedFiles[0]?.taskId ?? null;
  const visibleFiles = expanded ? changedFiles : changedFiles.slice(0, 4);

  const totals = useMemo(
    () =>
      changedFiles.reduce(
        (acc, file) => ({
          additions: acc.additions + file.additions,
          deletions: acc.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [changedFiles],
  );

  if (changedFiles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-3">
      <div className="bg-background/95 pointer-events-auto w-full max-w-(--container-width-md) overflow-hidden rounded-lg border shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
              <FileDiffIcon className="text-muted-foreground h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                已编辑 {changedFiles.length} 个文件
              </p>
              <p className="font-mono text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{totals.additions}
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  -{totals.deletions}
                </span>
              </p>
            </div>
          </div>
          {latestTaskId && (
            <span className="text-muted-foreground hidden max-w-28 truncate font-mono text-[11px] sm:inline">
              {latestTaskId}
            </span>
          )}
        </div>
        <div className="max-h-[172px] divide-y overflow-y-auto border-t">
          {visibleFiles.map((file) => (
            <button
              key={file.path}
              className="hover:bg-muted/60 flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
              type="button"
              onClick={() => onFocusFile?.(file.path, "task-changes", file.taskId)}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {file.path}
              </span>
              <span className="shrink-0 font-mono text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{file.additions}
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  -{file.deletions}
                </span>
              </span>
            </button>
          ))}
          {changedFiles.length > 4 && (
            <button
              className="text-muted-foreground hover:bg-muted/60 flex w-full items-center justify-center px-3 py-1.5 text-xs transition-colors"
              type="button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "收起" : `更多 ${changedFiles.length - 4} 个文件`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentStatusBadge({
  status,
  lastToolLabel,
}: {
  status: CodingAgentStatus;
  lastToolLabel: string | null;
}) {
  const isActive =
    status === "thinking" ||
    status === "running_tool" ||
    status === "syncing_files";
  const Icon =
    status === "completed"
      ? CheckCircle2Icon
      : status === "error"
        ? XCircleIcon
        : isActive
          ? Loader2Icon
          : null;

  return (
    <div
      className={cn(
        "text-muted-foreground inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs",
        status === "completed" && "text-emerald-600 dark:text-emerald-400",
        status === "error" && "text-destructive",
        isActive && "text-foreground",
      )}
    >
      {Icon ? (
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", isActive && "animate-spin")}
        />
      ) : (
        <span className="bg-muted-foreground/40 inline-flex size-2 shrink-0 rounded-full" />
      )}
      <span className="truncate">{statusLabel(status, lastToolLabel)}</span>
    </div>
  );
}

function statusLabel(status: CodingAgentStatus, lastToolLabel: string | null) {
  switch (status) {
    case "thinking":
      return "正在思考";
    case "running_tool":
      return lastToolLabel ?? "正在执行工具";
    case "syncing_files":
      return "正在更新文件";
    case "completed":
      return "已完成";
    case "error":
      return "执行失败";
    case "idle":
    default:
      return "空闲";
  }
}

function labelOfTool(name: string) {
  switch (name) {
    case "bash":
      return "正在运行命令";
    case "write_file":
    case "str_replace":
      return "正在更新文件";
    case "read_file":
      return "正在读取文件";
    case "ls":
      return "正在浏览文件";
    default:
      return "正在执行工具";
  }
}

function isFileMutationTool(name: string) {
  return name === "write_file" || name === "str_replace" || name === "bash";
}

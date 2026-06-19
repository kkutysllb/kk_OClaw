"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  Loader2Icon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { useProject } from "@/core/projects";
import { useThreadSettings } from "@/core/settings";
import { SubtasksProvider } from "@/core/tasks/context";
import { useThreadStream } from "@/core/threads/hooks";
import { cn } from "@/lib/utils";

interface AgentPanelProps {
  projectId: string;
  onThreadIdChange?: (threadId: string | undefined) => void;
}

type CodingAgentStatus =
  | "idle"
  | "thinking"
  | "running_tool"
  | "syncing_files"
  | "completed"
  | "error";

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

function AgentPanelInner({ projectId, onThreadIdChange }: AgentPanelProps) {
  const { project } = useProject(projectId);
  const queryClient = useQueryClient();
  // Persist the coding agent thread ID per-project so switching workspace tabs
  // (which unmounts this component) and coming back can rejoin the same run.
  // Without this, the backend keeps the run alive (onDisconnect:"continue") but
  // the frontend loses track of which thread to reconnect to.
  const threadIdStorageKey = `coding:thread:${projectId}`;
  const [threadId, setThreadId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return window.localStorage.getItem(threadIdStorageKey) || undefined;
  });
  useEffect(() => {
    if (threadId) {
      window.localStorage.setItem(threadIdStorageKey, threadId);
    } else {
      window.localStorage.removeItem(threadIdStorageKey);
    }
  }, [threadId, threadIdStorageKey]);
  const uiThreadId = threadId ?? projectId;
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

  const {
    thread,
    sendMessage,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
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
    },
    onFinish: () => {
      refreshProjectFiles();
      setAgentStatus("completed");
    },
  });

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

  const messageListPaddingBottom = showFollowups
    ? MESSAGE_LIST_DEFAULT_PADDING_BOTTOM +
      MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM
    : MESSAGE_LIST_DEFAULT_PADDING_BOTTOM;

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

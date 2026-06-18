"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  GitCompareIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useCodingSessionChanges } from "@/core/projects";
import type { QiongqiChange } from "@/core/projects";
import { cn } from "@/lib/utils";

import {
  parseUnifiedDiffForSideBySide,
  SideBySideDiff,
  type DiffViewMode,
} from "./diff-view";

interface CodingTaskChangesPanelProps {
  threadId: string;
  selectedFilePath?: string | null;
  highlightedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onFocusFile?: (
    filePath: string,
    target?: "code" | "task-changes" | "diff",
    taskId?: string,
    line?: number | null,
  ) => void;
}

export function CodingTaskChangesPanel({
  selectedFilePath,
  threadId,
  highlightedTaskId,
  onSelectTask,
  onFocusFile,
}: CodingTaskChangesPanelProps) {
  const { changes, isLoading, isFetching, error, refetch } =
    useCodingSessionChanges(threadId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("unified");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Group changes by task_id
  const taskGroups = useMemo(() => {
    const groups = new Map<string, { changes: QiongqiChange[]; totals: { additions: number; deletions: number } }>();
    for (const change of changes) {
      const taskId = change.task_id || "__unknown__";
      if (!groups.has(taskId)) {
        groups.set(taskId, { changes: [], totals: { additions: 0, deletions: 0 } });
      }
      const group = groups.get(taskId)!;
      group.changes.push(change);
      group.totals.additions += change.additions;
      group.totals.deletions += change.deletions;
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => (a === "__unknown__" ? 1 : b === "__unknown__" ? -1 : a.localeCompare(b)))
      .map(([taskId, group]) => ({ taskId, ...group }));
  }, [changes]);

  // Expand highlighted task and auto-select its first file
  useEffect(() => {
    if (highlightedTaskId) {
      setExpandedTasks((prev) => {
        const next = new Set(prev);
        next.add(highlightedTaskId);
        return next;
      });
    }
  }, [highlightedTaskId]);

  // Select file logic
  useEffect(() => {
    if (changes.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (
      selectedFilePath &&
      changes.some((change) => change.path === selectedFilePath)
    ) {
      setSelectedPath(selectedFilePath);
      return;
    }
    if (
      !selectedPath ||
      !changes.some((change) => change.path === selectedPath)
    ) {
      setSelectedPath(changes[0]?.path ?? null);
    }
  }, [changes, selectedFilePath, selectedPath]);

  const selectedChange =
    changes.find((change) => change.path === selectedPath) ?? null;
  const totals = useMemo(
    () =>
      changes.reduce(
        (acc, change) => ({
          additions: acc.additions + change.additions,
          deletions: acc.deletions + change.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [changes],
  );

  const sideBySideRows = useMemo(
    () => parseUnifiedDiffForSideBySide(selectedChange?.diff ?? ""),
    [selectedChange?.diff],
  );

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b px-4 py-2">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-72 shrink-0 space-y-2 border-r p-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
          <div className="flex-1 p-4">
            <Skeleton className="h-full w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <TaskChangesEmpty
        title="无法加载任务变更"
        description={
          error instanceof Error ? error.message : "任务变更接口暂不可用。"
        }
      />
    );
  }

  if (changes.length === 0) {
    return (
      <TaskChangesEmpty
        title="暂无任务变更"
        description="Qiongqi 记录到文件修改后，这里会按 session/task 展示 Agent 本轮变更。"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm leading-5 font-semibold">任务变更</p>
            <p className="text-muted-foreground truncate text-xs">
              {taskGroups.length} 个任务 · {changes.length} 个文件 ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                +{totals.additions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                -{totals.deletions}
              </span>
            </p>
          </div>
        </div>
        <Button
          className="h-7 w-7 p-0"
          disabled={isFetching}
          size="icon"
          title="刷新任务变更"
          type="button"
          variant="ghost"
          onClick={() => void refetch()}
        >
          <RefreshCwIcon
            className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
          />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-72 shrink-0 border-r">
          <div className="space-y-0.5 p-1.5">
            {taskGroups.map((group) => {
              const isExpanded = expandedTasks.has(group.taskId);
              const isHighlighted = highlightedTaskId === group.taskId;
              return (
                <div key={group.taskId}>
                  <button
                    className={cn(
                      "hover:bg-muted/60 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      isHighlighted && "ring-2 ring-emerald-500/30 bg-emerald-500/10",
                    )}
                    type="button"
                    onClick={() => {
                      toggleTaskExpand(group.taskId);
                      onSelectTask?.(group.taskId);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRightIcon className="h-3 w-3 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {group.taskId === "__unknown__" ? "未关联任务" : group.taskId}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {group.changes.length} 文件
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-3 space-y-0.5 border-l-2 border-muted pl-2">
                      {group.changes.map((change) => (
                        <button
                          key={`${change.task_id}-${change.path}`}
                          className={cn(
                            "hover:bg-muted/60 flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
                            selectedPath === change.path &&
                              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                          )}
                          type="button"
                          onClick={() => {
                            setSelectedPath(change.path);
                            onSelectTask?.(group.taskId);
                            onFocusFile?.(change.path, "task-changes", group.taskId);
                          }}
                        >
                          <StatusBadge status={change.status} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                            {change.path}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            +{change.additions} -{change.deletions}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-sm">
              {selectedChange?.path ?? "未选择文件"}
            </span>
            {selectedChange && <StatusBadge status={selectedChange.status} />}
            {selectedChange && (
              <span className="text-muted-foreground shrink-0 text-xs">
                {selectedChange.task_id}
              </span>
            )}
            {selectedChange && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <div className="bg-muted text-muted-foreground inline-flex h-7 shrink-0 items-center rounded-md p-1">
                  <button
                    className={cn(
                      "inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-medium transition-colors",
                      diffViewMode === "side-by-side"
                        ? "bg-background text-foreground shadow-sm"
                        : "hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setDiffViewMode("side-by-side")}
                  >
                    左右对比
                  </button>
                  <button
                    className={cn(
                      "inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-medium transition-colors",
                      diffViewMode === "unified"
                        ? "bg-background text-foreground shadow-sm"
                        : "hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setDiffViewMode("unified")}
                  >
                    统一
                  </button>
                </div>
              </div>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {diffViewMode === "side-by-side" ? (
              <SideBySideDiff rows={sideBySideRows} />
            ) : (
              <pre className="text-foreground overflow-x-auto p-4 font-mono text-xs leading-5 whitespace-pre">
                {selectedChange?.diff || "该文件没有可显示的任务 Diff。"}
              </pre>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function TaskChangesEmpty({
  description,
  title,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="bg-muted/60 flex h-14 w-14 items-center justify-center rounded-lg">
        <GitCompareIcon className="text-muted-foreground h-7 w-7" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-xs">
          {description}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: QiongqiChange["status"] }) {
  const label =
    status === "added"
      ? "新增"
      : status === "deleted"
        ? "删除"
        : status === "renamed"
          ? "重命名"
          : "修改";

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded px-1.5 text-[10px]",
        status === "added" &&
          "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
        status === "deleted" &&
          "border-red-500/40 text-red-600 dark:text-red-400",
      )}
    >
      {label}
    </Badge>
  );
}

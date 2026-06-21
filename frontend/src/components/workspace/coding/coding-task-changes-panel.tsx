"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileDiffIcon,
  GitCompareIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useCodingSessionChanges } from "@/core/projects";
import type { QiongqiChange } from "@/core/projects";
import { cn } from "@/lib/utils";

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

const COLLAPSED_DIFF_LINES = 80;

export function CodingTaskChangesPanel({
  selectedFilePath,
  threadId,
  highlightedTaskId,
  onSelectTask,
  onFocusFile,
}: CodingTaskChangesPanelProps) {
  const { changes, isLoading, isFetching, error, refetch } =
    useCodingSessionChanges(threadId);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const taskExpansionTouchedRef = useRef(false);
  const fileCardRefs = useRef(new Map<string, HTMLElement>());

  const taskGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        changes: QiongqiChange[];
        latestChangedAt: string;
        totals: { additions: number; deletions: number };
      }
    >();
    for (const change of changes) {
      const taskId = change.task_id || "__unknown__";
      if (!groups.has(taskId)) {
        groups.set(taskId, {
          changes: [],
          latestChangedAt: change.created_at,
          totals: { additions: 0, deletions: 0 },
        });
      }
      const group = groups.get(taskId)!;
      group.changes.push(change);
      group.totals.additions += change.additions;
      group.totals.deletions += change.deletions;
      if (change.created_at > group.latestChangedAt) {
        group.latestChangedAt = change.created_at;
      }
    }
    return Array.from(groups.entries())
      .map(([taskId, group]) => ({
        taskId,
        ...group,
        changes: [...group.changes].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
      }))
      .sort((a, b) => b.latestChangedAt.localeCompare(a.latestChangedAt));
  }, [changes]);

  useEffect(() => {
    taskExpansionTouchedRef.current = false;
    setExpandedTasks(new Set());
    setExpandedFiles(new Set());
    fileCardRefs.current.clear();
  }, [threadId]);

  useEffect(() => {
    if (taskExpansionTouchedRef.current || taskGroups.length === 0) return;
    setExpandedTasks(new Set(taskGroups.map((group) => group.taskId)));
  }, [taskGroups]);

  useEffect(() => {
    if (highlightedTaskId) {
      setExpandedTasks((prev) => {
        const next = new Set(prev);
        next.add(highlightedTaskId);
        return next;
      });
    }
  }, [highlightedTaskId]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const selectedChange = changes.find(
      (change) => change.path === selectedFilePath,
    );
    if (!selectedChange) return;
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.add(changeKey(selectedChange));
      return next;
    });
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      next.add(selectedChange.task_id || "__unknown__");
      return next;
    });
  }, [changes, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const selectedChange = changes.find(
      (change) => change.path === selectedFilePath,
    );
    if (!selectedChange) return;
    const scrollTimer = window.setTimeout(() => {
      fileCardRefs.current.get(changeKey(selectedChange))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(scrollTimer);
  }, [changes, expandedTasks, selectedFilePath]);

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

  const toggleTaskExpand = (taskId: string) => {
    taskExpansionTouchedRef.current = true;
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
    onSelectTask?.(taskId);
  };

  const toggleFileExpand = (change: QiongqiChange) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      const key = changeKey(change);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    onSelectTask?.(change.task_id || "__unknown__");
    onFocusFile?.(change.path, "task-changes", change.task_id || "__unknown__");
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b px-4 py-2">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {taskGroups.map((group) => {
            const isExpanded = expandedTasks.has(group.taskId);
            const isHighlighted = highlightedTaskId === group.taskId;
            return (
              <section
                key={group.taskId}
                className={cn(
                  "overflow-hidden rounded-lg border",
                  isHighlighted && "ring-2 ring-emerald-500/30",
                )}
              >
                <button
                  className="hover:bg-muted/45 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                  type="button"
                  onClick={() => toggleTaskExpand(group.taskId)}
                >
                  {isExpanded ? (
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold">
                      {group.taskId === "__unknown__"
                        ? "未关联任务"
                        : group.taskId}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {group.changes.length} 个文件 ·{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{group.totals.additions}
                      </span>{" "}
                      <span className="text-red-600 dark:text-red-400">
                        -{group.totals.deletions}
                      </span>
                    </p>
                  </div>
                </button>
                {isExpanded && (
                  <div className="divide-y border-t">
                    {group.changes.map((change) => (
                      <TaskChangeFileCard
                        key={changeKey(change)}
                        change={change}
                        expanded={expandedFiles.has(changeKey(change))}
                        registerRef={(element) => {
                          const key = changeKey(change);
                          if (element) {
                            fileCardRefs.current.set(key, element);
                          } else {
                            fileCardRefs.current.delete(key);
                          }
                        }}
                        selected={selectedFilePath === change.path}
                        onToggle={() => toggleFileExpand(change)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function TaskChangeFileCard({
  change,
  expanded,
  onToggle,
  registerRef,
  selected,
}: {
  change: QiongqiChange;
  expanded: boolean;
  selected: boolean;
  registerRef: (element: HTMLElement | null) => void;
  onToggle: () => void;
}) {
  const diffLines = useMemo(() => change.diff.split("\n"), [change.diff]);
  const isLongDiff = diffLines.length > COLLAPSED_DIFF_LINES;
  const visibleDiff =
    expanded || !isLongDiff
      ? change.diff
      : diffLines.slice(0, COLLAPSED_DIFF_LINES).join("\n");

  return (
    <article
      ref={registerRef}
      className={cn("scroll-mt-3 bg-background", selected && "bg-emerald-500/5")}
    >
      <button
        className="hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
        type="button"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDownIcon className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 shrink-0" />
        )}
        <FileDiffIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        <StatusBadge status={change.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">
          {change.path}
        </span>
        <span className="shrink-0 font-mono text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">
            +{change.additions}
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">
            -{change.deletions}
          </span>
        </span>
      </button>
      <UnifiedDiffBlock
        diffText={visibleDiff || "该文件没有可显示的任务 Diff。"}
      />
      {!expanded && isLongDiff && (
        <div className="bg-muted/20 border-t px-3 py-2">
          <button
            className="text-muted-foreground hover:text-foreground inline-flex text-xs transition-colors"
            type="button"
            onClick={onToggle}
          >
            仅显示前 {COLLAPSED_DIFF_LINES} 行，展开查看完整 Diff（
            {diffLines.length.toLocaleString()} 行）
          </button>
        </div>
      )}
    </article>
  );
}

function UnifiedDiffBlock({ diffText }: { diffText: string }) {
  return (
    <pre className="overflow-x-auto border-t p-3 font-mono text-xs leading-5 whitespace-pre">
      {diffText.split("\n").map((line, index) => (
        <div
          key={`${index}-${line.slice(0, 16)}`}
          className={cn(
            line.startsWith("+") &&
              !line.startsWith("+++") &&
              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            line.startsWith("-") &&
              !line.startsWith("---") &&
              "bg-red-500/10 text-red-700 dark:text-red-300",
            line.startsWith("@@") && "text-sky-600 dark:text-sky-300",
            (line.startsWith("diff --git ") ||
              line.startsWith("index ") ||
              line.startsWith("--- ") ||
              line.startsWith("+++ ")) &&
              "text-muted-foreground",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
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

function changeKey(change: QiongqiChange): string {
  return `${change.task_id || "__unknown__"}:${change.path}:${change.created_at}`;
}

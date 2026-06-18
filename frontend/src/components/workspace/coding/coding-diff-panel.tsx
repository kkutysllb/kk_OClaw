"use client";

import {
  AlertTriangleIcon,
  GitCompareIcon,
  PlusIcon,
  RefreshCwIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiscardProjectFileChange, useProjectDiff } from "@/core/projects";
import type { ProjectDiffFile } from "@/core/projects";
import { cn } from "@/lib/utils";

import {
  parseUnifiedDiffForSideBySide,
  SideBySideDiff,
} from "./diff-view";

interface CodingDiffPanelProps {
  projectId: string;
  selectedFilePath?: string | null;
  focusLine?: number | null;
}

// Cap the number of diff lines rendered in one go. Pathological diffs (lock
// files, generated code, large reformatting) can exceed 100k lines, and
// rendering every row in a single React pass creates hundreds of thousands
// of DOM nodes → renderer process OOM-killed (observed on a 121k-line / 5 MB
// diff in the packaged Electron build; dev survived only because it had not
// been tested against that project). 3k lines is plenty for humans to review;
// larger diffs are truncated with a notice pointing to `git diff`.
const MAX_DIFF_RENDER_LINES = 3000;

export function CodingDiffPanel({
  focusLine,
  projectId,
  selectedFilePath,
}: CodingDiffPanelProps) {
  const { diff, isLoading, isFetching, error, refetch } =
    useProjectDiff(projectId);
  const discardProjectFileChange = useDiscardProjectFileChange(projectId);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [diffScope, setDiffScope] = useState<"selected" | "all">("selected");
  const [diffViewMode, setDiffViewMode] = useState<"side-by-side" | "unified">(
    "side-by-side",
  );
  const files = diff?.files ?? [];
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  useEffect(() => {
    if (files.length === 0) {
      setSelectedDiffFile(null);
      return;
    }
    if (
      selectedFilePath &&
      files.some((file) => file.path === selectedFilePath)
    ) {
      setSelectedDiffFile(selectedFilePath);
      return;
    }
    if (
      !selectedDiffFile ||
      !files.some((file) => file.path === selectedDiffFile)
    ) {
      setSelectedDiffFile(files[0]?.path ?? null);
    }
  }, [files, selectedDiffFile, selectedFilePath]);

  const selectedFile =
    files.find((file) => file.path === selectedDiffFile) ?? null;
  const focusedDiffLine =
    focusLine && selectedFilePath === selectedDiffFile ? focusLine : null;
  const selectedWorkspaceFile =
    selectedFilePath && files.find((file) => file.path === selectedFilePath)
      ? selectedFilePath
      : null;
  const selectedWorkspaceFileHasNoDiff = Boolean(
    selectedFilePath && !selectedWorkspaceFile,
  );
  const filteredDiff = useMemo(
    () =>
      selectedFile?.diff ?? filterUnifiedDiff(diff?.diff ?? "", selectedFile),
    [diff?.diff, selectedFile],
  );
  const scopedDiffText =
    diffScope === "all" ? (diff?.diff ?? "") : filteredDiff;
  // Truncate pathologically large diffs before rendering (see
  // MAX_DIFF_RENDER_LINES). Both the side-by-side parser and the unified
  // renderer consume `displayDiffText`, so a single guard covers both modes.
  const diffLines = useMemo(() => scopedDiffText.split("\n"), [scopedDiffText]);
  const isDiffTruncated = diffLines.length > MAX_DIFF_RENDER_LINES;
  const displayDiffText = useMemo(
    () =>
      isDiffTruncated
        ? diffLines.slice(0, MAX_DIFF_RENDER_LINES).join("\n")
        : scopedDiffText,
    [diffLines, isDiffTruncated, scopedDiffText],
  );
  const sideBySideRows = useMemo(
    () => parseUnifiedDiffForSideBySide(displayDiffText),
    [displayDiffText],
  );
  const discardError =
    discardProjectFileChange.error instanceof Error
      ? discardProjectFileChange.error.message
      : null;

  const handleDiscardSelectedFile = () => {
    if (!selectedFile) return;
    const confirmed = window.confirm(
      `确认撤销 ${selectedFile.path} 的所有未提交变更？此操作不可自动恢复。`,
    );
    if (!confirmed) return;
    discardProjectFileChange.mutate(
      { path: selectedFile.path },
      {
        onSuccess: () => {
          void refetch();
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b px-4 py-2">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 space-y-2 border-r p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
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
      <EmptyDiffState
        title="无法加载变更"
        description={
          error instanceof Error ? error.message : "当前项目暂不支持 Diff。"
        }
      />
    );
  }

  if (diff && !diff.is_git_repo) {
    return (
      <EmptyDiffState
        title="当前项目不是 Git 仓库"
        description="Diff 对比需要 Git 作为修改前后的基线。请先把项目初始化为 Git 仓库，或后续使用非 Git 快照对比能力。"
      />
    );
  }

  if (!diff?.has_changes) {
    return (
      <EmptyDiffState
        title="暂无代码变更"
        description="Agent 修改文件后，这里会显示修改前后的对比。"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm leading-5 font-semibold">代码变更</p>
            <p className="text-muted-foreground truncate text-xs">
              {files.length} 个文件 ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                +{totalAdditions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                -{totalDeletions}
              </span>
            </p>
          </div>
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
          {isFetching && !isLoading && <span>正在刷新变更</span>}
          <Button
            className="h-7 w-7 p-0"
            disabled={isFetching}
            size="icon"
            title="刷新变更"
            type="button"
            variant="ghost"
            onClick={() => void refetch()}
          >
            <RefreshCwIcon
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-72 shrink-0 border-r">
          <div className="space-y-1 p-2">
            {selectedWorkspaceFileHasNoDiff && (
              <div className="text-muted-foreground border-b px-2 py-2 text-xs">
                当前文件暂无变更，已显示项目中的其他变更。
              </div>
            )}
            {files.map((file) => (
              <button
                key={file.path}
                className={cn(
                  "hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                  selectedDiffFile === file.path &&
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                )}
                type="button"
                onClick={() => setSelectedDiffFile(file.path)}
              >
                <StatusBadge status={file.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {file.path}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  +{file.additions} -{file.deletions}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-sm">
              {selectedFile?.path ?? "未选择文件"}
            </span>
            {selectedFile && <StatusBadge status={selectedFile.status} />}
            {diffScope === "selected" && selectedFile && (
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{selectedFile.additions}
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  -{selectedFile.deletions}
                </span>
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2 overflow-x-auto">
              <div className="bg-muted text-muted-foreground inline-flex h-8 shrink-0 items-center rounded-md p-1">
                <Button
                  className="h-6 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant={diffScope === "selected" ? "secondary" : "ghost"}
                  onClick={() => setDiffScope("selected")}
                >
                  当前文件
                </Button>
                <Button
                  className="h-6 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant={diffScope === "all" ? "secondary" : "ghost"}
                  onClick={() => setDiffScope("all")}
                >
                  全部变更
                </Button>
              </div>
              <div className="bg-muted text-muted-foreground inline-flex h-8 shrink-0 items-center rounded-md p-1">
                <Button
                  className="h-6 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant={
                    diffViewMode === "side-by-side" ? "secondary" : "ghost"
                  }
                  onClick={() => setDiffViewMode("side-by-side")}
                >
                  左右对比
                </Button>
                <Button
                  className="h-6 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant={diffViewMode === "unified" ? "secondary" : "ghost"}
                  onClick={() => setDiffViewMode("unified")}
                >
                  Unified
                </Button>
              </div>
              {diffScope === "selected" && selectedFile && (
                <Button
                  className="h-7 px-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                  disabled={discardProjectFileChange.isPending}
                  size="sm"
                  title="撤销此文件的未提交变更"
                  type="button"
                  variant="ghost"
                  onClick={handleDiscardSelectedFile}
                >
                  <Undo2Icon className="mr-1 h-3 w-3" />
                  {discardProjectFileChange.isPending ? "撤销中" : "撤销此文件"}
                </Button>
              )}
            </div>
          </div>
          {discardError && (
            <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-700 dark:text-red-300">
              {discardError}
            </div>
          )}
          {isDiffTruncated && (
            <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
              <span>
                Diff 过大（{diffLines.length.toLocaleString()} 行），为避免渲染崩溃仅显示前{" "}
                {MAX_DIFF_RENDER_LINES.toLocaleString()} 行。建议在左侧选择单个文件查看，或在终端运行{" "}
                <code className="font-mono">git diff</code> 查看完整内容。
              </span>
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {diffViewMode === "side-by-side" ? (
              <SideBySideDiff
                highlightedNewLine={focusedDiffLine}
                highlightedOldLine={focusedDiffLine}
                rows={sideBySideRows}
              />
            ) : (
              renderUnifiedDiff(displayDiffText, focusedDiffLine)
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function renderUnifiedDiff(diffText: string, highlightedUnifiedLine: number | null) {
  if (!diffText) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        该文件没有可显示的文本 Diff。
      </div>
    );
  }
  let newLineNumber = 0;
  return (
    <div className="min-w-[720px] p-4 font-mono text-xs leading-5">
      {diffText.split("\n").map((line, index) => {
        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
          newLineNumber = Number(hunk[1]);
        } else if (line.startsWith("+") && !line.startsWith("+++ ")) {
          newLineNumber += 1;
        } else if (!line.startsWith("-") || line.startsWith("--- ")) {
          if (
            !line.startsWith("diff --git ") &&
            !line.startsWith("index ") &&
            !line.startsWith("+++ ") &&
            !line.startsWith("--- ")
          ) {
            newLineNumber += 1;
          }
        }
        const lineNumber =
          line.startsWith("+") && !line.startsWith("+++ ")
            ? newLineNumber
            : line.startsWith(" ") || line === ""
              ? newLineNumber
              : null;
        const highlighted =
          highlightedUnifiedLine != null && lineNumber === highlightedUnifiedLine;
        return (
          <pre
            key={`${index}-${line}`}
            className={cn(
              "overflow-x-auto whitespace-pre px-2",
              line.startsWith("+") &&
                !line.startsWith("+++ ") &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.startsWith("-") &&
                !line.startsWith("--- ") &&
                "bg-red-500/10 text-red-700 dark:text-red-300",
              line.startsWith("@@") && "text-muted-foreground bg-muted/50",
              highlighted && "ring-1 ring-amber-500/60 bg-amber-500/10",
            )}
          >
            {line || " "}
          </pre>
        );
      })}
    </div>
  );
}

function EmptyDiffState({
  title,
  description,
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

function StatusBadge({ status }: { status: ProjectDiffFile["status"] }) {
  const label =
    status === "added"
      ? "新增"
      : status === "deleted"
        ? "删除"
        : status === "renamed"
          ? "重命名"
          : status === "copied"
            ? "复制"
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
      {status === "added" && <PlusIcon className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

function filterUnifiedDiff(diffText: string, file: ProjectDiffFile | null) {
  if (!file || !diffText) return diffText;
  const headers = [`diff --git a/${file.path} b/${file.path}`];
  if (file.previous_path) {
    headers.push(`diff --git a/${file.previous_path} b/${file.path}`);
  }

  const lines = diffText.split("\n");
  const chunks: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      collecting = headers.some((header) => line === header);
    }
    if (collecting) {
      chunks.push(line);
    }
  }
  return chunks.join("\n").trim();
}

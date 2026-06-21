"use client";

import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileTextIcon,
  GitBranchIcon,
  InfoIcon,
  RefreshCwIcon,
  Wand2Icon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApplyCodingReviewFix,
  useLatestCodingReview,
  useRunCodingReview,
} from "@/core/projects";
import type { CodingReviewFinding } from "@/core/projects";
import { cn } from "@/lib/utils";

interface ReviewPanelProps {
  projectId: string;
  projectRoot: string;
  threadId: string;
  onFocusFile?: (
    filePath: string,
    target?: "code" | "task-changes" | "diff",
    taskId?: string,
    line?: number | null,
  ) => void;
}

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircleIcon,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    label: "Critical",
  },
  major: {
    icon: AlertTriangleIcon,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    label: "Major",
  },
  minor: {
    icon: InfoIcon,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    label: "Minor",
  },
  nitpick: {
    icon: SparklesIcon,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    label: "Nitpick",
  },
} as const;

export function ReviewPanel({
  onFocusFile,
  projectId,
  projectRoot,
  threadId,
}: ReviewPanelProps) {
  const { review, isLoading, isFetching, error, refetch } =
    useLatestCodingReview(threadId);
  const runReview = useRunCodingReview();
  const applyFix = useApplyCodingReviewFix(projectId);
  const [findingSeverityFilter, setFindingSeverityFilter] = useState<
    "all" | keyof typeof SEVERITY_CONFIG
  >("all");
  const [expandedPatchFindingId, setExpandedPatchFindingId] = useState<
    string | null
  >(null);
  const pending = runReview.isPending;
  const currentReview = runReview.data ?? review;
  const prContext = getReviewPrContext(currentReview?.source);
  const filteredFindings = useMemo(() => {
    const findings = currentReview?.findings ?? [];
    if (findingSeverityFilter === "all") return findings;
    return findings.filter((finding) => finding.severity === findingSeverityFilter);
  }, [currentReview?.findings, findingSeverityFilter]);
  const reviewError =
    runReview.error instanceof Error
      ? runReview.error.message
      : error instanceof Error
        ? error.message
        : null;
  const applyFixError =
    applyFix.error instanceof Error ? applyFix.error.message : null;
  const applyFixSuccess = applyFix.isSuccess ? applyFix.data : null;

  const startReview = (scope: "project_diff" | "pr" = "project_diff") => {
    runReview.mutate({
      project_id: projectId,
      project_root: projectRoot,
      thread_id: threadId,
      scope,
      base_ref: undefined,
    });
  };

  const reviewSummary = currentReview?.summary ?? null;
  const hasBlockingIssue =
    (reviewSummary?.critical ?? 0) > 0 || (reviewSummary?.major ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheckIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm leading-5 font-semibold">Code Review</p>
            <p className="text-muted-foreground truncate text-xs">
              基于项目 Diff、任务变更和 Qiongqi 事件
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            className="h-7 w-7 p-0"
            disabled={isFetching || pending}
            size="icon"
            title="刷新审查结果"
            type="button"
            variant="ghost"
            onClick={() => void refetch()}
          >
            <RefreshCwIcon
              className={cn("h-3.5 w-3.5", (isFetching || pending) && "animate-spin")}
            />
          </Button>
          <Button
            className="h-7 px-2 text-xs"
            disabled={pending}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => startReview("pr")}
          >
            <GitBranchIcon className="mr-1 h-3 w-3" />
            PR 审查
          </Button>
          <Button
            className="h-7 px-2 text-xs"
            disabled={pending}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => startReview("project_diff")}
          >
            {pending ? "审查中..." : currentReview ? "重新审查" : "开始审查"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 p-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            {reviewError && (
              <ReviewErrorNotice
                action="运行 Code Review"
                endpoint="/api/coding/reviews"
                message={reviewError}
              />
            )}
            {applyFixError && (
              <ReviewErrorNotice
                action="应用自动修复"
                endpoint="/api/coding/reviews/fixes/apply"
                message={applyFixError}
              />
            )}
            {applyFixSuccess && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                自动修复已应用：{applyFixSuccess.file}
              </div>
            )}

            {!currentReview ? (
              <ReviewEmpty onStart={() => startReview("project_diff")} pending={pending} />
            ) : (
              <>
                {reviewSummary && (
                <div
                  className={cn(
                    "rounded-md border p-3",
                    hasBlockingIssue
                      ? "border-orange-500/30 bg-orange-500/5"
                      : "border-emerald-500/30 bg-emerald-500/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {hasBlockingIssue ? (
                      <AlertTriangleIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    ) : (
                      <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <p className="text-sm font-semibold">
                      {decisionLabel(currentReview.decision)}
                    </p>
                    <span className="text-muted-foreground ml-auto text-[11px]">
                      {formatTime(currentReview.created_at)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                    <Metric label="文件" value={reviewSummary.project_files} />
                    <Metric label="任务变更" value={reviewSummary.task_changes} />
                    <Metric label="事件" value={reviewSummary.qiongqi_events} />
                    <Metric
                      label={currentReview.scope === "pr" ? "提交" : "+ / -"}
                      value={
                        currentReview.scope === "pr"
                          ? reviewSummary.commits
                          : reviewSummary.additions + reviewSummary.deletions
                      }
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(["critical", "major", "minor", "nitpick"] as const).map(
                      (severity) => (
                        <SeverityBadge
                          key={severity}
                          severity={severity}
                          count={reviewSummary[severity]}
                        />
                      ),
                    )}
                  </div>
                </div>
                )}

                {currentReview.scope === "pr" && prContext && (
                  <ReviewPrContext context={prContext} />
                )}

                {currentReview.findings.length === 0 ? (
                  <div className="rounded-md border p-6 text-center">
                    <CheckCircle2Icon className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                    <p className="mt-2 text-sm font-medium">未发现阻塞问题</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      本轮确定性审查没有发现 critical/major 风险；合并前仍建议运行相关测试。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <FindingSeverityFilter
                      counts={reviewSummary}
                      value={findingSeverityFilter}
                      onChange={setFindingSeverityFilter}
                    />
                    {filteredFindings.length === 0 ? (
                      <div className="text-muted-foreground rounded-md border p-4 text-center text-xs">
                        当前筛选下没有 findings。
                      </div>
                    ) : filteredFindings.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        expandedPatch={expandedPatchFindingId === finding.id}
                        finding={finding}
                        onApplyFix={(findingId) =>
                          applyFix.mutate({
                            thread_id: threadId,
                            review_id: currentReview.review_id,
                            finding_id: findingId,
                          })
                        }
                        applyingFixId={
                          applyFix.isPending
                            ? applyFix.variables?.finding_id
                            : null
                        }
                        onFocusFile={onFocusFile}
                        onTogglePatch={() =>
                          setExpandedPatchFindingId((current) =>
                            current === finding.id ? null : finding.id,
                          )
                        }
                      />
                    ))}
                  </div>
                )}

              </>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ReviewErrorNotice({
  action,
  endpoint,
  message,
}: {
  action: string;
  endpoint: string;
  message: string;
}) {
  const likelyNetworkFailure = message.toLowerCase().includes("failed to fetch");
  return (
    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
      <p className="font-medium">{action}失败：{message}</p>
      <div className="mt-1.5 grid gap-1 text-[11px]">
        <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
          <span className="opacity-80">请求目标</span>
          <span className="truncate font-mono">{endpoint}</span>
        </div>
        {likelyNetworkFailure && (
          <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
            <span className="opacity-80">可能原因</span>
            <span>
              前端无法连接后端、Next rewrite 未命中、网关重启中，或浏览器拦截了请求。
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReviewPrContextData {
  base_ref: string;
  requested_base_ref?: string | null;
  merge_base: string;
  head: string;
  commits: Array<{ sha: string; subject: string }>;
}

function ReviewPrContext({ context }: { context: ReviewPrContextData }) {
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="text-muted-foreground h-3.5 w-3.5" />
        <p className="text-xs font-medium">PR 上下文</p>
        <Badge variant="outline" className="ml-auto rounded px-1.5 text-[10px]">
          {context.commits.length} commits
        </Badge>
      </div>
      <div className="mt-2 grid gap-1 text-[11px]">
        <ReviewKeyValue label="Base" value={context.base_ref} />
        {context.requested_base_ref &&
          context.requested_base_ref !== context.base_ref && (
            <ReviewKeyValue
              label="Requested"
              value={context.requested_base_ref}
            />
          )}
        <ReviewKeyValue label="Merge" value={context.merge_base.slice(0, 12)} />
        <ReviewKeyValue label="Head" value={context.head.slice(0, 12)} />
      </div>
      {context.commits.length > 0 && (
        <div className="mt-2 space-y-1">
          {context.commits.slice(0, 5).map((commit) => (
            <div
              key={commit.sha}
              className="bg-muted/40 grid grid-cols-[72px_minmax(0,1fr)] gap-2 rounded px-2 py-1 text-[11px]"
            >
              <span className="text-muted-foreground font-mono">
                {commit.sha.slice(0, 7)}
              </span>
              <span className="truncate">{commit.subject}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewKeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </div>
  );
}

function FindingSeverityFilter({
  counts,
  onChange,
  value,
}: {
  counts:
    | Record<keyof typeof SEVERITY_CONFIG, number>
    | null;
  value: "all" | keyof typeof SEVERITY_CONFIG;
  onChange: (value: "all" | keyof typeof SEVERITY_CONFIG) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <button
        className={cn(
          "rounded-md border px-2 py-1 text-[10px] font-medium",
          value === "all" && "bg-primary text-primary-foreground",
        )}
        type="button"
        onClick={() => onChange("all")}
      >
        全部
      </button>
      {(["critical", "major", "minor", "nitpick"] as const).map((severity) => (
        <button
          key={severity}
          className={cn(
            "rounded-md border px-2 py-1 text-[10px] font-medium",
            value === severity && "bg-primary text-primary-foreground",
          )}
          type="button"
          onClick={() => onChange(severity)}
        >
          {SEVERITY_CONFIG[severity].label} {counts?.[severity] ?? 0}
        </button>
      ))}
    </div>
  );
}

function ReviewEmpty({
  onStart,
  pending,
}: {
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="bg-muted flex size-12 items-center justify-center rounded-md">
        <ClipboardCheckIcon className="text-muted-foreground h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium">审查当前代码变更</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-5">
          读取项目 Diff、Qiongqi 任务变更和事件流，生成按严重级别排序的结构化 findings。
        </p>
      </div>
      <Button
        className="h-8 px-3 text-xs"
        disabled={pending}
        size="sm"
        type="button"
        onClick={onStart}
      >
        {pending ? "审查中..." : "开始审查"}
      </Button>
    </div>
  );
}

function FindingCard({
  expandedPatch,
  finding,
  applyingFixId,
  onApplyFix,
  onFocusFile,
  onTogglePatch,
}: {
  expandedPatch: boolean;
  finding: CodingReviewFinding;
  applyingFixId?: string | null;
  onApplyFix?: (findingId: string) => void;
  onFocusFile?: (
    filePath: string,
    target?: "code" | "task-changes" | "diff",
    taskId?: string,
    line?: number | null,
  ) => void;
  onTogglePatch?: () => void;
}) {
  const cfg = SEVERITY_CONFIG[finding.severity];
  const Icon = cfg.icon;
  const target = finding.task_id ? "task-changes" : "diff";
  const canApplyFix = finding.fix?.applicable && !finding.fix.applied;
  const isApplying = applyingFixId === finding.id;

  return (
    <div className={cn("rounded-md border p-3", cfg.border, cfg.bg)}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
        <span className={cn("text-xs font-semibold", cfg.color)}>
          {cfg.label}
        </span>
        <Badge variant="outline" className="rounded px-1.5 text-[10px]">
          {finding.category}
        </Badge>
        {finding.file && (
          <button
            className="text-muted-foreground hover:text-foreground ml-auto flex min-w-0 items-center gap-1 font-mono text-xs"
            type="button"
            onClick={() =>
              onFocusFile?.(
                finding.file!,
                target,
                finding.task_id ?? undefined,
                finding.line,
              )
            }
          >
            <FileTextIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {finding.file}
              {finding.line ? `:${finding.line}` : ""}
            </span>
          </button>
        )}
      </div>
      <p className="mt-2 text-sm leading-5">{finding.message}</p>
      <div className="bg-background/60 mt-2 rounded-md border px-2 py-1.5 text-xs leading-5">
        <span className="text-muted-foreground">建议：</span>
        {finding.suggestion}
      </div>
      {finding.fix?.applicable && (
        <div className="mt-2 space-y-2 rounded-md border bg-background/60 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate text-xs">
              {finding.fix.applied ? "已应用自动修复" : finding.fix.description}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {finding.fix.patch && (
                <Button
                  className="h-6 px-2 text-[10px]"
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={onTogglePatch}
                >
                  {expandedPatch ? (
                    <ChevronDownIcon className="mr-1 h-3 w-3" />
                  ) : (
                    <ChevronRightIcon className="mr-1 h-3 w-3" />
                  )}
                  Patch 预览
                </Button>
              )}
              <Button
                className="h-6 px-2 text-[10px]"
                disabled={!canApplyFix || isApplying}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => onApplyFix?.(finding.id)}
              >
                <Wand2Icon className="mr-1 h-3 w-3" />
                {isApplying ? "应用中" : finding.fix.applied ? "已应用" : "一键应用"}
              </Button>
            </div>
          </div>
          {expandedPatch && finding.fix.patch && (
            <pre className="bg-muted/50 max-h-48 overflow-auto rounded border p-2 font-mono text-[10px] leading-4 whitespace-pre">
              {finding.fix.patch}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({
  count,
  severity,
}: {
  severity: keyof typeof SEVERITY_CONFIG;
  count: number;
}) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("rounded px-1.5 text-[10px]", cfg.color)}>
      <Icon className="mr-1 h-3 w-3" />
      {cfg.label}: {count}
    </Badge>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background/50 p-2">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function decisionLabel(decision: string): string {
  if (decision === "request_changes") return "需要修改";
  if (decision === "needs_review") return "需要人工复核";
  return "未发现阻塞问题";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getReviewPrContext(
  source: Record<string, unknown> | undefined,
): ReviewPrContextData | null {
  const raw = source?.pr_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const context = raw as Record<string, unknown>;
  const commits = Array.isArray(context.commits)
    ? context.commits
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? {
                sha: stringValue((item as Record<string, unknown>).sha),
                subject: stringValue((item as Record<string, unknown>).subject),
              }
            : null,
        )
        .filter((item): item is { sha: string; subject: string } => Boolean(item?.sha))
    : [];
  return {
    base_ref: stringValue(context.base_ref),
    requested_base_ref:
      typeof context.requested_base_ref === "string"
        ? context.requested_base_ref
        : null,
    merge_base: stringValue(context.merge_base),
    head: stringValue(context.head),
    commits,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

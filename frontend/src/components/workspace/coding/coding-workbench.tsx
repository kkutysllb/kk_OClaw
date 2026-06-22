"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  CopyIcon,
  CloudIcon,
  GithubIcon,
  FileTextIcon,
  FilterIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitCommitHorizontalIcon,
  PackageOpenIcon,
  PanelLeftOpenIcon,
  PanelRightOpenIcon,
  PlusIcon,
  XIcon,
  ActivityIcon,
  GaugeIcon,
  InfoIcon,
  LoaderCircleIcon,
  SparklesIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  MonitorCogIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import {
  copyProjectTerminalPath,
  onEmbeddedTerminalData,
  onEmbeddedTerminalExit,
  openProjectTerminal,
  resizeEmbeddedTerminal,
  startEmbeddedTerminal,
  stopEmbeddedTerminal,
  writeEmbeddedTerminal,
} from "@/core/desktop";
import {
  ProjectFetchError,
  useAcceptStageSuggestion,
  useCodingRoiReports,
  useCodingRoiSummary,
  useCodingSession,
  useCodingSessionChanges,
  useCodingSessionEvents,
  useCodingSkills,
  useDeliveryStages,
  useDismissStageSuggestion,
  useLatestCodingReview,
  useProjectEnvironment,
  useProjectGitCommit,
  useProjectGitPush,
  useProjectStage,
  useProjectDiff,
  useSetCodingSkillEnabled,
  useSetProjectStage,
  useProject,
  useWorktrees,
} from "@/core/projects";
import type {
  CodingSkill,
  DeliveryStage,
  ProjectStageState,
  QiongqiChange,
  QiongqiEvent,
  QiongqiRoiReport,
  StageHistoryEntry,
  StageSuggestion,
} from "@/core/projects";
import { cn } from "@/lib/utils";

import { AgentPanel } from "./agent-panel";
import { CodeViewer } from "./code-viewer";
import { CodingDiffPanel } from "./coding-diff-panel";
import { CodingResultsPanel } from "./coding-results-panel";
import { CodingTaskChangesPanel } from "./coding-task-changes-panel";
import { FileExplorer } from "./file-explorer";
import { ReviewPanel } from "./review-panel";

interface CodingWorkbenchProps {
  projectId: string;
}

type WorkbenchFocusTarget = "code" | "task-changes" | "diff" | "review";
type WorkbenchFocusHandler = (
  filePath: string,
  target?: WorkbenchFocusTarget,
  taskId?: string,
  line?: number | null,
) => void;

type EmbeddedTerminalTab = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  promptLabel: string;
  running: boolean;
};

const LEFT_PANEL_DEFAULT_WIDTH = 320;
const LEFT_PANEL_MIN_WIDTH = 240;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_DEFAULT_WIDTH = 640;
const RIGHT_PANEL_MIN_WIDTH = 420;
const RIGHT_PANEL_MAX_WIDTH = 1120;

export function CodingWorkbench({ projectId }: CodingWorkbenchProps) {
  const router = useRouter();
  const { project, isLoading, error } = useProject(projectId);
  const { worktrees } = useWorktrees(projectId);
  const { diff } = useProjectDiff(projectId);
  const { environment } = useProjectEnvironment(projectId);
  const commitMutation = useProjectGitCommit(projectId);
  const pushMutation = useProjectGitPush(projectId);

  // If the project genuinely does not exist (HTTP 404 — typically because it
  // was deleted from another tab/session), bounce the user back to the list.
  // We deliberately only react to 404 and NOT to transient network/5xx errors,
  // so a flaky gateway doesn't kick users out of an otherwise valid project.
  useEffect(() => {
    if (!isLoading && project === null && error instanceof ProjectFetchError && error.status === 404) {
      toast.error("项目不存在或已被删除，已返回项目列表");
      router.replace("/workspace/coding");
    }
  }, [isLoading, project, error, router]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  // Persist the agent thread ID per-project so switching workspace tabs and
  // coming back can restore the correct thread. This mirrors the logic in
  // AgentPanelInner — both components read/write the same localStorage key so
  // the Results/Diff panels and the Agent chat panel stay in sync after a tab
  // switch without either having to re-derive the thread ID.
  const threadIdStorageKey = `coding:thread:${projectId}`;
  const [agentThreadId, setAgentThreadId] = useState<string | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      return window.localStorage.getItem(threadIdStorageKey) ?? undefined;
    },
  );
  useEffect(() => {
    if (agentThreadId) {
      window.localStorage.setItem(threadIdStorageKey, agentThreadId);
    } else {
      window.localStorage.removeItem(threadIdStorageKey);
    }
  }, [agentThreadId, threadIdStorageKey]);
  const codingThreadId = agentThreadId ?? projectId;
  const resultsThreadId = codingThreadId;
  const { changes: historicalChanges } = useCodingSessionChanges(codingThreadId);
  const { review } = useLatestCodingReview(codingThreadId);
  const reviewSummary = review?.summary;
  const taskChangeSummary = useMemo(
    () => ({
      additions: historicalChanges.reduce((sum, change) => sum + change.additions, 0),
      deletions: historicalChanges.reduce((sum, change) => sum + change.deletions, 0),
      changedFiles: new Set(historicalChanges.map((change) => change.path)).size,
    }),
    [historicalChanges],
  );
  const reviewChangeSummary = reviewSummary
    ? {
        additions: reviewSummary.additions,
        deletions: reviewSummary.deletions,
        changedFiles:
          reviewSummary.project_files > 0
            ? reviewSummary.project_files
            : reviewSummary.task_changes,
      }
    : {
        additions: 0,
        deletions: 0,
        changedFiles: 0,
      };
  const historicalChangeSummary = {
    additions: reviewChangeSummary.additions || taskChangeSummary.additions,
    deletions: reviewChangeSummary.deletions || taskChangeSummary.deletions,
    changedFiles: reviewChangeSummary.changedFiles || taskChangeSummary.changedFiles,
  };

  const [activeCodeTab, setActiveCodeTab] = useState<
    "code" | "task-changes" | "diff" | "results" | "review"
  >("code");
  const [workbenchView, setWorkbenchView] = useState<
    "code" | "task-changes" | "diff" | "results" | "review"
  >("code");
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    "agent" | "events" | "session" | "roi" | "workflow" | "skills"
  >("agent");
  const [isCommitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  // Collapse state for the left file explorer and the right workbench panel.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [environmentCardCollapsed, setEnvironmentCardCollapsed] =
    useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<EmbeddedTerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const terminalWritersRef = useRef(new Map<string, (data: string) => void>());

  useEffect(() => {
    const unsubscribeData = onEmbeddedTerminalData((event) => {
      terminalWritersRef.current.get(event.sessionId)?.(event.data);
    });
    const unsubscribeExit = onEmbeddedTerminalExit((event) => {
      terminalWritersRef.current.get(event.sessionId)?.(
        `\r\n[terminal exited: ${event.signal ?? event.code ?? "closed"}]\r\n`,
      );
      setTerminalTabs((tabs) =>
        tabs.map((tab) =>
          tab.id === event.sessionId
            ? { ...tab, running: false }
            : tab,
        ),
      );
    });
    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-semibold">项目未找到</p>
        <p className="text-muted-foreground text-sm">
          项目 ID &quot;{projectId}&quot; 不存在或已被删除。
        </p>
        <Link
          href="/workspace/coding"
          className="text-sm text-emerald-500 hover:underline"
        >
          ← 返回项目列表
        </Link>
      </div>
    );
  }

  const toggleLeft = () => {
    setLeftCollapsed((value) => !value);
  };

  const openWorkbenchPane = () => {
    setRightCollapsed(false);
  };

  const closeWorkbenchPane = () => {
    setRightCollapsed(true);
  };

  const showFileExplorer = !leftCollapsed;
  const showWorkbenchPane = !rightCollapsed;
  const showEnvironmentCard = !showWorkbenchPane && !environmentCardCollapsed;

  const startPanelResize = (
    side: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;
    const minWidth =
      side === "left" ? LEFT_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
    const maxWidth =
      side === "left" ? LEFT_PANEL_MAX_WIDTH : RIGHT_PANEL_MAX_WIDTH;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth =
        side === "left" ? startWidth + delta : startWidth - delta;
      const clampedWidth = Math.min(maxWidth, Math.max(minWidth, nextWidth));
      if (side === "left") {
        setLeftPanelWidth(clampedWidth);
      } else {
        setRightPanelWidth(clampedWidth);
      }
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  };

  const focusWorkbenchFile = (
    filePath: string,
    target: WorkbenchFocusTarget = "code",
    taskId?: string,
    line?: number | null,
  ) => {
    setSelectedFile(filePath);
    setFocusedLine(line ?? null);
    setActiveCodeTab(target);
    setWorkbenchView(target);
    openWorkbenchPane();
    if (taskId) {
      setSelectedTaskId(taskId);
    }
  };

  const handleSelectExplorerFile = (filePath: string) => {
    focusWorkbenchFile(filePath, "code");
  };

  const handleOpenTerminal = async () => {
    const result = await openProjectTerminal(project.path);
    if (result === "opened") {
      setTerminalOpen(true);
      const session = await startEmbeddedTerminal(project.path);
      if (!session) {
        toast.error("无法创建项目终端", {
          description: project.path,
        });
        return;
      }
      const nextTab: EmbeddedTerminalTab = {
        id: session.sessionId,
        title: session.projectName,
        cwd: session.cwd,
        shell: session.shell,
        promptLabel: session.promptLabel,
        running: true,
      };
      setTerminalTabs((tabs) => [...tabs, nextTab]);
      setActiveTerminalId(session.sessionId);
      return;
    }
    if (result === "copied") {
      toast.info("Web 端无法直接打开本机终端，已复制项目路径", {
        description: project.path,
      });
      return;
    }
    toast.error("无法打开本机终端", {
      description: project.path || "项目路径不可用",
    });
  };

  const handleCloseTerminalTab = async (sessionId: string) => {
    terminalWritersRef.current.delete(sessionId);
    await stopEmbeddedTerminal(sessionId);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.id !== sessionId);
      if (nextTabs.length === 0) {
        setTerminalOpen(false);
        setActiveTerminalId(null);
      } else if (activeTerminalId === sessionId) {
        setActiveTerminalId(nextTabs[nextTabs.length - 1]?.id ?? null);
      }
      return nextTabs;
    });
  };

  const handleCloseTerminalPanel = async () => {
    const sessions = terminalTabs.map((tab) => tab.id);
    setTerminalOpen(false);
    setTerminalTabs([]);
    setActiveTerminalId(null);
    await Promise.all(sessions.map((sessionId) => stopEmbeddedTerminal(sessionId)));
  };

  const handleCopyTerminalPath = async () => {
    const result = await copyProjectTerminalPath(project.path);
    if (result === "copied") {
      toast.success("已复制项目路径");
    } else {
      toast.error("复制项目路径失败");
    }
  };

  const handleToggleFileExplorer = () => {
    toggleLeft();
  };

  const handleToggleWorkbenchPane = () => {
    if (showWorkbenchPane) {
      closeWorkbenchPane();
      return;
    }
    openWorkbenchPane();
  };

  const handleSelectWorkbenchTab = (
    tab: "code" | "task-changes" | "diff" | "results" | "review",
  ) => {
    setActiveCodeTab(tab);
    setWorkbenchView(tab);
    if (tab !== "results") {
      openWorkbenchPane();
    }
  };

  const handleCommit = async () => {
    const message = commitMessage.trim();
    if (!message) {
      toast.error("请输入提交说明");
      return;
    }
    try {
      const result = await commitMutation.mutateAsync(message);
      toast.success("提交已创建", {
        description: result.summary,
      });
      setCommitDialogOpen(false);
      setCommitMessage("");
    } catch (commitError) {
      toast.error("提交失败", {
        description:
          commitError instanceof Error ? commitError.message : "请稍后重试",
      });
    }
  };

  const handlePush = async () => {
    try {
      const result = await pushMutation.mutateAsync();
      toast.success("分支已推送", {
        description: result.summary,
      });
    } catch (pushError) {
      toast.error("推送失败", {
        description:
          pushError instanceof Error ? pushError.message : "请稍后重试",
      });
    }
  };

  const gitBranch =
    environment?.branch ??
    worktrees.find((worktree) => worktree.branch)?.branch ??
    (project.is_git_repo ? "main" : "未连接");
  const diffAdditions = diff?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0;
  const diffDeletions = diff?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0;
  const environmentChangedFiles = environment?.changed_files ?? 0;
  const diffChangedFiles = diff?.files.length ?? 0;
  const totalAdditions =
    environment?.additions && environment.additions > 0
      ? environment.additions
      : diffAdditions > 0
        ? diffAdditions
        : historicalChangeSummary.additions;
  const totalDeletions =
    environment?.deletions && environment.deletions > 0
      ? environment.deletions
      : diffDeletions > 0
        ? diffDeletions
        : historicalChangeSummary.deletions;
  const totalChangedFiles =
    environmentChangedFiles || diffChangedFiles || historicalChangeSummary.changedFiles;

  return (
    <ArtifactsProvider>
      <div className="flex size-full min-h-0 flex-col">
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/workspace/coding"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              项目
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-semibold">{project.name}</span>
            {project.is_git_repo && (
              <div className="bg-muted text-muted-foreground flex items-center gap-1 rounded-md px-2 py-0.5 text-xs">
                <GitBranchIcon className="h-3 w-3" />
                {worktrees.length > 0
                  ? `${worktrees.length} worktree${worktrees.length > 1 ? "s" : ""}`
                  : "main"}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-muted-foreground hidden max-w-xs truncate font-mono text-xs sm:inline">
              {project.path}
            </span>
            <span className="text-muted-foreground hidden text-xs lg:inline">
              Ctrl+B 切换侧边栏
            </span>
          </div>
        </div>

        {/* Three-panel resizable layout */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b px-3"
            data-testid="coding-workbench-toolbar"
          >
            <div
              className="bg-muted text-muted-foreground mr-auto inline-flex h-8 w-fit shrink-0 items-center justify-center rounded-md p-1"
              role="tablist"
              aria-label="代码区视图"
            >
              <WorkbenchToolbarButton
                active={activeCodeTab === "code"}
                icon={<FileTextIcon className="h-3 w-3" />}
                label="代码"
                onClick={() => handleSelectWorkbenchTab("code")}
              />
              <WorkbenchToolbarButton
                active={activeCodeTab === "task-changes"}
                icon={<GitCompareIcon className="h-3 w-3" />}
                label="任务变更"
                onClick={() => handleSelectWorkbenchTab("task-changes")}
              />
              <WorkbenchToolbarButton
                active={activeCodeTab === "diff"}
                icon={<GitCompareIcon className="h-3 w-3" />}
                label="项目 Diff"
                onClick={() => handleSelectWorkbenchTab("diff")}
              />
              <WorkbenchToolbarButton
                active={activeCodeTab === "results"}
                icon={<PackageOpenIcon className="h-3 w-3" />}
                label="结果"
                onClick={() => handleSelectWorkbenchTab("results")}
              />
              <WorkbenchToolbarButton
                active={activeCodeTab === "review"}
                icon={<ClipboardCheckIcon className="h-3 w-3" />}
                label="Code Review"
                onClick={() => handleSelectWorkbenchTab("review")}
              />
            </div>
            <Button
              aria-label="切换环境信息面板"
              aria-pressed={showEnvironmentCard}
              className="size-8 shrink-0"
              size="icon-sm"
              title={showEnvironmentCard ? "折叠环境信息" : "展开环境信息"}
              type="button"
              variant="ghost"
              onClick={() => setEnvironmentCardCollapsed((value) => !value)}
            >
              <MonitorCogIcon className="h-4 w-4" />
            </Button>
            <Button
              aria-label="打开项目终端"
              className="size-8 shrink-0"
              size="icon-sm"
              title="打开项目终端"
              type="button"
              variant="ghost"
              onClick={() => void handleOpenTerminal()}
            >
              <TerminalIcon className="h-4 w-4" />
            </Button>
            <Button
              aria-label="新建项目终端"
              className="size-8 shrink-0"
              size="icon-sm"
              title="新建项目终端"
              type="button"
              variant="ghost"
              onClick={() => void handleOpenTerminal()}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              aria-label="切换文件树"
              aria-pressed={showFileExplorer}
              className="size-8 shrink-0"
              size="icon-sm"
              title="切换文件树"
              type="button"
              variant="ghost"
              onClick={handleToggleFileExplorer}
            >
              <PanelLeftOpenIcon className="h-4 w-4" />
            </Button>
            <Button
              aria-label="切换代码面板"
              aria-pressed={showWorkbenchPane}
              className="size-8 shrink-0"
              size="icon-sm"
              title="切换代码面板"
              type="button"
              variant="ghost"
              onClick={handleToggleWorkbenchPane}
            >
              <PanelRightOpenIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-0 flex min-h-0 flex-1 overflow-hidden">
            <div className="relative flex size-full min-w-0 overflow-hidden">
              <EnvironmentInfoFloatingCard
                additions={totalAdditions}
                deletions={totalDeletions}
                branch={gitBranch}
                githubCli={environment?.github_cli ?? null}
                sourceLabel={environment?.source.label ?? "仅本地"}
                sourceRemote={environment?.source.remote ?? null}
                head={environment?.head ?? null}
                ahead={environment?.ahead ?? 0}
                behind={environment?.behind ?? 0}
                changedFiles={totalChangedFiles}
                commitPending={commitMutation.isPending}
                pushPending={pushMutation.isPending}
                commitDisabled={!environment?.is_git_repo || (environment?.changed_files ?? 0) === 0}
                pushDisabled={!environment?.is_git_repo}
                onCommit={() => setCommitDialogOpen(true)}
                onPush={() => void handlePush()}
                path={project.path}
                visible={showEnvironmentCard}
              />
              {showFileExplorer && (
                <>
                  <aside
                    className="overflow-hidden border-r"
                    style={{ width: leftPanelWidth }}
                  >
                    <FileExplorer
                      projectId={projectId}
                      selectedFile={selectedFile}
                      onSelectFile={handleSelectExplorerFile}
                    />
                  </aside>
                  <PanelResizeHandle
                    ariaLabel="调整文件浏览器宽度"
                    onPointerDown={(event) =>
                      startPanelResize("left", event)
                    }
                  />
                </>
              )}
              {/* Middle: QiongQi Engine Agent Inspector */}
              <section className="min-w-0 flex-1">
                <div
                  className={cn(
                    "flex h-full min-h-0 flex-col transition-[padding] duration-200",
                    showEnvironmentCard && "2xl:pr-[360px] xl:pr-[340px]",
                  )}
                >
                  <AgentInspector
                    onFocusFile={focusWorkbenchFile}
                    projectRoot={project.path}
                    projectId={projectId}
                    threadId={codingThreadId}
                    selectedTaskId={selectedTaskId}
                    onThreadIdChange={setAgentThreadId}
                    activeTab={activeInspectorTab}
                    onActiveTabChange={setActiveInspectorTab}
                  />
                </div>
              </section>
              {/* Right: Code / Diff / Results / Review */}
              {showWorkbenchPane && (
                <>
                  <PanelResizeHandle
                    ariaLabel="调整代码面板宽度"
                    onPointerDown={(event) =>
                      startPanelResize("right", event)
                    }
                  />
                  <aside
                    data-testid="coding-workbench-right-panel"
                    className="overflow-hidden border-l"
                    style={{ width: rightPanelWidth }}
                  >
                    <div className="relative flex h-full min-h-0 flex-col">
                      {workbenchView === "code" && (
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodeViewer
                            projectId={projectId}
                            filePath={selectedFile}
                          />
                        </div>
                      )}
                      {workbenchView === "diff" && showWorkbenchPane && (
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodingDiffPanel
                            projectId={projectId}
                            selectedFilePath={selectedFile}
                            focusLine={focusedLine}
                          />
                        </div>
                      )}
                      {workbenchView === "task-changes" && showWorkbenchPane && (
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodingTaskChangesPanel
                            threadId={codingThreadId}
                            selectedFilePath={selectedFile}
                            highlightedTaskId={selectedTaskId}
                            onSelectTask={setSelectedTaskId}
                            onFocusFile={focusWorkbenchFile}
                          />
                        </div>
                      )}
                      {workbenchView === "results" && showWorkbenchPane && (
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodingResultsPanel threadId={resultsThreadId} />
                        </div>
                      )}
                      {workbenchView === "review" && showWorkbenchPane && (
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <ReviewPanel
                            projectId={projectId}
                            projectRoot={project.path}
                            threadId={codingThreadId}
                            onFocusFile={focusWorkbenchFile}
                          />
                        </div>
                      )}
                    </div>
                  </aside>
                </>
              )}
            </div>
          </div>
          {terminalOpen && (
            <EmbeddedTerminalTabsPanel
              activeId={activeTerminalId}
              tabs={terminalTabs}
              onActivate={setActiveTerminalId}
              onAdd={() => void handleOpenTerminal()}
              onClose={() => void handleCloseTerminalPanel()}
              onCloseTab={(sessionId) => void handleCloseTerminalTab(sessionId)}
              onCopyPath={() => void handleCopyTerminalPath()}
              onRegisterWriter={(sessionId, writer) => {
                terminalWritersRef.current.set(sessionId, writer);
              }}
              onResize={(sessionId, cols, rows) =>
                void resizeEmbeddedTerminal(sessionId, cols, rows)
              }
              onUnregisterWriter={(sessionId) => {
                terminalWritersRef.current.delete(sessionId);
              }}
              onWrite={(sessionId, data) =>
                void writeEmbeddedTerminal(sessionId, data)
              }
            />
          )}
        </div>
      </div>
      <Dialog open={isCommitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>提交更改</DialogTitle>
            <DialogDescription>
              这会基于当前项目的真实 Git 状态执行一次提交。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="coding-commit-message">
                提交说明
              </label>
              <Input
                id="coding-commit-message"
                value={commitMessage}
                placeholder="例如：refine coding workbench environment card"
                onChange={(event) => setCommitMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !commitMutation.isPending) {
                    event.preventDefault();
                    void handleCommit();
                  }
                }}
              />
            </div>
            <div className="bg-muted/50 rounded-md border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">当前分支</span>
                <span className="font-mono">{gitBranch}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCommitDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={commitMutation.isPending || !commitMessage.trim()}
              onClick={() => void handleCommit()}
            >
              {commitMutation.isPending ? (
                <LoaderCircleIcon className="h-4 w-4 animate-spin" />
              ) : (
                <GitCommitHorizontalIcon className="h-4 w-4" />
              )}
              提交更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ArtifactsProvider>
  );
}

function WorkbenchToolbarButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "hover:bg-background/60 hover:text-foreground",
      )}
      role="tab"
      title={label}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function EmbeddedTerminalTabsPanel({
  activeId,
  tabs,
  onActivate,
  onAdd,
  onClose,
  onCloseTab,
  onCopyPath,
  onRegisterWriter,
  onResize,
  onUnregisterWriter,
  onWrite,
}: {
  activeId: string | null;
  tabs: EmbeddedTerminalTab[];
  onActivate: (sessionId: string) => void;
  onAdd: () => void;
  onClose: () => void;
  onCloseTab: (sessionId: string) => void;
  onCopyPath: () => void;
  onRegisterWriter: (sessionId: string, writer: (data: string) => void) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onUnregisterWriter: (sessionId: string) => void;
  onWrite: (sessionId: string, data: string) => void;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;

  return (
    <section
      aria-label="项目终端"
      className="bg-background flex h-[30vh] min-h-[220px] shrink-0 flex-col border-t"
      data-testid="embedded-project-terminal"
    >
      <div className="bg-muted/40 flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={cn(
                "inline-flex h-7 max-w-[210px] shrink-0 items-center rounded-md text-xs transition-colors",
                activeTab?.id === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
              )}
              title={tab.cwd}
            >
              <button
                className="inline-flex h-full min-w-0 flex-1 items-center gap-1.5 px-2"
                type="button"
                onClick={() => onActivate(tab.id)}
              >
                <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tab.title || `终端 ${index + 1}`}</span>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    tab.running ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                />
              </button>
              <button
                aria-label={`关闭终端标签 ${index + 1}`}
                className="hover:bg-muted-foreground/10 mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded"
                title={`关闭终端 ${index + 1}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
          <Button
            aria-label="新建项目终端"
            className="size-7 shrink-0"
            size="icon-sm"
            title="新建项目终端"
            type="button"
            variant="ghost"
            onClick={onAdd}
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </div>
        {activeTab && (
          <span className="text-muted-foreground hidden max-w-[40vw] truncate font-mono text-xs lg:inline">
            {activeTab.cwd}
          </span>
        )}
        <Button
          aria-label="复制项目路径"
          className="size-7"
          size="icon-sm"
          title="复制项目路径"
          type="button"
          variant="ghost"
          onClick={onCopyPath}
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label="关闭终端面板"
          className="size-7"
          size="icon-sm"
          title="关闭终端面板"
          type="button"
          variant="ghost"
          onClick={onClose}
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="bg-background min-h-0 flex-1 overflow-hidden">
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <EmbeddedXtermViewport
              key={tab.id}
              active={activeTab?.id === tab.id}
              tab={tab}
              onRegisterWriter={onRegisterWriter}
              onResize={onResize}
              onUnregisterWriter={onUnregisterWriter}
              onWrite={onWrite}
            />
          ))
        ) : (
          <span className="text-muted-foreground">点击 + 新建项目终端</span>
        )}
      </div>
    </section>
  );
}

function EmbeddedXtermViewport({
  active,
  tab,
  onRegisterWriter,
  onResize,
  onUnregisterWriter,
  onWrite,
}: {
  active: boolean;
  tab: EmbeddedTerminalTab;
  onRegisterWriter: (sessionId: string, writer: (data: string) => void) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onUnregisterWriter: (sessionId: string) => void;
  onWrite: (sessionId: string, data: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { resolvedTheme } = useTheme();

  // Keep callback props in refs so the terminal-creation effect only
  // re-runs when `tab.id` changes — not on every parent re-render
  // (which would dispose the terminal and lose all screen content).
  const onRegisterWriterRef = useRef(onRegisterWriter);
  onRegisterWriterRef.current = onRegisterWriter;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onUnregisterWriterRef = useRef(onUnregisterWriter);
  onUnregisterWriterRef.current = onUnregisterWriter;
  const onWriteRef = useRef(onWrite);
  onWriteRef.current = onWrite;

  /** Read the actual computed CSS custom-property value at runtime. */
  const readCssVar = (name: string): string => {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  };

  const getTerminalTheme = () => ({
    background: readCssVar("--background") || "#0a0a0a",
    foreground: readCssVar("--foreground") || "#fafafa",
    cursor: readCssVar("--foreground") || "#fafafa",
    selectionBackground: readCssVar("--muted") || "#333333",
  });

  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;

    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: getTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    onResizeRef.current(tab.id, terminal.cols, terminal.rows);
    terminal.focus();

    const dataDisposable = terminal.onData((data) => onWriteRef.current(tab.id, data));
    onRegisterWriterRef.current(tab.id, (data: string) => terminal.write(data));

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      onResizeRef.current(tab.id, terminal.cols, terminal.rows);
    });
    observer.observe(host);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      onUnregisterWriterRef.current(tab.id);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [tab.id]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      fitAddonRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal) {
        onResizeRef.current(tab.id, terminal.cols, terminal.rows);
        terminal.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, tab.id]);

  // React to theme changes so the terminal background/foreground stays in
  // sync with the app theme without requiring a terminal restart.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme();
  }, [resolvedTheme]);

  return (
    <div
      className={cn("size-full p-2", !active && "hidden")}
      data-testid="embedded-project-terminal-viewport"
      ref={viewportRef}
    />
  );
}

function PanelResizeHandle({
  ariaLabel,
  onPointerDown,
}: {
  ariaLabel: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="group relative z-10 h-full w-2 shrink-0 cursor-col-resize touch-none"
      role="separator"
      tabIndex={0}
      onPointerDown={onPointerDown}
    >
      <div className="bg-border group-hover:bg-primary/60 absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors" />
    </div>
  );
}

function AgentInspector({
  activeTab,
  onActiveTabChange,
  onFocusFile,
  onThreadIdChange,
  projectId,
  projectRoot,
  threadId,
  selectedTaskId,
}: {
  activeTab: "agent" | "events" | "session" | "roi" | "workflow" | "skills";
  onActiveTabChange: (tab: "agent" | "events" | "session" | "roi" | "workflow" | "skills") => void;
  onFocusFile?: WorkbenchFocusHandler;
  projectId: string;
  projectRoot: string;
  threadId: string;
  selectedTaskId?: string | null;
  onThreadIdChange?: (threadId: string | undefined) => void;
}) {
  return (
    <div className="bg-background flex h-full min-h-0 flex-col border-l">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-wide uppercase">
            QiongQi Engine Agent Inspector（穷奇引擎智能体检查器）
          </p>
        </div>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          onActiveTabChange(value as "agent" | "events" | "session" | "roi" | "workflow" | "skills")
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid h-8 shrink-0 grid-cols-6">
          <TabsTrigger value="agent" className="px-2 text-xs" title="对话">
            <MessageSquareIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">对话</span>
          </TabsTrigger>
          <TabsTrigger value="events" className="px-2 text-xs" title="事件">
            <ActivityIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">事件</span>
          </TabsTrigger>
          <TabsTrigger value="session" className="px-2 text-xs" title="Session">
            <InfoIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">Session</span>
          </TabsTrigger>
          <TabsTrigger value="roi" className="px-2 text-xs" title="ROI">
            <GaugeIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">ROI</span>
          </TabsTrigger>
          <TabsTrigger value="workflow" className="px-2 text-xs" title="Workflow">
            <GitCompareIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">流程</span>
          </TabsTrigger>
          <TabsTrigger value="skills" className="px-2 text-xs" title="Skills">
            <SparklesIcon className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">Skills</span>
          </TabsTrigger>
        </TabsList>
        <div className="relative mt-0 min-h-0 flex-1 overflow-hidden">
          <PersistentInspectorPanel active={activeTab === "agent"}>
            <AgentPanel
              projectId={projectId}
              onFocusFile={onFocusFile}
              onThreadIdChange={onThreadIdChange}
            />
          </PersistentInspectorPanel>
          <PersistentInspectorPanel active={activeTab === "events"}>
            <CodingEventsInspector
              threadId={threadId}
              onFocusFile={onFocusFile}
              selectedTaskId={selectedTaskId}
            />
          </PersistentInspectorPanel>
          <PersistentInspectorPanel active={activeTab === "session"}>
            <CodingSessionInspector threadId={threadId} />
          </PersistentInspectorPanel>
          <PersistentInspectorPanel active={activeTab === "roi"}>
            <CodingRoiInspector threadId={threadId} />
          </PersistentInspectorPanel>
          <PersistentInspectorPanel active={activeTab === "workflow"}>
            <CodingWorkflowInspector projectRoot={projectRoot} threadId={threadId} />
          </PersistentInspectorPanel>
          <PersistentInspectorPanel active={activeTab === "skills"}>
            <CodingSkillsInspector projectRoot={projectRoot} />
          </PersistentInspectorPanel>
        </div>
      </Tabs>
    </div>
  );
}

function EnvironmentInfoFloatingCard({
  additions,
  ahead,
  branch,
  changedFiles,
  commitDisabled,
  commitPending,
  deletions,
  githubCli,
  head,
  onCommit,
  onPush,
  path,
  pushDisabled,
  pushPending,
  sourceLabel,
  sourceRemote,
  behind,
  visible,
}: {
  additions: number;
  ahead: number;
  branch: string;
  changedFiles: number;
  commitDisabled: boolean;
  commitPending: boolean;
  deletions: number;
  githubCli: {
    available: boolean;
    authenticated: boolean;
    username: string | null;
    host: string | null;
    detail: string | null;
  } | null;
  head: string | null;
  onCommit: () => void;
  onPush: () => void;
  path: string;
  pushDisabled: boolean;
  pushPending: boolean;
  sourceLabel: string;
  sourceRemote: string | null;
  behind: number;
  visible: boolean;
}) {
  const githubConnected = githubCli?.available && githubCli?.authenticated;
  const githubLabel = githubConnected
    ? `${githubCli?.username ?? "已登录"} @ ${githubCli?.host ?? "github.com"}`
    : githubCli?.detail ?? "GitHub CLI 未连接";

  return (
    <div
      className={cn(
        "absolute right-3 top-3 z-20 w-[320px] max-w-[calc(100%-1.5rem)] rounded-2xl border bg-background/96 p-3 shadow-xl backdrop-blur transition-all",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
            环境信息
          </p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{branch}</p>
            <Badge variant="secondary" className="h-5 rounded-sm px-1.5 font-mono text-[10px]">
              {changedFiles} files
            </Badge>
          </div>
        </div>
        <div className="bg-muted/70 flex size-8 items-center justify-center rounded-xl border">
          <MonitorCogIcon className="text-muted-foreground h-4 w-4" />
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <InfoMetricTile
            label="变更"
            value={
              <span className="font-mono text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>{" "}
                <span className="text-red-600 dark:text-red-400">-{deletions}</span>
              </span>
            }
          />
          <InfoMetricTile
            label="同步"
            value={
              <span className="font-mono text-xs text-muted-foreground">
                ↑{ahead} ↓{behind}
              </span>
            }
          />
        </div>

        <div className="rounded-xl border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.08em]">
              GitHub CLI
            </span>
            <Badge
              variant={githubConnected ? "default" : "secondary"}
              className="rounded-sm px-1.5 text-[10px]"
            >
              {githubConnected ? "已连接" : "未连接"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-lg border",
                githubConnected ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground",
              )}
            >
              <GithubIcon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{githubLabel}</p>
              <p className="text-muted-foreground truncate text-[11px]">
                {head ? `HEAD ${head.slice(0, 8)}` : "未检测到 HEAD"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.08em]">
              来源
            </span>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <CloudIcon className="h-3 w-3" />
              {sourceLabel}
            </div>
          </div>
          <p className="truncate text-xs font-medium">{path}</p>
          <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
            {sourceRemote ?? "当前项目未配置远程仓库"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-start gap-2 rounded-xl"
            disabled={commitDisabled || commitPending}
            onClick={onCommit}
          >
            {commitPending ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitCommitHorizontalIcon className="h-3.5 w-3.5" />
            )}
            提交更改
          </Button>
          <Button
            type="button"
            size="sm"
            className="justify-start gap-2 rounded-xl"
            disabled={pushDisabled || pushPending}
            onClick={onPush}
          >
            {pushPending ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendIcon className="h-3.5 w-3.5" />
            )}
            推送分支
          </Button>
        </div>
      </div>
    </div>
  );
}

function InfoMetricTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/40 px-3 py-2">
      <p className="text-muted-foreground text-[11px] uppercase tracking-[0.08em]">
        {label}
      </p>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function PersistentInspectorPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 min-h-0 overflow-hidden",
        active ? "block" : "pointer-events-none hidden",
      )}
    >
      {children}
    </div>
  );
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  session_started: "会话",
  task_started: "任务",
  plan_updated: "计划",
  tool_policy_decided: "策略",
  file_changed: "文件",
  diff_summarized: "Diff",
  roi_reported: "ROI",
  task_completed: "完成",
};

function CodingEventsInspector({
  onFocusFile,
  selectedTaskId,
  threadId,
}: {
  threadId: string;
  onFocusFile?: WorkbenchFocusHandler;
  selectedTaskId?: string | null;
}) {
  const { events, isLoading, isFetching, error, refetch } =
    useCodingSessionEvents(threadId);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [groupByTask, setGroupByTask] = useState(false);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void refetch(), 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  // Available event types from current data
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of events) types.add(event.event_type);
    return Array.from(types).sort();
  }, [events]);

  // Filter + optionally group
  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (selectedTypes.size > 0) {
      filtered = filtered.filter((e) => selectedTypes.has(e.event_type));
    }
    return filtered.slice().reverse();
  }, [events, selectedTypes]);

  const taskGroups = useMemo(() => {
    if (!groupByTask) return null;
    const groups = new Map<string, QiongqiEvent[]>();
    for (const event of filteredEvents) {
      const taskId =
        typeof event.payload.task_id === "string"
          ? event.payload.task_id
          : "__unknown__";
      if (!groups.has(taskId)) groups.set(taskId, []);
      groups.get(taskId)!.push(event);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) =>
        a === "__unknown__" ? 1 : b === "__unknown__" ? -1 : a.localeCompare(b),
      );
  }, [filteredEvents, groupByTask]);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <InspectorSection
      title="事件流"
      meta={`${filteredEvents.length} 条${selectedTypes.size > 0 ? ` (已过滤)` : ""}`}
      isFetching={isFetching}
      onRefresh={() => void refetch()}
      action={
        <button
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-[10px] font-medium transition-colors",
            autoRefresh && "text-emerald-600 dark:text-emerald-400",
          )}
          type="button"
          onClick={() => setAutoRefresh((v) => !v)}
        >
          <RefreshCwIcon
            className={cn("h-3 w-3", autoRefresh && "animate-spin")}
          />
          自动刷新
        </button>
      }
    >
      {isLoading ? (
        <InspectorSkeleton rows={5} />
      ) : error ? (
        <InspectorError message={getErrorMessage(error)} />
      ) : events.length === 0 ? (
        <InspectorEmpty
          title="暂无事件"
          description="Agent 运行后会记录任务、工具、ROI 和文件变更事件。"
        />
      ) : (
        <div className="flex min-h-0 flex-col">
          {/* Filter chips + group toggle */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <FilterIcon className="text-muted-foreground h-3 w-3 shrink-0" />
            {availableTypes.map((type) => {
              const active = selectedTypes.size === 0 || selectedTypes.has(type);
              return (
                <button
                  key={type}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground opacity-60",
                  )}
                  type="button"
                  onClick={() => toggleType(type)}
                >
                  {EVENT_TYPE_LABELS[type] ?? type}
                </button>
              );
            })}
            <button
              className={cn(
                "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                groupByTask && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
              )}
              type="button"
              onClick={() => setGroupByTask((v) => !v)}
            >
              按 Task
            </button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {taskGroups
                ? taskGroups.map(([taskId, taskEvents]) => (
                    <TaskGroup
                      key={taskId}
                      taskId={taskId}
                      events={taskEvents}
                      onFocusFile={onFocusFile}
                      selectedTaskId={selectedTaskId}
                    />
                  ))
                : filteredEvents.map((event) => (
                    <EventRow
                      key={event.seq}
                      event={event}
                      onFocusFile={onFocusFile}
                      selectedTaskId={selectedTaskId}
                    />
                  ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </InspectorSection>
  );
}

function TaskGroup({
  events,
  onFocusFile,
  selectedTaskId,
  taskId,
}: {
  events: QiongqiEvent[];
  onFocusFile?: WorkbenchFocusHandler;
  selectedTaskId?: string | null;
  taskId: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const isHighlighted = selectedTaskId === taskId;

  return (
    <div>
      <button
        className={cn(
          "hover:bg-muted/60 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          isHighlighted && "ring-1 ring-emerald-500/30 bg-emerald-500/10",
        )}
        type="button"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
          {taskId === "__unknown__" ? "未关联任务" : taskId}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {events.length} 事件
        </span>
      </button>
      {expanded && (
        <div className="ml-3 space-y-1.5 border-l-2 border-muted pl-2">
          {events.map((event) => (
            <EventRow
              key={event.seq}
              event={event}
              onFocusFile={onFocusFile}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  onFocusFile,
  selectedTaskId,
}: {
  event: QiongqiEvent;
  onFocusFile?: WorkbenchFocusHandler;
  selectedTaskId?: string | null;
}) {
  const focusTarget = getEventFocusTarget(event);

  return (
    <div className={cn("rounded-md border p-2", focusTarget?.taskId && focusTarget.taskId === selectedTaskId && "ring-1 ring-emerald-500/30 bg-emerald-500/10")}>
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className="rounded px-1.5 font-mono text-[10px]"
        >
          #{event.seq}
        </Badge>
        <span className="text-muted-foreground truncate text-[11px]">
          {formatCompactDate(event.created_at)}
        </span>
      </div>
      <p className="mt-1 truncate text-xs font-medium">
        {formatEventType(event.event_type)}
      </p>
      <pre className="text-muted-foreground mt-1 line-clamp-3 overflow-hidden font-mono text-[11px] whitespace-pre-wrap">
        {formatJsonPreview(event.payload)}
      </pre>
      {focusTarget && onFocusFile && (
        <Button
          className="mt-2 h-7 w-full justify-start px-2 text-xs"
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => onFocusFile(focusTarget.path, focusTarget.target, focusTarget.taskId)}
        >
          <FileTextIcon className="h-3.5 w-3.5" />
          定位 {focusTarget.target === "diff" ? "变更" : "文件"}
        </Button>
      )}
    </div>
  );
}

function CodingSessionInspector({ threadId }: { threadId: string }) {
  const { session, isLoading, isFetching, error, refetch } =
    useCodingSession(threadId);
  const { changes } = useCodingSessionChanges(threadId);
  const [expandedRawSession, setExpandedRawSession] = useState(false);
  const changeSummary = useMemo(
    () => session?.change_summary ?? {},
    [session?.change_summary],
  );
  const changeSummaryFromChanges = useMemo(
    () => buildChangeSummaryFromChanges(changes),
    [changes],
  );
  const effectiveChangeSummary = useMemo(
    () => mergeChangeSummary(changeSummary, changeSummaryFromChanges),
    [changeSummary, changeSummaryFromChanges],
  );
  const changedFiles = getNumberValue(effectiveChangeSummary, "changed_files");
  const additions = getNumberValue(effectiveChangeSummary, "additions");
  const deletions = getNumberValue(effectiveChangeSummary, "deletions");
  const currentTask = getCurrentTaskLabel(effectiveChangeSummary);
  const roi = session?.roi ?? {};
  const providerUsage = getRecordValue(roi, "provider_usage");
  const tokenTotal = getNumberValue(providerUsage, "total_tokens");
  const toolPolicyCount = session?.tool_policy.length ?? 0;

  return (
    <InspectorSection
      title="运行概览"
      meta={
        session?.updated_at
          ? `更新 ${formatCompactDate(session.updated_at)}`
          : undefined
      }
      isFetching={isFetching}
      onRefresh={() => void refetch()}
    >
      {isLoading ? (
        <InspectorSkeleton rows={4} />
      ) : error ? (
        <InspectorError message={getErrorMessage(error)} />
      ) : !session ? (
        <InspectorEmpty
          title="暂无 Session"
          description="Agent 首次运行后会生成 Qiongqi session 状态。"
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            <MetricGrid
              items={[
                ["Skills", session.skills.length, "发现的 Coding skills"],
                [
                  "Active",
                  session.active_coding_skills.length,
                  "本轮激活的 Coding skills",
                ],
                ["Tools", toolPolicyCount, "当前工具策略条目"],
                ["Tokens", tokenTotal, "当前 ROI provider usage 总 token"],
              ]}
            />

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">运行边界</p>
              <KeyValueRow label="Thread" value={session.thread_id} />
              <KeyValueRow
                label="Project"
                value={session.project_root ?? "未绑定项目路径"}
              />
              <KeyValueRow
                label="Scratch"
                value={session.scratch_root ?? "未创建 scratch workspace"}
              />
            </div>

            <MetricGrid
              items={[
                ["Files", changedFiles, "本 session 记录的文件变更数"],
                ["Additions", additions, "新增行数"],
                ["Deletions", deletions, "删除行数"],
                ["+ / -", additions + deletions, "新增与删除行合计"],
              ]}
            />

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">当前任务</p>
              <p className="text-muted-foreground text-xs leading-5">
                {currentTask}
              </p>
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">变更摘要</p>
              {Object.keys(effectiveChangeSummary).length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  暂无任务变更摘要。
                </p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(effectiveChangeSummary).slice(0, 6).map(([key, value]) => (
                    <KeyValueRow
                      key={key}
                      label={key}
                      value={formatInspectorValue(value)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">活跃技能</p>
              {session.active_coding_skills.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  当前 session 未激活 Coding skill。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {session.active_coding_skills.map((skill, index) => (
                    <Badge
                      key={`${formatInspectorValue(skill.id ?? index)}-${index}`}
                      variant="secondary"
                      className="rounded px-1.5 text-[10px]"
                    >
                      {formatInspectorValue(skill.name ?? skill.id ?? "skill")}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">工具策略</p>
              {session.tool_policy.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  当前 session 没有工具限制策略。
                </p>
              ) : (
                <div className="space-y-1">
                  {session.tool_policy.slice(0, 5).map((policy, index) => (
                    <div
                      key={`${formatInspectorValue(policy.id ?? index)}-${index}`}
                      className="bg-muted/40 rounded px-2 py-1"
                    >
                      <p className="truncate text-xs font-medium">
                        {formatInspectorValue(policy.id ?? policy.name ?? `policy-${index + 1}`)}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                        {formatToolPolicySummary(policy)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">ROI 摘要</p>
              {Object.keys(roi).length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  暂无 ROI 摘要。
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Total" value={tokenTotal} />
                  <MiniStat
                    label="Input"
                    value={getNumberValue(providerUsage, "input_tokens")}
                  />
                  <MiniStat
                    label="Output"
                    value={getNumberValue(providerUsage, "output_tokens")}
                  />
                  <MiniStat
                    label="Hidden tools"
                    value={getNumberValue(roi, "hidden_tool_count")}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <button
                className="hover:bg-muted/60 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-medium"
                type="button"
                onClick={() => setExpandedRawSession((value) => !value)}
              >
                {expandedRawSession ? (
                  <ChevronDownIcon className="h-3 w-3" />
                ) : (
                  <ChevronRightIcon className="h-3 w-3" />
                )}
                原始 Session
              </button>
              {expandedRawSession && (
                <pre className="text-muted-foreground max-h-44 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
                  {formatJsonPreview({
                    tool_policy: session.tool_policy,
                    change_summary: effectiveChangeSummary,
                    roi: session.roi,
                  })}
                </pre>
              )}
            </div>
          </div>
        </ScrollArea>
      )}
    </InspectorSection>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/40 rounded px-2 py-1.5">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className="mt-0.5 font-mono text-xs font-semibold">
        {formatNumber(value)}
      </p>
    </div>
  );
}

function CodingRoiInspector({ threadId }: { threadId: string }) {
  const { summary, isLoading, isFetching, error, refetch } =
    useCodingRoiSummary(threadId);
  const { reports } = useCodingRoiReports(threadId);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const derived = summary?.derived;
  const actualTokens = derived?.actual_tokens ?? summary?.provider_usage.total_tokens ?? 0;
  const estimatedSavedTokens = derived?.estimated_saved_tokens ?? 0;
  const estimatedBaselineTokens =
    derived?.estimated_baseline_tokens ?? actualTokens + estimatedSavedTokens;
  const savingRatio = derived?.saving_ratio ?? 0;
  const roiHasSavings =
    estimatedSavedTokens > 0 ||
    (summary?.tool_output.externalized_chars ?? 0) > 0 ||
    (summary?.token_economy.compressed_chars_saved ?? 0) > 0 ||
    (summary?.latest?.hidden_tool_count ?? 0) > 0;

  return (
    <InspectorSection
      title="ROI"
      meta={summary ? `${summary.report_count} 次报告` : undefined}
      isFetching={isFetching}
      onRefresh={() => void refetch()}
    >
      {isLoading ? (
        <InspectorSkeleton rows={4} />
      ) : error ? (
        <InspectorError message={getErrorMessage(error)} />
      ) : !summary || summary.report_count === 0 ? (
        <InspectorEmpty
          title="暂无 ROI 数据"
          description="Agent 完成 ROI 记录后会显示 token、工具目录和压缩收益。"
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            <div className="rounded-md border bg-muted/10 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_128px]">
                <div className="grid grid-cols-2 gap-2">
                  <RoiHeroMetric
                    label="估算节省"
                    value={formatCompactNumber(estimatedSavedTokens)}
                    detail={`${formatPercent(savingRatio)} 节省率`}
                  />
                  <RoiHeroMetric
                    label="实际成本"
                    value={formatCompactNumber(actualTokens)}
                    detail={`${summary.report_count} 次模型调用报告`}
                  />
                  <RoiHeroMetric
                    label="估算基线"
                    value={formatCompactNumber(estimatedBaselineTokens)}
                    detail="未启用 ROI 优化的估算 token"
                  />
                  <RoiHeroMetric
                    label="隐藏率"
                    value={formatPercent(derived?.tool_hidden_ratio ?? 0)}
                    detail={`${summary.latest?.hidden_tool_count ?? 0} 个隐藏工具`}
                  />
                </div>
                <RoiSavingsDonut ratio={savingRatio} />
              </div>
              {!roiHasSavings && (
                <p className="text-muted-foreground mt-3 rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-4">
                  历史报告保存了 token 成本，但没有保存工具裁剪、输出外部化或压缩计数；后续任务会从运行消息中持续采集这些收益项。
                </p>
              )}
            </div>
            {reports.length > 1 && <RoiTrendSparkline reports={reports} />}
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">收益构成</p>
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {formatCompactNumber(estimatedSavedTokens)}
                  </span>
                </div>
                <RoiContributionBars
                  items={[
                    {
                      label: "工具裁剪",
                      value: derived?.tool_catalog_saved_tokens ?? 0,
                      tone: "emerald",
                    },
                    {
                      label: "输出外部化",
                      value: derived?.tool_output_saved_tokens ?? 0,
                      tone: "cyan",
                    },
                    {
                      label: "上下文压缩",
                      value: derived?.token_economy_saved_tokens ?? 0,
                      tone: "amber",
                    },
                  ]}
                />
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">成本明细</p>
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {formatCompactNumber(summary.provider_usage.total_tokens ?? 0)}
                  </span>
                </div>
                <RoiCostBreakdown
                  input={summary.provider_usage.input_tokens ?? 0}
                  output={summary.provider_usage.output_tokens ?? 0}
                />
              </div>
            </div>
            {/* Report history */}
            {reports.length > 0 && (
              <div className="space-y-1 rounded-md border p-2">
                <p className="text-xs font-medium">报告历史</p>
                {reports.slice().reverse().slice(0, 8).map((report) => (
                  <div key={report.seq} className="space-y-0.5">
                    <button
                      className="hover:bg-muted/60 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs"
                      type="button"
                      onClick={() =>
                        setExpandedReport(
                          expandedReport === report.seq ? null : report.seq,
                        )
                      }
                    >
                      {expandedReport === report.seq ? (
                        <ChevronDownIcon className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRightIcon className="h-3 w-3 shrink-0" />
                      )}
                      <span className="font-mono text-[10px]">#{report.seq}</span>
                      <span className="text-muted-foreground">
                        {formatCompactDate(report.created_at)}
                      </span>
                      <span className="text-muted-foreground ml-auto text-[10px]">
                        T:{report.provider_usage?.total_tokens ?? "-"}
                      </span>
                    </button>
                    {expandedReport === report.seq && (
                      <div className="bg-muted/40 ml-3 rounded-md p-1.5">
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <span className="text-muted-foreground">全量工具</span>
                          <span className="font-mono">{report.full_tool_count}</span>
                          <span className="text-muted-foreground">可见工具</span>
                          <span className="font-mono">{report.visible_tool_count}</span>
                          <span className="text-muted-foreground">隐蔽工具</span>
                          <span className="font-mono">{report.hidden_tool_count}</span>
                          <span className="text-muted-foreground">外部化</span>
                          <span className="font-mono">{report.tool_output?.externalized_count ?? 0}</span>
                          <span className="text-muted-foreground">压缩节省</span>
                          <span className="font-mono">{report.token_economy?.compressed_chars_saved ?? 0}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {summary.latest && (
              <div className="space-y-2 rounded-md border p-2">
                <p className="text-xs font-medium">最新指纹</p>
                <Fingerprint
                  label="Stable"
                  value={summary.latest.stable_prompt_fingerprint}
                />
                <Fingerprint
                  label="Tools"
                  value={summary.latest.tool_catalog_fingerprint}
                />
                <Fingerprint
                  label="Prefix"
                  value={summary.latest.immutable_prefix_fingerprint}
                />
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </InspectorSection>
  );
}

function RoiTrendSparkline({ reports }: { reports: QiongqiRoiReport[] }) {
  const sorted = reports.slice().sort((a, b) => a.seq - b.seq);
  const maxTokens = Math.max(...sorted.map((r) => r.provider_usage?.input_tokens ?? 0), 1);
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium">Input tokens 趋势</p>
        <span className="text-muted-foreground font-mono text-[10px]">
          #{sorted[0]?.seq} → #{sorted[sorted.length - 1]?.seq}
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: 52 }}>
        {sorted.map((report) => {
          const height = ((report.provider_usage?.input_tokens ?? 0) / maxTokens) * 48;
          return (
            <div
              key={report.seq}
              className="bg-emerald-500/55 hover:bg-emerald-400 flex-1 rounded-t-[2px] transition-colors"
              style={{ height: Math.max(2, height) }}
              title={`#${report.seq}: ${report.provider_usage?.input_tokens ?? 0} input tokens`}
            />
          );
        })}
      </div>
    </div>
  );
}

function RoiHeroMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="mt-1 truncate font-mono text-base font-semibold">{value}</p>
      <p className="text-muted-foreground mt-0.5 truncate text-[10px]">{detail}</p>
    </div>
  );
}

function RoiSavingsDonut({ ratio }: { ratio: number }) {
  const normalized = clampRatio(ratio);
  const degree = Math.round(normalized * 360);
  return (
    <div className="flex flex-col items-center justify-center rounded-md border bg-background/60 p-2">
      <div
        aria-label="节省率"
        className="relative grid size-24 place-items-center rounded-full"
        style={{
          background: `conic-gradient(rgb(16 185 129) ${degree}deg, rgb(39 39 42) ${degree}deg 360deg)`,
        }}
      >
        <div className="bg-background grid size-16 place-items-center rounded-full border">
          <span className="font-mono text-sm font-semibold">
            {formatPercent(normalized)}
          </span>
        </div>
      </div>
      <p className="text-muted-foreground mt-2 text-[10px]">节省率</p>
    </div>
  );
}

function RoiContributionBars({
  items,
}: {
  items: Array<{ label: string; value: number; tone: "emerald" | "cyan" | "amber" }>;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <RoiBar
          key={item.label}
          label={item.label}
          percent={(item.value / maxValue) * 100}
          tone={item.tone}
          value={formatCompactNumber(item.value)}
        />
      ))}
    </div>
  );
}

function RoiCostBreakdown({ input, output }: { input: number; output: number }) {
  const total = Math.max(input + output, 1);
  return (
    <div className="space-y-3">
      <RoiBar
        label="Input"
        percent={(input / total) * 100}
        tone="cyan"
        value={formatCompactNumber(input)}
      />
      <RoiBar
        label="Output"
        percent={(output / total) * 100}
        tone="amber"
        value={formatCompactNumber(output)}
      />
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="h-full bg-cyan-500"
          style={{ width: `${Math.max(0, Math.min(100, (input / total) * 100))}%` }}
        />
      </div>
    </div>
  );
}

function RoiBar({
  label,
  percent,
  tone,
  value,
}: {
  label: string;
  percent: number;
  tone: "emerald" | "cyan" | "amber";
  value: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "cyan"
        ? "bg-cyan-500"
        : "bg-amber-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", toneClass)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

const SKILL_CATEGORIES = [
  {
    id: "delivery",
    label: "项目交付",
    ids: [
      "project-delivery-workflow",
      "requirements-analysis",
      "product-spec",
      "acceptance-criteria",
      "technical-design",
      "project-scaffolding",
      "environment-setup",
      "handoff-docs",
    ],
  },
  {
    id: "core",
    label: "核心工程",
    ids: [
      "using-superpowers",
      "planning",
      "task-decomposition",
      "codebase-analysis",
      "context-management",
      "implement",
      "patch-authoring",
      "rollback-recovery",
    ],
  },
  {
    id: "qiongqi",
    label: "Qiongqi",
    ids: [
      "agent-memory-isolation",
      "scratch-workspace",
      "qiongqi-roi",
      "diff-analysis",
      "pr-review-advanced",
    ],
  },
  {
    id: "frontend",
    label: "前端",
    ids: [
      "frontend-engineering",
      "react-nextjs",
      "ui-polish",
      "web-accessibility",
      "webapp-testing",
      "playwright-verification",
      "state-management",
      "typescript",
    ],
  },
  {
    id: "backend",
    label: "后端",
    ids: [
      "fastapi-backend",
      "api-design",
      "database",
      "migration",
      "error-handling",
      "observability",
      "build-system",
    ],
  },
  {
    id: "quality",
    label: "质量审查",
    ids: [
      "debug",
      "systematic-debugging",
      "test-driven-development",
      "test-writer",
      "qa-test-plan",
      "code-review",
      "security-review",
      "security-hardening",
      "performance",
      "verification-before-completion",
    ],
  },
  {
    id: "release",
    label: "发布运维",
    ids: [
      "ci-cd",
      "dependency-upgrade",
      "deployment",
      "release-engineering",
      "operations-runbook",
      "docs",
      "workflow-automation",
      "using-git-worktrees",
      "subagent-orchestration",
      "skill-authoring",
    ],
  },
] as const;

function CodingWorkflowInspector({
  projectRoot,
  threadId,
}: {
  projectRoot: string;
  threadId: string;
}) {
  const { skills, isLoading: skillsLoading, isFetching: skillsFetching, error: skillsError, refetch: refetchSkills } =
    useCodingSkills(projectRoot);
  const { stages, isLoading: stagesLoading } = useDeliveryStages();
  const { stage: stageState, isFetching: stageFetching, refetch: refetchStage } =
    useProjectStage(projectRoot);
  const setStage = useSetProjectStage(projectRoot);
  const acceptSuggestion = useAcceptStageSuggestion(projectRoot);
  const dismissSuggestion = useDismissStageSuggestion(projectRoot);
  const { session } = useCodingSession(threadId);
  const { review } = useLatestCodingReview(threadId);

  const skillsById = useMemo(() => {
    const map = new Map<string, CodingSkill>();
    for (const skill of skills) map.set(skill.id, skill);
    return map;
  }, [skills]);

  // Side-product signals — kept as advisory hints, NOT stage status.
  const signals = useMemo(
    () => ({
      hasChanges:
        getNumberValue(session?.change_summary ?? {}, "changed_files") > 0 ||
        getNumberValue(session?.change_summary ?? {}, "additions") > 0 ||
        getNumberValue(session?.change_summary ?? {}, "deletions") > 0,
      hasReview: Boolean(review),
    }),
    [review, session],
  );

  const isFetching = skillsFetching || stageFetching;
  const refetch = () => {
    void refetchSkills();
    void refetchStage();
  };
  const isLoading = skillsLoading || stagesLoading;
  const error = skillsError;

  return (
    <InspectorSection
      title="Workflow"
      meta="项目交付流程"
      isFetching={isFetching}
      onRefresh={refetch}
    >
      {isLoading ? (
        <InspectorSkeleton rows={5} />
      ) : error ? (
        <InspectorError message={getErrorMessage(error)} />
      ) : stages.length === 0 ? (
        <InspectorEmpty
          title="暂无 Workflow 数据"
          description="阶段定义加载后会在在这里展示。"
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            {/* Agent suggestion banner */}
            {stageState?.pending_suggestion && (
              <StageSuggestionBanner
                suggestion={stageState.pending_suggestion}
                stages={stages}
                isPending={acceptSuggestion.isPending || dismissSuggestion.isPending}
                onAccept={() => acceptSuggestion.mutate()}
                onDismiss={() => dismissSuggestion.mutate()}
              />
            )}

            <div className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">项目交付流程</p>
                  <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                    {stageState?.current_stage
                      ? `当前阶段: ${currentStageTitle(stages, stageState)}`
                      : "点击阶段进入该阶段"}
                  </p>
                </div>
                {skillsById.get("project-delivery-workflow") && (
                  <Badge variant="secondary" className="rounded px-1.5 text-[10px]">
                    workflow
                  </Badge>
                )}
              </div>
              <div className="mt-2 grid gap-1.5">
                {stages.map((stage, index) => {
                  const isCurrent = stageState?.current_stage === stage.id;
                  const isVisited = stageState?.stage_history.some(
                    (h) => h.to_stage_id === stage.id,
                  );
                  return (
                    <WorkflowStageCard
                      key={stage.id}
                      stage={stage}
                      index={index + 1}
                      isCurrent={isCurrent}
                      isVisited={isVisited}
                      skillsById={skillsById}
                      signals={signals}
                      isPending={
                        setStage.isPending && setStage.variables?.stage_id === stage.id
                      }
                      onEnter={(reason) =>
                        setStage.mutate({ stage_id: stage.id, reason })
                      }
                    />
                  );
                })}
              </div>
            </div>

            {/* Stage transition history timeline (G3) */}
            {stageState && stageState.stage_history.length > 0 && (
              <StageHistoryTimeline
                history={stageState.stage_history}
                stages={stages}
              />
            )}
          </div>
        </ScrollArea>
      )}
    </InspectorSection>
  );
}

function currentStageTitle(
  stages: DeliveryStage[],
  state: ProjectStageState,
): string {
  const stage = stages.find((s) => s.id === state.current_stage);
  return stage?.title ?? state.current_stage ?? "";
}

function CodingSkillsInspector({ projectRoot }: { projectRoot: string }) {
  const { skills, isLoading, isFetching, error, refetch } =
    useCodingSkills(projectRoot);
  const setSkillEnabled = useSetCodingSkillEnabled(projectRoot);
  const pendingSkillId = setSkillEnabled.variables?.skillId ?? null;
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [skillSearch, setSkillSearch] = useState("");

  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase();
    const category = SKILL_CATEGORIES.find((item) => item.id === activeCategory);
    const categoryIds = category ? new Set<string>(category.ids) : null;
    return skills.filter((skill) => {
      if (categoryIds && !categoryIds.has(skill.id)) return false;
      if (!query) return true;
      return (
        skill.id.toLowerCase().includes(query) ||
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
      );
    });
  }, [activeCategory, skillSearch, skills]);

  return (
    <InspectorSection
      title="Skills"
      meta={`内置技能 · ${skills.length} 个`}
      isFetching={isFetching}
      onRefresh={() => void refetch()}
    >
      {isLoading ? (
        <InspectorSkeleton rows={5} />
      ) : error ? (
        <InspectorError message={getErrorMessage(error)} />
      ) : skills.length === 0 ? (
        <InspectorEmpty
          title="暂无 Coding Skills"
          description="内置 Coding skills 会显示在这里，和通用任务技能隔离。"
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
            {setSkillEnabled.error && (
              <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-2 py-1.5 text-xs">
                {getErrorMessage(setSkillEnabled.error)}
              </div>
            )}
            <div className="space-y-2">
              <div className="relative">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2 top-[50%] h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  className="border-input bg-background h-8 w-full rounded-md border pr-2 pl-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                  placeholder="搜索技能..."
                  type="search"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                />
              </div>
              <SkillCategoryFilter
                activeCategory={activeCategory}
                skills={skills}
                onSelectCategory={setActiveCategory}
              />
            </div>

            <div className="space-y-2">
              {filteredSkills.length === 0 ? (
                <InspectorEmpty
                  title="没有匹配的技能"
                  description="调整搜索关键词或切换分类。"
                />
              ) : (
                filteredSkills.map((skill) => (
                  <SkillCard
                    key={`${skill.scope}-${skill.id}`}
                    pending={pendingSkillId === skill.id}
                    skill={skill}
                    onToggle={(enabled) =>
                      setSkillEnabled.mutate({
                        skillId: skill.id,
                        request: {
                          project_root: projectRoot,
                          scope: skill.scope,
                          enabled,
                        },
                      })
                    }
                  />
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      )}
    </InspectorSection>
  );
}

function WorkflowStageCard({
  stage,
  index,
  isCurrent,
  isVisited,
  skillsById,
  signals,
  isPending,
  onEnter,
}: {
  stage: DeliveryStage;
  index: number;
  isCurrent: boolean;
  isVisited: boolean | undefined;
  skillsById: Map<string, CodingSkill>;
  signals: { hasChanges: boolean; hasReview: boolean };
  isPending: boolean;
  onEnter: (reason?: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const stageSkills = stage.recommended_skills;
  const available = stageSkills.filter((id) => skillsById.has(id));
  const enabled = available.filter((id) => skillsById.get(id)?.enabled).length;

  const statusLabel = isCurrent
    ? "当前阶段"
    : isVisited
      ? "已访问"
      : "未开始";

  // Advisory side-product signals (do NOT determine stage status).
  const signalLabel =
    stage.id === "implementation" && signals.hasChanges
      ? "检测到文件变更"
      : stage.id === "review" && signals.hasReview
        ? "有 review 记录"
        : null;

  return (
    <div
      className={cn(
        "bg-muted/30 rounded-md border px-2 py-1.5 transition-colors",
        isCurrent && "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="bg-background text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded border font-mono text-[10px]">
          {index}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {stage.title}
        </span>
        <Badge
          variant={isCurrent ? "secondary" : "outline"}
          className={cn(
            "rounded px-1.5 text-[10px]",
            isCurrent && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {statusLabel}
        </Badge>
        <span className="text-muted-foreground font-mono text-[10px]">
          {enabled}/{available.length}
        </span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-[11px] leading-4">
        {stage.goal}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {stageSkills.map((id) => {
          const skill = skillsById.get(id);
          return (
            <Badge
              key={id}
              variant={skill?.enabled ? "secondary" : "outline"}
              className={cn(
                "rounded px-1.5 text-[10px]",
                !skill && "text-muted-foreground opacity-50",
              )}
            >
              {skill?.name ?? id}
            </Badge>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {confirming ? (
          <div className="flex items-center gap-1">
            <button
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-6 rounded px-2 text-[10px] transition-colors"
              disabled={isPending}
              type="button"
              onClick={() => {
                onEnter();
                setConfirming(false);
              }}
            >
              {isPending ? "..." : "确认进入"}
            </button>
            <button
              className="text-muted-foreground hover:bg-muted hover:text-foreground h-6 rounded border px-2 text-[10px] transition-colors"
              type="button"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className={cn(
              "h-6 rounded border px-2 text-[10px] transition-colors",
              isCurrent
                ? "text-muted-foreground cursor-default opacity-50"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            disabled={isCurrent}
            type="button"
            onClick={() => setConfirming(true)}
          >
            {isCurrent ? "已是当前阶段" : "进入此阶段"}
          </button>
        )}
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground h-6 rounded border px-2 text-[10px] transition-colors"
          type="button"
          onClick={() => void copyWorkflowPrompt(stage.suggested_prompt)}
        >
          复制提示词
        </button>
        {signalLabel && (
          <span className="text-muted-foreground text-[10px]">
            · {signalLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function StageSuggestionBanner({
  suggestion,
  stages,
  isPending,
  onAccept,
  onDismiss,
}: {
  suggestion: StageSuggestion;
  stages: DeliveryStage[];
  isPending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const stage = stages.find((s) => s.id === suggestion.stage_id);
  const title = stage?.title ?? suggestion.stage_id;

  return (
    <div className="bg-primary/5 border-primary/20 rounded-md border p-2">
      <div className="flex items-start gap-2">
        <InfoIcon className="text-primary mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            Agent 建议进入【{title}】阶段
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
            {suggestion.reason}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-6 rounded px-2 text-[10px] transition-colors"
          disabled={isPending}
          type="button"
          onClick={onAccept}
        >
          {isPending ? "..." : "接受并进入"}
        </button>
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground h-6 rounded border px-2 text-[10px] transition-colors"
          disabled={isPending}
          type="button"
          onClick={onDismiss}
        >
          忽略
        </button>
      </div>
    </div>
  );
}

async function copyWorkflowPrompt(nextPrompt: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(nextPrompt);
  } catch {
    // Clipboard can be unavailable in some desktop/webview contexts.
  }
}

const SOURCE_LABELS: Record<string, string> = {
  user: "用户",
  agent_suggested: "Agent 建议",
  agent_accepted: "Agent 已接受",
};

const SOURCE_COLORS: Record<string, string> = {
  user: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  agent_suggested: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  agent_accepted: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
};

function formatStageTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function StageHistoryTimeline({
  history,
  stages,
}: {
  history: StageHistoryEntry[];
  stages: DeliveryStage[];
}) {
  const stageTitle = (id: string | null) =>
    id ? (stages.find((s) => s.id === id)?.title ?? id) : "—";

  // Latest transitions first.
  const entries = [...history].reverse();

  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">阶段流转历史</p>
        <span className="text-muted-foreground text-[10px]">
          {history.length} 次转换
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {entries.map((entry, idx) => {
          const isLatest = idx === 0;
          return (
            <div
              key={`${entry.to_stage_id}-${entry.timestamp}-${idx}`}
              className={cn(
                "rounded border px-2 py-1.5",
                isLatest
                  ? "bg-muted/40"
                  : "bg-transparent",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium">
                  {stageTitle(entry.from_stage_id)}
                </span>
                <ChevronRightIcon className="text-muted-foreground size-3 shrink-0" />
                <span className="text-[11px] font-semibold">
                  {stageTitle(entry.to_stage_id)}
                </span>
                {isLatest && (
                  <Badge
                    variant="secondary"
                    className="ml-auto rounded px-1.5 text-[9px]"
                  >
                    最新
                  </Badge>
                )}
              </div>
              {entry.reason && (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[10px] leading-3.5">
                  {entry.reason}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded px-1 text-[9px]",
                    SOURCE_COLORS[entry.source] ?? "",
                  )}
                >
                  {SOURCE_LABELS[entry.source] ?? entry.source}
                </Badge>
                <span className="text-muted-foreground font-mono text-[9px]">
                  {formatStageTimestamp(entry.timestamp)}
                </span>
                {entry.thread_id && (
                  <span
                    className="text-muted-foreground max-w-[80px] truncate font-mono text-[9px]"
                    title={entry.thread_id}
                  >
                    @{entry.thread_id.slice(-8)}
                  </span>
                )}
                {entry.run_outcome && (
                  <Badge
                    variant="outline"
                    className="rounded px-1 text-[9px]"
                  >
                    {entry.run_outcome}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function SkillCategoryFilter({
  activeCategory,
  onSelectCategory,
  skills,
}: {
  activeCategory: string;
  skills: CodingSkill[];
  onSelectCategory: (category: string) => void;
}) {
  const skillIds = useMemo(() => new Set(skills.map((skill) => skill.id)), [skills]);

  return (
    <div className="flex flex-wrap gap-1">
      <button
        className={cn(
          "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
          activeCategory === "all"
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted text-muted-foreground hover:text-foreground",
        )}
        type="button"
        onClick={() => onSelectCategory("all")}
      >
        全部分类
      </button>
      {SKILL_CATEGORIES.map((category) => {
        const count = category.ids.filter((id) => skillIds.has(id)).length;
        return (
          <button
            key={category.id}
            className={cn(
              "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
              activeCategory === category.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
            type="button"
            onClick={() => onSelectCategory(category.id)}
          >
            {category.label} {count}
          </button>
        );
      })}
    </div>
  );
}

function SkillCard({
  onToggle,
  pending,
  skill,
}: {
  pending: boolean;
  skill: CodingSkill;
  onToggle: (enabled: boolean) => void;
}) {
  const category = SKILL_CATEGORIES.find((item) =>
    (item.ids as readonly string[]).includes(skill.id),
  );

  return (
    <div className="bg-background w-full rounded-md border p-2.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{skill.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              variant={skill.enabled ? "secondary" : "outline"}
              className="rounded px-1.5 text-[10px]"
            >
              {skill.scope === "global" ? "内置技能" : skill.scope}
            </Badge>
            {category && (
              <Badge variant="outline" className="rounded px-1.5 text-[10px]">
                {category.label}
              </Badge>
            )}
            {!skill.enabled && (
              <Badge variant="outline" className="rounded px-1.5 text-[10px]">
                disabled
              </Badge>
            )}
          </div>
        </div>
        <Switch
          aria-label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
          checked={skill.enabled}
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onCheckedChange={onToggle}
        />
      </div>
      <p className="text-muted-foreground mt-2 line-clamp-3 text-xs leading-5">
        {skill.description || skill.id}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {skill.activation_keywords.slice(0, 4).map((keyword) => (
          <Badge
            key={keyword}
            variant="outline"
            className="rounded px-1.5 text-[10px]"
          >
            {keyword}
          </Badge>
        ))}
        {skill.activation_keywords.length > 4 && (
          <Badge
            variant="outline"
            className="text-muted-foreground rounded px-1.5 text-[10px]"
          >
            +{skill.activation_keywords.length - 4}
          </Badge>
        )}
        {skill.manifest_errors.length > 0 && (
          <Badge variant="destructive" className="rounded px-1.5 text-[10px]">
            manifest
          </Badge>
        )}
      </div>
    </div>
  );
}

function InspectorSection({
  action,
  children,
  isFetching,
  meta,
  onRefresh,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  isFetching: boolean;
  meta?: string;
  onRefresh: () => void;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{title}</p>
          {meta && <p className="text-muted-foreground text-[11px]">{meta}</p>}
        </div>
        {action}
        <Button
          className="size-7"
          disabled={isFetching}
          size="icon"
          title="刷新"
          type="button"
          variant="ghost"
          onClick={onRefresh}
        >
          <RefreshCwIcon
            className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
          />
        </Button>
      </div>
      {children}
    </div>
  );
}

function InspectorSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

function InspectorError({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
      <p className="text-destructive text-xs">{message}</p>
    </div>
  );
}

function InspectorEmpty({
  description,
  title,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
      <div className="bg-muted/60 flex h-10 w-10 items-center justify-center rounded-md">
        <ActivityIcon className="text-muted-foreground h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-56 text-xs leading-5">
        {description}
      </p>
    </div>
  );
}

function MetricGrid({ items }: { items: Array<[string, number | string] | [string, number | string, string]> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const [label, value, tip] = item;
        return (
          <div key={label} className="rounded-md border p-2" title={tip}>
            <p className="text-muted-foreground text-[11px]">{label}</p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {typeof value === "number" ? formatNumber(value) : value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "加载失败";
}

function formatEventType(eventType: string): string {
  return eventType.replaceAll("_", " ");
}

function getEventFocusTarget(
  event: QiongqiEvent,
): { path: string; target: "code" | "task-changes" | "diff"; taskId?: string } | null {
  const path =
    typeof event.payload.path === "string"
      ? event.payload.path
      : Array.isArray(event.payload.paths) &&
          typeof event.payload.paths[0] === "string"
        ? event.payload.paths[0]
        : null;
  if (!path) return null;
  const taskId = typeof event.payload.task_id === "string" ? event.payload.task_id : undefined;
  return {
    path,
    target:
      event.event_type === "file_changed" ||
      event.event_type === "diff_summarized"
        ? "task-changes"
        : "code",
    taskId,
  };
}

function formatJsonPreview(value: Record<string, unknown>): string {
  if (Object.keys(value).length === 0) return "{}";
  return JSON.stringify(value, null, 2);
}

function getNumberValue(value: Record<string, unknown>, key: string): number {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function getRecordValue(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const raw = value[key];
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function buildChangeSummaryFromChanges(
  changes: QiongqiChange[],
): Record<string, unknown> {
  if (changes.length === 0) return {};
  const latestChange = changes.reduce((latest, change) =>
    change.created_at > latest.created_at ? change : latest,
  );
  const paths = Array.from(new Set(changes.map((change) => change.path))).sort();
  const additions = changes.reduce((sum, change) => sum + change.additions, 0);
  const deletions = changes.reduce((sum, change) => sum + change.deletions, 0);
  return {
    thread_id: latestChange.thread_id,
    task_id: latestChange.task_id,
    changed_files: paths.length,
    additions,
    deletions,
    paths,
    summary: `${paths.length} 个文件变更，+${additions} -${deletions}`,
  };
}

function mergeChangeSummary(
  sessionSummary: Record<string, unknown>,
  changesSummary: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(changesSummary).length === 0) return sessionSummary;
  if (Object.keys(sessionSummary).length === 0) return changesSummary;
  const merged = { ...changesSummary, ...sessionSummary };
  for (const key of ["changed_files", "additions", "deletions"]) {
    if (getNumberValue(sessionSummary, key) === 0) {
      merged[key] = getNumberValue(changesSummary, key);
    }
  }
  if (!Array.isArray(sessionSummary.paths)) {
    merged.paths = changesSummary.paths;
  }
  if (typeof sessionSummary.task_id !== "string") {
    merged.task_id = changesSummary.task_id;
  }
  if (typeof sessionSummary.summary !== "string") {
    merged.summary = changesSummary.summary;
  }
  return merged;
}

function getCurrentTaskLabel(
  changeSummary: Record<string, unknown> | undefined,
): string {
  if (!changeSummary || Object.keys(changeSummary).length === 0) {
    return "暂无当前任务摘要。Agent 产生任务变更后会在这里显示。";
  }
  const taskId = changeSummary.task_id;
  const title = changeSummary.title ?? changeSummary.task ?? changeSummary.summary;
  if (typeof taskId === "string" && typeof title === "string") {
    return `${taskId}: ${title}`;
  }
  if (typeof title === "string") return title;
  if (typeof taskId === "string") return taskId;
  return "已有变更摘要，但未记录明确任务标题。";
}

function formatInspectorValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === "object") return JSON.stringify(value);
  return "";
}

function formatToolPolicySummary(policy: Record<string, unknown>): string {
  const tools = Array.isArray(policy.allowed_tools)
    ? policy.allowed_tools.map(String)
    : [];
  const permissions =
    policy.permissions && typeof policy.permissions === "object"
      ? Object.keys(policy.permissions as Record<string, unknown>)
      : [];
  if (tools.length > 0 && permissions.length > 0) {
    return `${tools.slice(0, 4).join(", ")} · ${permissions.join(", ")}`;
  }
  if (tools.length > 0) return tools.slice(0, 5).join(", ");
  if (permissions.length > 0) return permissions.join(", ");
  return "未声明工具限制";
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 100000 ? "compact" : "standard",
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(clampRatio(value) * 100)}%`;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

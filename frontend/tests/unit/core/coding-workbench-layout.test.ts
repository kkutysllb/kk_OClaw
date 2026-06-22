import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding workbench layout", () => {
  test("workspace sidebar collapsed logo keeps the original hover trigger transition", () => {
    const header = readFileSync(
      resolve(repoRoot, "src/components/workspace/workspace-header.tsx"),
      "utf8",
    );

    expect(header).toContain('data-testid="workspace-sidebar-trigger"');
    expect(header).toContain("group-hover/workspace-header:hidden");
    expect(header).toContain("group-hover/workspace-header:block");
  });

  test("coding workbench places panel controls in the sidebar headers", () => {
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(workbench).not.toContain("CollapsedPanelRestore");
    expect(workbench).not.toContain("left-panel-toggle");
    expect(workbench).not.toContain("left-panel-toggle-expanded");
    expect(workbench).not.toContain("right-panel-toggle-expanded");
    expect(workbench).toContain("Agent Inspector");
    expect(workbench).toContain("showFileExplorer");
    expect(workbench).toContain("showWorkbenchPane");
    expect(workbench).toContain("openWorkbenchPane");
    expect(workbench).toContain("closeWorkbenchPane");
    expect(workbench).toContain("const [leftCollapsed, setLeftCollapsed] = useState(false)");
    expect(workbench).toContain("const [rightCollapsed, setRightCollapsed] = useState(true)");
    expect(workbench).toContain("environmentCardCollapsed");
    expect(workbench).toContain("useState(false)");
    expect(workbench).toContain("const showEnvironmentCard = !showWorkbenchPane && !environmentCardCollapsed");
    expect(workbench).toContain("LEFT_PANEL_DEFAULT_WIDTH = 320");
    expect(workbench).toContain("LEFT_PANEL_MIN_WIDTH = 240");
    expect(workbench).toContain("LEFT_PANEL_MAX_WIDTH = 520");
    expect(workbench).toContain("RIGHT_PANEL_DEFAULT_WIDTH = 640");
    expect(workbench).toContain("RIGHT_PANEL_MIN_WIDTH = 420");
    expect(workbench).toContain("RIGHT_PANEL_MAX_WIDTH = 1120");
    expect(workbench).toContain("leftPanelWidth");
    expect(workbench).toContain("rightPanelWidth");
    expect(workbench).toContain("startPanelResize");
    expect(workbench).toContain('window.addEventListener("pointermove"');
    expect(workbench).toContain("PanelResizeHandle");
    expect(workbench).not.toContain("PanelImperativeHandle");
    expect(workbench).not.toContain("ResizablePanelGroup");
    expect(workbench).not.toContain("ResizablePanel");
    expect(workbench).not.toContain("ResizableHandle");
    expect(workbench).toContain("{showFileExplorer && (");
    expect(workbench).toContain("style={{ width: leftPanelWidth }}");
    expect(workbench).toContain("style={{ width: rightPanelWidth }}");
    expect(workbench).toContain("2xl:pr-[360px] xl:pr-[340px]");
    expect(workbench).toContain('data-testid="coding-workbench-right-panel"');
    expect(workbench).toContain("const [workbenchView, setWorkbenchView]");
    expect(workbench).toContain('TabsTrigger value="agent"');
    expect(workbench).toContain("PersistentInspectorPanel");
    expect(workbench).toContain('active={activeTab === "agent"}');
    expect(workbench).toContain('TabsTrigger value="events"');
    expect(workbench).toContain('TabsTrigger value="session"');
    expect(workbench).toContain('TabsTrigger value="roi"');
    expect(workbench).toContain('TabsTrigger value="workflow"');
    expect(workbench).toContain('TabsTrigger value="skills"');
    expect(workbench).toContain("CodingEventsInspector");
    expect(workbench).toContain("CodingSessionInspector");
    expect(workbench).toContain("useCodingSessionChanges(threadId)");
    expect(workbench).toContain("effectiveChangeSummary");
    expect(workbench).toContain("buildChangeSummaryFromChanges");
    expect(workbench).toContain("CodingRoiInspector");
    expect(workbench).toContain("derived");
    expect(workbench).toContain("节省率");
    expect(workbench).toContain("估算节省");
    expect(workbench).toContain("工具裁剪");
    expect(workbench).toContain("RoiSavingsDonut");
    expect(workbench).toContain("RoiContributionBars");
    expect(workbench).toContain("RoiCostBreakdown");
    expect(workbench).toContain("成本明细");
    expect(workbench).toContain("CodingWorkflowInspector");
    expect(workbench).toContain("CodingSkillsInspector");
    expect(workbench).toContain("useCodingSessionEvents");
    expect(workbench).toContain("useCodingSession");
    expect(workbench).toContain("useCodingRoiSummary");
    expect(workbench).toContain("useCodingSkills");
    expect(workbench).toContain("useSetCodingSkillEnabled");
    expect(workbench).toContain("<Switch");
    expect(workbench).toContain("event.stopPropagation()");
    expect(workbench).toContain("onCheckedChange");
    expect(workbench).toContain("内置技能");
    expect(workbench).toContain("skill.activation_keywords.slice(0, 4)");
    expect(workbench).toContain("SKILL_CATEGORIES");
    expect(workbench).toContain("useDeliveryStages");
    expect(workbench).toContain("copyWorkflowPrompt");
    expect(workbench).toContain("复制提示词");
    expect(workbench).toContain("nextPrompt");
    expect(workbench).toContain("goal");
    expect(workbench).toContain("filteredSkills");
    expect(workbench).toContain("setSkillSearch");
    expect(workbench).toContain("项目交付流程");
    expect(workbench).toContain("全部分类");
    expect(workbench).toContain("WorkflowStageCard");
    expect(workbench).toContain("SkillCategoryFilter");
    expect(workbench).toContain("const signals = useMemo");
    expect(workbench).toContain("isCurrent={isCurrent}");
    expect(workbench).toContain("isVisited={isVisited}");
    expect(workbench).toContain("signals={signals}");
    expect(workbench).toContain("运行概览");
    expect(workbench).toContain("当前任务");
    expect(workbench).toContain("变更摘要");
    expect(workbench).toContain("活跃技能");
    expect(workbench).toContain("工具策略");
    expect(workbench).toContain("ROI 摘要");
    expect(workbench).toContain("原始 Session");
    expect(workbench).toContain("expandedRawSession");
    expect(workbench).not.toContain("useCodingSkillDetail");
    expect(workbench).not.toContain("useCreateCodingSkill");
    expect(workbench).not.toContain("useUpdateCodingSkill");
    expect(workbench).not.toContain("useDeleteCodingSkill");
    expect(workbench).not.toContain("selectedSkillDetail");
    expect(workbench).not.toContain("SkillEditorForm");
    expect(workbench).not.toContain("startCreateSkill");
    expect(workbench).not.toContain("startEditSkill");
    expect(workbench).not.toContain("submitSkillForm");
    expect(workbench).not.toContain("deleteSelectedSkill");
    expect(workbench).not.toContain("确认删除项目 Coding Skill");
    expect(workbench).not.toContain("选择一个 skill 查看说明");
    expect(workbench).not.toContain(">新建<");
    expect(workbench).not.toContain(">编辑<");
    expect(workbench).not.toContain(">删除<");
    expect(workbench).toContain("focusWorkbenchFile");
    expect(workbench).toContain("handleSelectExplorerFile");
    expect(workbench).toContain("onFocusFile");
    expect(workbench).toContain("getEventFocusTarget");
    expect(workbench).toContain("CodingTaskChangesPanel");
    expect(workbench).toContain('label="任务变更"');
    expect(workbench).toContain('label="Code Review"');
    expect(workbench).toContain('handleSelectWorkbenchTab("task-changes")');
    expect(workbench).toContain('handleSelectWorkbenchTab("review")');
    expect(workbench).toContain('event.event_type === "file_changed"');
    expect(workbench).toContain('event.event_type === "diff_summarized"');
    expect(workbench).toContain('target: WorkbenchFocusTarget = "code"');
    expect(workbench).toContain("openWorkbenchPane()");
    expect(workbench).not.toContain('setActiveInspectorTab("events")');
    expect(workbench).not.toContain("后续接入 Qiongqi");
    expect(workbench).not.toContain("InspectorPlaceholder");
    expect(workbench).not.toContain("absolute top-1/2");
    expect(workbench).not.toContain("forceMount");
    expect(workbench).not.toContain("{/* Panel collapse toggles */}");
  });

  test("coding workbench keeps code-view and review controls in one toolbar row", () => {
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(workbench).toContain('data-testid="coding-workbench-toolbar"');
    expect(workbench).toContain("overflow-x-auto border-b");
    expect(workbench).toContain('aria-label="代码区视图"');
    expect(workbench).toContain("mr-auto inline-flex");
    expect(workbench).toContain('aria-label="切换环境信息面板"');
    expect(workbench).toContain("setEnvironmentCardCollapsed((value) => !value)");
    expect(workbench).toContain("MonitorCogIcon");
    expect(workbench).toContain('aria-label="打开项目终端"');
    expect(workbench).toContain('aria-label="新建项目终端"');
    expect(workbench).toContain("PlusIcon");
    expect(workbench).toContain('aria-label="切换文件树"');
    expect(workbench).toContain('aria-label="切换代码面板"');
    expect(workbench).toContain("openProjectTerminal(project.path)");
    expect(workbench).toContain("startEmbeddedTerminal(project.path)");
    expect(workbench).toContain("EmbeddedTerminalTabsPanel");
    expect(workbench).toContain('data-testid="embedded-project-terminal"');
    expect(workbench).toContain('data-testid="embedded-project-terminal-viewport"');
    expect(workbench).toContain("Terminal as XTerm");
    expect(workbench).toContain("FitAddon");
    expect(workbench).toContain("onWriteRef.current(tab.id, data)");
    expect(workbench).toContain("void writeEmbeddedTerminal(sessionId, data)");
    expect(workbench).toContain("fitAddon.fit()");
    expect(workbench).toContain("void resizeEmbeddedTerminal(sessionId, cols, rows)");
    expect(workbench).toContain("terminalTabs");
    expect(workbench).toContain("activeTerminalId");
    expect(workbench).toContain("onAdd={() => void handleOpenTerminal()}");
    expect(workbench).toContain('aria-label={`关闭终端标签 ${index + 1}`}');
    expect(workbench).toContain("event.stopPropagation()");
    expect(workbench).not.toContain('aria-label="终端命令"');
    expect(workbench).not.toContain('aria-label="关闭当前终端"');
    expect(workbench).not.toContain("bg-[#111]");
    expect(workbench).not.toContain("text-zinc-100");
    expect(workbench).not.toContain("OClaw embedded terminal");
    expect(workbench).toContain("handleOpenTerminal");
    expect(workbench).toContain("handleCloseTerminalPanel");
    expect(workbench).toContain("handleToggleFileExplorer");
    expect(workbench).toContain("handleToggleWorkbenchPane");
    expect(workbench).toContain("PanelLeftOpenIcon");
    expect(workbench).toContain("PanelRightOpenIcon");
    expect(workbench).toContain("WorkbenchToolbarButton");
    expect(workbench).toContain('activeCodeTab === "review"');
    expect(workbench).toContain("<ReviewPanel");
    expect(workbench).toContain('label="Code Review"');
    expect(workbench).toContain("EnvironmentInfoFloatingCard");
    expect(workbench).toContain("visible={showEnvironmentCard}");
    expect(workbench).toContain("gitBranch");
    expect(workbench).toContain("useProjectEnvironment");
    expect(workbench).toContain("useCodingSessionChanges");
    expect(workbench).toContain("const taskChangeSummary = useMemo");
    expect(workbench).toContain("const reviewChangeSummary = reviewSummary");
    expect(workbench).toContain("reviewChangeSummary.additions || taskChangeSummary.additions");
    expect(workbench).toContain("reviewChangeSummary.deletions || taskChangeSummary.deletions");
    expect(workbench).toContain("reviewChangeSummary.changedFiles || taskChangeSummary.changedFiles");
    expect(workbench).toContain("review?.summary");
    expect(workbench).toContain("useProjectGitCommit");
    expect(workbench).toContain("useProjectGitPush");
    expect(workbench).toContain("githubCli");
    expect(workbench).toContain("sourceLabel");
    expect(workbench).toContain("onCommit");
    expect(workbench).toContain("onPush");
    expect(workbench).toContain("GitHub CLI");
    expect(workbench).toContain("提交更改");
    expect(workbench).toContain("推送分支");
    expect(workbench).toContain("来源");
    expect(workbench).not.toContain("activeWorkbenchTab");
    expect(workbench).not.toContain("setActiveWorkbenchTab");
    expect(workbench).not.toContain('label="浏览器"');
    expect(workbench).not.toContain('aria-label="Coding 工作模式"');
    expect(workbench).not.toContain('<Tabs defaultValue="code"');
    expect(workbench).not.toContain('className="mx-3 mt-2 w-fit shrink-0"');
  });

  test("review panel exposes PR review and one-click fix workflow controls", () => {
    const panel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/review-panel.tsx"),
      "utf8",
    );

    expect(panel).toContain("useApplyCodingReviewFix");
    expect(panel).toContain('startReview("pr")');
    expect(panel).toContain("PR 审查");
    expect(panel).toContain("currentReview.scope === \"pr\"");
    expect(panel).toContain("reviewSummary.commits");
    expect(panel).toContain("ReviewPrContext");
    expect(panel).toContain("getReviewPrContext");
    expect(panel).toContain("findingSeverityFilter");
    expect(panel).toContain("filteredFindings");
    expect(panel).toContain("Patch 预览");
    expect(panel).toContain("expandedPatchFindingId");
    expect(panel).toContain("ReviewErrorNotice");
    expect(panel).toContain("请求目标");
    expect(panel).toContain("可能原因");
    expect(panel).toContain("finding.fix?.applicable");
    expect(panel).toContain("一键应用");
    expect(panel).toContain("自动修复已应用");
    expect(panel).toContain("applyFix.mutate");
    expect(panel).toContain("applyFix.error");
  });
});

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

    expect(workbench).toContain("PanelHeaderToggle");
    expect(workbench).toContain("CollapsedPanelRestore");
    expect(workbench).toContain("left-panel-toggle");
    expect(workbench).toContain("left-panel-toggle-expanded");
    expect(workbench).toContain("right-panel-toggle");
    expect(workbench).toContain("right-panel-toggle-expanded");
    expect(workbench).toContain("Agent Inspector");
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
    expect(workbench).toContain("CodingRoiInspector");
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
    expect(workbench).toContain("PROJECT_DELIVERY_STAGES");
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
    expect(workbench).toContain("getWorkflowStageStatus");
    expect(workbench).toContain("workflowSignals");
    expect(workbench).toContain("status={getWorkflowStageStatus");
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
    expect(workbench).toContain("onFocusFile");
    expect(workbench).toContain("getEventFocusTarget");
    expect(workbench).toContain("CodingTaskChangesPanel");
    expect(workbench).toContain('label="任务变更"');
    expect(workbench).toContain('label="Code Review"');
    expect(workbench).toContain('setActiveCodeTab("task-changes")');
    expect(workbench).toContain('setActiveCodeTab("review")');
    expect(workbench).toContain('event.event_type === "file_changed"');
    expect(workbench).toContain('event.event_type === "diff_summarized"');
    expect(workbench).toContain("setActiveCodeTab(target)");
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
    expect(workbench).toContain("ml-auto inline-flex");
    expect(workbench).toContain("WorkbenchToolbarButton");
    expect(workbench).toContain('activeCodeTab === "review"');
    expect(workbench).toContain("<ReviewPanel");
    expect(workbench).toContain('label="Code Review"');
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

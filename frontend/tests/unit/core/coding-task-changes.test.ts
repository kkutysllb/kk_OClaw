import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding task changes panel", () => {
  test("renders qiongqi session changes in the right workbench pane", () => {
    const panel = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/coding-task-changes-panel.tsx",
      ),
      "utf8",
    );
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(panel).toContain("useCodingSessionChanges");
    expect(panel).toContain("selectedFilePath");
    expect(panel).toContain("TaskChangeFileCard");
    expect(panel).toContain("UnifiedDiffBlock");
    expect(panel).toContain("expandedFiles");
    expect(panel).toContain("COLLAPSED_DIFF_LINES");
    expect(panel).toContain("taskExpansionTouchedRef");
    expect(panel).toContain("fileCardRefs");
    expect(panel).toContain("scrollIntoView");
    expect(panel).toContain("onFocusFile");
    expect(panel).toContain('onFocusFile?.(change.path, "task-changes"');
    expect(panel).toContain("任务变更");
    expect(panel).toContain("刷新任务变更");
    expect(panel).toContain("Qiongqi 记录到文件修改后");
    expect(panel).toContain("仅显示前");
    expect(panel).toContain("展开查看完整 Diff");
    expect(panel).not.toContain("SideBySideDiff");
    expect(panel).not.toContain("diffViewMode");
    expect(workbench).toContain("<CodingTaskChangesPanel");
    expect(workbench).toContain("const codingThreadId = agentThreadId ?? projectId");
    expect(workbench).toContain("threadId={codingThreadId}");
    expect(workbench).toContain("selectedFilePath={selectedFile}");
    expect(workbench).toContain("setActiveInspectorTab");
    expect(workbench).not.toContain('setActiveInspectorTab("events")');
    expect(workbench).toContain('setWorkbenchView(target)');
    expect(workbench).toContain("openWorkbenchPane()");
    expect(workbench).toContain("onFocusFile={focusWorkbenchFile}");
  });
});

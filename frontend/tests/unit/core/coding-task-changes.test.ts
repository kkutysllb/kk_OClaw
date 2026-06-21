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
    expect(panel).toContain("selectedChange?.diff");
    expect(panel).toContain("onFocusFile");
    expect(panel).toContain("onFocusFile?.(change.path");
    expect(panel).toContain("任务变更");
    expect(panel).toContain("刷新任务变更");
    expect(panel).toContain("Qiongqi 记录到文件修改后");
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { parseUnifiedDiffForSideBySide } from "@/components/workspace/coding/diff-view";

const repoRoot = resolve(__dirname, "../../..");

describe("coding diff workflow", () => {
  test("project core exposes diff types, API, and query hook", () => {
    const types = readFileSync(
      resolve(repoRoot, "src/core/projects/types.ts"),
      "utf8",
    );
    const api = readFileSync(
      resolve(repoRoot, "src/core/projects/api.ts"),
      "utf8",
    );
    const hooks = readFileSync(
      resolve(repoRoot, "src/core/projects/hooks.ts"),
      "utf8",
    );

    expect(types).toContain("export interface ProjectDiffFile");
    expect(types).toContain("diff?: string");
    expect(types).toContain("export interface ProjectDiff");
    expect(api).toContain("export async function getProjectDiff");
    expect(api).toContain("export async function discardProjectFileChange");
    expect(api).toContain("/diff");
    expect(api).toContain("/diff/discard");
    expect(hooks).toContain("export function useProjectDiff");
    expect(hooks).toContain("export function useDiscardProjectFileChange");
    expect(hooks).toContain('queryKey: ["projects", projectId, "diff"]');
  });

  test("coding workbench renders a middle-panel diff tab", () => {
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(workbench).toContain("CodingDiffPanel");
    expect(workbench).toContain("selectedFile={selectedFile}");
    expect(workbench).toContain("workbenchView === \"diff\"");
    expect(workbench).toContain("showWorkbenchPane &&");
    expect(workbench).toContain("<CodeViewer");
    expect(workbench).toContain('aria-label="代码区视图"');
    expect(workbench).toContain('label="项目 Diff"');
    expect(workbench).toContain('handleSelectWorkbenchTab("diff")');
    expect(workbench).toContain("任务变更");
    expect(workbench).toContain('activeCodeTab === "diff"');
  });

  test("coding diff panel shows changed files and unified diff", () => {
    const panel = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/coding-diff-panel.tsx",
      ),
      "utf8",
    );

    expect(panel).toContain("useProjectDiff");
    expect(panel).toContain("selectedDiffFile");
    expect(panel).toContain("filteredDiff");
    expect(panel).toContain("selectedFile?.diff");
    expect(panel).toContain("diffViewMode");
    expect(panel).toContain('"side-by-side"');
    expect(panel).toContain("SideBySideDiff");
    expect(panel).toContain("parseUnifiedDiffForSideBySide");
    expect(panel).toContain("selectedFilePath");
    expect(panel).toContain("focusLine");
    expect(panel).toContain("focusedDiffLine");
    expect(panel).toContain("highlightedNewLine");
    expect(panel).toContain("highlightedOldLine");
    expect(panel).toContain("totalAdditions");
    expect(panel).toContain("totalDeletions");
    expect(panel).toContain("refetch");
    expect(panel).toContain("RefreshCwIcon");
    expect(panel).toContain("Undo2Icon");
    expect(panel).toContain("discardProjectFileChange");
    expect(panel).toContain("撤销此文件");
    expect(panel).toContain("确认撤销");
    expect(panel).not.toContain("oldLineNumber");

    // Side-by-side diff components are now in the shared diff-view module
    const diffView = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/diff-view.tsx",
      ),
      "utf8",
    );
    expect(diffView).toContain("oldLineNumber");
    expect(diffView).toContain("newLineNumber");
    expect(diffView).toContain("highlightedNewLine");
    expect(diffView).toContain("highlightedOldLine");
    expect(diffView).toContain("ring-1 ring-amber-500/60");
    expect(diffView).toContain("highlightedRowRef");
    expect(diffView).toContain("scrollIntoView");
    expect(panel).toContain("renderUnifiedDiff");
    expect(panel).toContain("highlightedUnifiedLine");
    expect(diffView).toContain("SideBySideDiff");
    expect(panel).toContain("diffScope");
    expect(panel).toContain('"selected"');
    expect(panel).toContain('"all"');
    expect(panel).toContain("overflow-x-auto");
    expect(panel).toContain(
      "inline-flex h-8 shrink-0 items-center rounded-md p-1",
    );
    expect(panel).toContain("当前文件暂无变更");
    expect(diffView).toContain("binary files differ");
    expect(diffView).toContain("parseUnifiedDiffForSideBySide");
    expect(panel).toContain("isFetching");
    expect(panel).toContain("正在刷新变更");
    expect(panel).toContain("当前项目不是 Git 仓库");
    expect(panel).toContain("新增");
    expect(panel).toContain("删除");
    expect(panel).toContain("修改");
    expect(panel).toContain(
      "files.some((file) => file.path === selectedDiffFile)",
    );
  });

  test("coding agent refreshes diff state after file activity", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain('queryKey: ["projects", projectId, "diff"]');
  });

  test("side-by-side parser keeps line numbers and pairs replacements", () => {
    const rows = parseUnifiedDiffForSideBySide(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -10,3 +10,4 @@",
        " const first = true;",
        "-const label = 'old';",
        "+const label = 'new';",
        "+const extra = true;",
        " export { label };",
      ].join("\n"),
    );

    expect(rows).toContainEqual({
      oldLine: "const label = 'old';",
      newLine: "const label = 'new';",
      oldLineNumber: 11,
      newLineNumber: 11,
      type: "added",
    });
    expect(rows).toContainEqual({
      oldLine: "",
      newLine: "const extra = true;",
      oldLineNumber: null,
      newLineNumber: 12,
      type: "added",
    });
    expect(rows).toContainEqual({
      oldLine: "export { label };",
      newLine: "export { label };",
      oldLineNumber: 12,
      newLineNumber: 13,
      type: "context",
    });
  });
});

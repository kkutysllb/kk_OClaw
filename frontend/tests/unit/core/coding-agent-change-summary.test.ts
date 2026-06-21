import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding agent change summary card", () => {
  test("agent panel renders clickable changed files below the chat stream", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain("useCodingSessionChanges");
    expect(agentPanel).toContain("CodingChangeSummaryCard");
    expect(agentPanel).toContain("已编辑");
    expect(agentPanel).toContain("changedFiles");
    expect(agentPanel).toContain("latestTaskId");
    expect(agentPanel).toContain("visibleFiles");
    expect(agentPanel).toContain("slice(0, 4)");
    expect(agentPanel).toContain("max-h-[172px]");
    expect(agentPanel).toContain("更多");
    expect(agentPanel).not.toContain("bottom-[104px]");
    expect(agentPanel).toContain('onFocusFile?.(file.path, "task-changes", file.taskId)');
    expect(agentPanel).toContain("MESSAGE_LIST_CODING_CHANGES_EXTRA_PADDING_BOTTOM");
    expect(workbench).toContain("onFocusFile={focusWorkbenchFile}");
    expect(workbench).toContain("<AgentPanel");
  });
});

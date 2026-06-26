import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding agent memory scope", () => {
  test("agent panel sends stable project id and explicit memory scope", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain("project_id: projectId");
    expect(agentPanel).toContain("memory_scope");
    expect(agentPanel).toContain('type: "coding_project"');
    expect(agentPanel).toContain("workspaceRoot: project_root");
  });
});

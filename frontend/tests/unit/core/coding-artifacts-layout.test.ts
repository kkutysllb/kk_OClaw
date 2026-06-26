import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding artifacts layout", () => {
  test("coding agent panel disables the generic chat artifact side panel", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain('artifactsMode="disabled"');
  });

  test("coding workbench owns artifact state and renders results in the main panel", () => {
    const workbench = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/coding-workbench.tsx"),
      "utf8",
    );

    expect(workbench).toContain("ArtifactsProvider");
    expect(workbench).toContain('aria-label="代码区视图"');
    expect(workbench).toContain('label="结果"');
    expect(workbench).toContain('handleSelectWorkbenchTab("results")');
    expect(workbench).toContain("<CodingResultsPanel");
  });

  test("coding results panel treats missing artifacts as an empty list", () => {
    const resultsPanel = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/coding-results-panel.tsx",
      ),
      "utf8",
    );

    expect(resultsPanel).toContain("const safeArtifacts = artifacts ?? [];");
    expect(resultsPanel).toContain("safeArtifacts.length");
  });

  test("coding results panel renders artifact details without requiring thread context", () => {
    const resultsPanel = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/coding-results-panel.tsx",
      ),
      "utf8",
    );
    const artifactDetail = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/artifacts/artifact-file-detail.tsx",
      ),
      "utf8",
    );

    expect(resultsPanel).toContain("isMock={false}");
    expect(artifactDetail).toContain("isMock: isMockFromProps = false");
    expect(artifactDetail).toContain("useOptionalThread");
  });

  test("artifact preview dependencies tolerate missing thread context", () => {
    const artifactHooks = readFileSync(
      resolve(repoRoot, "src/core/artifacts/hooks.ts"),
      "utf8",
    );
    const codeEditor = readFileSync(
      resolve(repoRoot, "src/components/workspace/code-editor.tsx"),
      "utf8",
    );

    expect(artifactHooks).toContain("useOptionalThread");
    expect(artifactHooks).toContain("threadContext?.thread");
    expect(codeEditor).toContain("useOptionalThread");
    expect(codeEditor).toContain("threadContext?.thread.isLoading ?? false");
  });

  test("coding results panel selects files locally instead of opening the generic artifact panel", () => {
    const resultsPanel = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/coding/coding-results-panel.tsx",
      ),
      "utf8",
    );
    const artifactList = readFileSync(
      resolve(
        repoRoot,
        "src/components/workspace/artifacts/artifact-file-list.tsx",
      ),
      "utf8",
    );

    expect(resultsPanel).toContain("selectedResultArtifact");
    expect(resultsPanel).toContain("onSelectFile={setSelectedResultArtifact}");
    expect(artifactList).toContain(
      "onSelectFile?: (filepath: string) => void;",
    );
    expect(artifactList).toContain("onSelectFile?.(filepath)");
  });

  test("chat box never writes undefined artifacts into context", () => {
    const chatBox = readFileSync(
      resolve(repoRoot, "src/components/workspace/chats/chat-box.tsx"),
      "utf8",
    );

    expect(chatBox).toContain("setArtifacts(thread.values.artifacts ?? []);");
  });

  test("coding agent panel does not create a nested artifacts provider", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).not.toContain("<ArtifactsProvider>");
  });

  test("coding agent panel refreshes project files after file-related agent activity", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain("useQueryClient");
    expect(agentPanel).toContain("refreshProjectFiles");
    expect(agentPanel).toContain('queryKey: ["projects", projectId, "files"]');
    expect(agentPanel).toContain('queryKey: ["projects", projectId, "file"]');
    expect(agentPanel).toContain("onToolEnd:");
    expect(agentPanel).toContain("isFileMutationTool");
    expect(agentPanel).toContain("onFinish:");
  });

  test("coding agent panel exposes a concrete workflow status bar", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain("CodingAgentStatus");
    expect(agentPanel).toContain("agentStatus");
    expect(agentPanel).toContain('"idle"');
    expect(agentPanel).toContain('"thinking"');
    expect(agentPanel).toContain('"running_tool"');
    expect(agentPanel).toContain('"syncing_files"');
    expect(agentPanel).toContain('"completed"');
    expect(agentPanel).toContain('"error"');
    expect(agentPanel).toContain("lastToolLabel");
  });

  test("chat box supports a disabled artifact mode without resizing the chat area", () => {
    const chatBox = readFileSync(
      resolve(repoRoot, "src/components/workspace/chats/chat-box.tsx"),
      "utf8",
    );

    expect(chatBox).toContain('artifactsMode = "side-panel"');
    expect(chatBox).toContain('artifactsMode === "disabled"');
    expect(chatBox).toContain("return <>{children}</>;");
  });
});

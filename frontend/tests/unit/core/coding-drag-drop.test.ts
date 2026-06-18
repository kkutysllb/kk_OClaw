import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding file drag and drop", () => {
  test("file explorer exposes file and directory paths as coding drag payloads", () => {
    const explorer = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/file-explorer.tsx"),
      "utf8",
    );

    expect(explorer).toContain("draggable");
    expect(explorer).toContain("application/x-oclaw-coding-path");
    expect(explorer).toContain(
      "JSON.stringify({ path: node.path, type: node.type })",
    );
    expect(explorer).toContain('event.dataTransfer.effectAllowed = "copy"');
  });

  test("agent panel accepts coding path drops into the prompt input", () => {
    const agentPanel = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/agent-panel.tsx"),
      "utf8",
    );

    expect(agentPanel).toContain("usePromptInputController");
    expect(agentPanel).toContain("parseCodingPathDragPayload");
    expect(agentPanel).toContain("appendCodingPathToInput");
    expect(agentPanel).toContain("onDragOver={handleDragOver}");
    expect(agentPanel).toContain("onDrop={handleDrop}");
    expect(agentPanel).toContain("@${prefix}:${payload.path}");
    expect(agentPanel).toContain("拖放到这里引用文件或目录");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding code viewer", () => {
  test("adds code-workbench actions for path, content, wrapping, and line metadata", () => {
    const codeViewer = readFileSync(
      resolve(repoRoot, "src/components/workspace/coding/code-viewer.tsx"),
      "utf8",
    );

    expect(codeViewer).toContain("<CopyButton");
    expect(codeViewer).toContain("clipboardData={filePath}");
    expect(codeViewer).toContain('tooltip="复制文件路径"');
    expect(codeViewer).toContain("clipboardData={file.content}");
    expect(codeViewer).toContain('tooltip="复制文件内容"');
    expect(codeViewer).toContain(
      '<Tooltip content={wrapLines ? "关闭自动换行" : "开启自动换行"}>',
    );
    expect(codeViewer).toContain("wrapLines");
    expect(codeViewer).toContain("setWrapLines");
    expect(codeViewer).toContain("countLines(file.content)");
    expect(codeViewer).toContain("file.language.toUpperCase()");
    expect(codeViewer).toContain("formatFileSize(file.size)");
    expect(codeViewer).toContain("truncate font-mono text-sm leading-5");
    expect(codeViewer).toContain("wrapLines={wrapLines}");
    expect(codeViewer).not.toContain(
      "[&_pre]:break-words [&_pre]:whitespace-pre-wrap",
    );
  });

  test("code block makes line wrapping an explicit rendering option", () => {
    const codeBlock = readFileSync(
      resolve(repoRoot, "src/components/ai-elements/code-block.tsx"),
      "utf8",
    );

    expect(codeBlock).toContain("wrapLines?: boolean");
    expect(codeBlock).toContain("wrapLines = false");
    expect(codeBlock).toContain("[&>pre]:whitespace-pre-wrap");
    expect(codeBlock).toContain("[&>pre]:whitespace-pre");
  });

  test("copy button supports context-specific tooltip labels", () => {
    const copyButton = readFileSync(
      resolve(repoRoot, "src/components/workspace/copy-button.tsx"),
      "utf8",
    );

    expect(copyButton).toContain("tooltip?: string");
    expect(copyButton).toContain("tooltip ?? t.clipboard.copyToClipboard");
  });
});

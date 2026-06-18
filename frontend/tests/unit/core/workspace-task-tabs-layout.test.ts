import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("workspace task tabs layout", () => {
  test("workspace content mounts task tabs for web and desktop shells", () => {
    const source = readFileSync(
      new URL("../../../src/app/workspace/workspace-content.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("WorkspaceTaskTabs");
    expect(source).toMatch(/<WorkspaceTaskTabs \/>/);
  });

  test("workspace task tabs do not navigate inside a state updater", () => {
    const source = readFileSync(
      new URL("../../../src/components/workspace/workspace-task-tabs.tsx", import.meta.url),
      "utf8",
    );

    const handleCloseStart = source.indexOf("const handleClose = useCallback");
    const renderStart = source.indexOf("if (tabs.length === 0)");
    const handleCloseSource = source.slice(handleCloseStart, renderStart);

    expect(handleCloseSource).toContain("router.push");
    expect(handleCloseSource).not.toContain("setTabs((current)");
  });
});

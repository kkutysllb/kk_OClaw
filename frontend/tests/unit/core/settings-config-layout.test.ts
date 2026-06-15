import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("settings config layout", () => {
  test("prevents Radix scroll area content wrapper from expanding layouts", () => {
    const source = read("src/components/ui/scroll-area.tsx");

    expect(source).toContain("[&>div]:!block");
    expect(source).toContain("[&>div]:!min-w-0");
    expect(source).toContain("[&>div]:!w-full");
  });

  test("keeps the settings dialog content column shrinkable", () => {
    const source = read(
      "src/components/workspace/settings/settings-dialog.tsx",
    );

    expect(source).toContain(
      'className="h-full min-h-0 min-w-0 rounded-lg border"',
    );
    expect(source).toContain('className="min-w-0 space-y-8 p-6"');
  });

  test("keeps config panels shrinkable inside the settings dialog", () => {
    const source = read(
      "src/components/workspace/settings/config-settings-page.tsx",
    );

    expect(source).toContain("flex min-h-[500px] min-w-0 flex-col gap-4");
    expect(source).toContain("flex min-w-0 gap-4");
    expect(source).toContain(
      'className="h-[calc(75vh-10rem)] min-h-[400px] min-w-0 flex-1 rounded-lg border"',
    );
  });

  test("wraps config header actions before they can push content sideways", () => {
    const source = read(
      "src/components/workspace/settings/config-settings-page.tsx",
    );

    expect(source).toContain(
      "flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between",
    );
    expect(source).toContain("min-w-0 items-center gap-2");
    expect(source).toContain(
      'className="w-fit gap-1.5 self-start sm:self-auto"',
    );
  });

  test("wraps model config actions and truncates long model rows", () => {
    const source = read(
      "src/components/workspace/settings/config/model-config-section.tsx",
    );

    expect(source).toContain(
      "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
    );
    expect(source).toContain('className="min-w-0"');
    expect(source).toContain(
      "w-fit bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 sm:self-auto",
    );
    expect(source).toMatch(
      /className="[^"]*group[^"]*flex[^"]*min-w-0[^"]*items-center[^"]*gap-3[^"]*"/,
    );
    expect(source).toContain("flex min-w-0 items-center gap-2");
    expect(source).toContain("min-w-0 truncate text-sm font-medium");
  });
});

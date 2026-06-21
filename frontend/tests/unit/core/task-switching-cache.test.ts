import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("top-level task switching cache", () => {
  test("keeps query data fresh briefly across workspace task tab remounts", () => {
    const source = readFileSync(
      new URL("../../../src/components/query-client-provider.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("staleTime:");
    expect(source).toContain("TASK_SWITCH_STALE_TIME_MS");
    expect(source).toContain("gcTime:");
  });
});

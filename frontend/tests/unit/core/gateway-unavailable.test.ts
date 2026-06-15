import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("gateway unavailable desktop logout", () => {
  test("clears the desktop session token before returning home", () => {
    const source = readFileSync(
      resolve(repoRoot, "src/app/workspace/gateway-unavailable.tsx"),
      "utf8",
    );

    expect(source).toContain("clearDesktopSessionToken");
    expect(source).toContain('import { fetch } from "@/core/api/fetcher";');
  });
});

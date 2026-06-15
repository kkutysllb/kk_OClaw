import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("desktop auth flows", () => {
  test("setup password-change flow uses the authenticated fetch wrapper", () => {
    const setupPage = readFileSync(
      resolve(repoRoot, "src/app/(auth)/setup/page.tsx"),
      "utf8",
    );

    expect(setupPage).toContain(
      'import { fetch, getCsrfHeaders } from "@/core/api/fetcher";',
    );
    expect(setupPage).toContain(
      '${getBackendBaseURL()}/api/v1/auth/change-password',
    );
  });
});

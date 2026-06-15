import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const desktopBuildScript = readFileSync(
  resolve(__dirname, "../../../scripts/desktop-build.mjs"),
  "utf-8",
);

describe("desktop static build", () => {
  test("does not replace the home page with a login redirect", () => {
    expect(desktopBuildScript).not.toContain('file: join(APP_DIR, "page.tsx")');
    expect(desktopBuildScript).not.toContain('router.replace("/login")');
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("desktop backend should not reuse an already running gateway", () => {
  const source = readFileSync(new URL("../src/backend.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /If something is already serving on the port, reuse it\./);
  assert.doesNotMatch(source, /const existing = await this\.checkHealth\(port\)/);
  assert.doesNotMatch(source, /this\.setStatus\(\{ status: "running", port \}\);\s+return this\.getStatus\(\);/);
});

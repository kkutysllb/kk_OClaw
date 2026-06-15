import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const backendSource = readFileSync(
  new URL("../src/backend.ts", import.meta.url),
  "utf8",
);

test("backend stop closes log stream and clears child state", () => {
  assert.match(backendSource, /private async closeLogStream\(\)/);
  assert.match(backendSource, /await this\.closeLogStream\(\)/);
  assert.match(backendSource, /this\.logStream = null/);
});

test("windows backend termination waits for taskkill to finish or timeout", () => {
  assert.match(backendSource, /spawn\("taskkill"/);
  assert.match(backendSource, /taskkill\.once\("exit"/);
  assert.match(backendSource, /setTimeout\(\(\) =>/);
});

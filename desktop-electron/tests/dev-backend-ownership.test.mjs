import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

test("Electron main skips BackendManager launch when the dev launcher owns the gateway", () => {
  assert.match(mainSource, /function isBackendAutolaunchEnabled\(\): boolean/);
  assert.match(mainSource, /OCLAW_SKIP_BACKEND_AUTOLAUNCH/);
  assert.match(mainSource, /if \(isBackendAutolaunchEnabled\(\)\) \{/);
  assert.match(mainSource, /void backend\.launch\(\)/);
});

test("Electron tray disables backend restart when the dev launcher owns the gateway", () => {
  assert.match(mainSource, /const backendManaged = isBackendAutolaunchEnabled\(\)/);
  assert.match(mainSource, /enabled: backendManaged/);
  assert.match(mainSource, /click: \(\) => \{/);
});

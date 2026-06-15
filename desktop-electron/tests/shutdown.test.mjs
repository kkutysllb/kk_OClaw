import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const shutdownSource = readFileSync(new URL("../src/shutdown.ts", import.meta.url), "utf8");

test("desktop quit path forces exit after backend stop timeout", () => {
  assert.match(shutdownSource, /stopBackendWithTimeout/);
  assert.match(shutdownSource, /timeoutMs = 2000/);
  assert.match(mainSource, /stopBackendWithTimeout/);
  assert.match(mainSource, /app\.exit\(0\)/);
});

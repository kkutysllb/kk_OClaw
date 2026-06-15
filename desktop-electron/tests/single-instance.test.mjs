import assert from "node:assert/strict";
import { test } from "node:test";

test("desktop app should enforce a single running instance", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /requestSingleInstanceLock/);
  assert.match(source, /second-instance/);
});

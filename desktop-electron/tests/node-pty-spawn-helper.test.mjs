import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const ipcSource = readFileSync(new URL("../src/ipc.ts", import.meta.url), "utf8");
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

/**
 * node-pty@1.x ships a helper binary at prebuilds/<platform>/spawn-helper
 * that must be executable for posix_spawnp to succeed. pnpm's content-
 * addressable store can drop the executable bit on extraction, which makes
 * pty.spawn fail with the opaque error "posix_spawnp failed." These tests
 * lock in two defenses:
 *
 *   1. Source-level: ipc.ts auto-detects the broken permission and chmods
 *      the helper back to +x before calling pty.spawn.
 *   2. Install-time: package.json runs a postinstall script that walks the
 *      pnpm store and fixes the bit so the next dev never hits this.
 */

test("ipc.ts has a helper that repairs node-pty's spawn-helper permission", () => {
  assert.match(
    ipcSource,
    /function\s+ensureNodePtySpawnHelperExecutable/,
    "expected an ensureNodePtySpawnHelperExecutable() helper in src/ipc.ts",
  );
  // The helper must chmod the resolved spawn-helper path to 0o755. The
  // argument may be a local variable (e.g. `helper`) rather than the
  // literal string — both forms are acceptable as long as 0o755 is set.
  assert.match(
    ipcSource,
    /chmodSync\([^,]+,\s*0o755\s*\)/,
    "expected the helper to chmod the spawn-helper path to 0o755",
  );
  // And it should probe with X_OK first so the common (already-correct)
  // case is a single stat() call rather than an unconditional chmod().
  assert.match(
    ipcSource,
    /accessSync\([^,]+,\s*constants\.X_OK/,
    "expected the helper to probe the spawn-helper with X_OK before chmod",
  );
  // The helper must be invoked from the spawn path so a broken install
  // self-heals the moment the user clicks "open terminal".
  assert.match(
    ipcSource,
    /ensureNodePtySpawnHelperExecutable\(\)/,
    "ensureNodePtySpawnHelperExecutable must be called from startEmbeddedTerminal",
  );
});

test("package.json declares a postinstall that re-applies +x to spawn-helper", () => {
  const scripts = pkg.scripts ?? {};
  assert.ok(
    typeof scripts.postinstall === "string",
    "expected desktop-electron/package.json to define scripts.postinstall",
  );
  // The postinstall delegates to scripts/fix-node-pty-permissions.mjs;
  // the contract is the file name, not the literal string "spawn-helper"
  // in package.json.
  assert.match(
    scripts.postinstall,
    /fix-node-pty-permissions/,
    "postinstall must reference scripts/fix-node-pty-permissions",
  );
  // And that script must apply the executable bit.
  const fixerPath = new URL("../scripts/fix-node-pty-permissions.mjs", import.meta.url);
  const fixerSource = readFileSync(fixerPath, "utf8");
  assert.match(
    fixerSource,
    /chmodSync\([^,]+,\s*0o755\s*\)/,
    "scripts/fix-node-pty-permissions.mjs must chmod to 0o755",
  );
  assert.match(
    fixerSource,
    /spawn-helper/,
    "scripts/fix-node-pty-permissions.mjs must reference spawn-helper",
  );
});

test("repro: spawn-helper without +x is what breaks posix_spawnp", () => {
  // Locate the helper inside the pnpm store. Skip if not installed yet
  // (e.g. CI cache miss) — the source-level test above still guards.
  const require = createRequire(import.meta.url + "/../");
  let ptyPath;
  try {
    ptyPath = require.resolve("node-pty");
  } catch {
    return;
  }
  const pkgRoot = path.dirname(path.dirname(ptyPath)); // .../node-pty
  const platformArch = `${process.platform}-${process.arch}`;
  const helper = path.join(pkgRoot, "prebuilds", platformArch, "spawn-helper");
  if (!existsSync(helper)) return;

  const st = statSync(helper);
  // This is the property under test. If somebody re-installs via pnpm and
  // forgets the postinstall, this assertion fires — telling them exactly
  // what to fix.
  assert.ok(
    (st.mode & 0o111) !== 0,
    `spawn-helper at ${helper} is missing the executable bit ` +
      `(mode=0o${st.mode.toString(8)}). Run the postinstall or chmod +x ` +
      `manually; otherwise pty.spawn throws "posix_spawnp failed.".`,
  );
});
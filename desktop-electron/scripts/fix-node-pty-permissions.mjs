#!/usr/bin/env node
/**
 * Repair node-pty's bundled `spawn-helper` executable bit after install.
 *
 * Why this exists
 * ───────────────
 * node-pty@1.x ships a helper binary at
 *   prebuilds/<platform>-<arch>/spawn-helper
 * that is exec'd via `posix_spawnp` whenever the renderer opens a project
 * terminal. The package's own `install.js` chmods that helper to 0o755,
 * but pnpm's content-addressable store can copy the file out without
 * preserving the mode — and from there symlink/hardlink into the project
 * still leaves it non-executable. When that happens, pty.spawn fails with
 * the opaque error `posix_spawnp failed.` (it really means EACCES from
 * the kernel).
 *
 * This script walks every node-pty install it can find under the project
 * (pnpm store paths AND hoisted node_modules) and re-applies 0o755 to
 * `spawn-helper`. It's idempotent — files that are already executable are
 * skipped — and a no-op when node-pty isn't installed yet.
 *
 * Wired up from `desktop-electron/package.json` as the `postinstall` hook.
 */

import { accessSync, chmodSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const platformArch = `${process.platform}-${process.arch}`;
const RELATIVE_HELPER = join("prebuilds", platformArch, "spawn-helper");
const X_OK = 1; // fs.constants.X_OK on POSIX

/**
 * Walk up from `start` until we find a directory that contains a
 * `node_modules/` entry. We then enumerate both the pnpm store
 * (`node_modules/.pnpm/`) and the hoisted `node_modules/` themselves.
 *
 * Bounded at 5 levels so a broken monorepo can't make us crawl the whole
 * filesystem; in practice the desktop shell lives 1–3 levels deep.
 */
function* findNodeModulesRoots(start) {
  let dir = start;
  for (let depth = 0; depth < 5; depth += 1) {
    const nm = join(dir, "node_modules");
    try {
      if (statSync(nm).isDirectory()) yield nm;
    } catch {
      // no node_modules here
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function* findNodePtyInstalls(nodeModulesRoot) {
  // pnpm store: node_modules/.pnpm/node-pty@<version>/node_modules/node-pty
  const store = join(nodeModulesRoot, ".pnpm");
  let storeEntries;
  try {
    storeEntries = readdirSync(store);
  } catch {
    storeEntries = [];
  }
  for (const entry of storeEntries) {
    if (!entry.startsWith("node-pty@")) continue;
    const candidate = join(store, entry, "node_modules", "node-pty");
    try {
      if (statSync(candidate).isDirectory()) yield candidate;
    } catch {
      // skip
    }
  }

  // hoisted (npm / pnpm-shim): node_modules/node-pty
  const hoisted = join(nodeModulesRoot, "node-pty");
  try {
    if (statSync(hoisted).isDirectory()) yield hoisted;
  } catch {
    // not hoisted
  }
}

function isExecutable(path) {
  try {
    accessSync(path, X_OK);
    return true;
  } catch {
    return false;
  }
}

let inspected = 0;
let repaired = 0;
let skipped = 0;

for (const nm of findNodeModulesRoots(PROJECT_ROOT)) {
  for (const pkgRoot of findNodePtyInstalls(nm)) {
    const helper = join(pkgRoot, RELATIVE_HELPER);
    try {
      statSync(helper);
    } catch {
      // No prebuild for this platform — skip silently.
      continue;
    }
    inspected += 1;

    if (isExecutable(helper)) {
      skipped += 1;
      continue;
    }

    try {
      chmodSync(helper, 0o755);
      repaired += 1;
      console.log(
        `[fix-node-pty-permissions] +x ${helper} (was missing executable bit)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[fix-node-pty-permissions] could not chmod ${helper}: ${message}`,
      );
    }
  }
}

if (inspected === 0) {
  console.log(
    "[fix-node-pty-permissions] node-pty not installed yet — nothing to do.",
  );
} else {
  console.log(
    `[fix-node-pty-permissions] inspected ${inspected} node-pty install(s); ` +
      `repaired ${repaired}, already OK ${skipped}.`,
  );
}
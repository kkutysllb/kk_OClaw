#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const DESKTOP_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(DESKTOP_DIR, "..");

const GATEWAY_DIR = join(DESKTOP_DIR, "resources", "gateway");
const FRONTEND_OUT_DIR = join(REPO_ROOT, "frontend", "out");

const checks = [];

function pass(label) {
  checks.push({ label, ok: true });
}

function fail(label, detail) {
  checks.push({ label, ok: false, detail });
}

function requirePath(path, label) {
  if (!existsSync(path)) {
    fail(label, `Missing: ${path}`);
    return false;
  }
  pass(label);
  return true;
}

function requireFileContains(path, label, patterns) {
  if (!requirePath(path, label)) return;
  const contents = readFileSync(path, "utf8");
  for (const pattern of patterns) {
    if (!contents.includes(pattern)) {
      fail(`${label} contains ${pattern}`, `Expected marker not found in ${path}`);
      return;
    }
  }
  pass(`${label} contains required markers`);
}

function requireExecutable(path, label) {
  if (!requirePath(path, label)) return;
  const mode = statSync(path).mode;
  if (process.platform !== "win32" && (mode & 0o111) === 0) {
    fail(label, `Not executable: ${path}`);
    return;
  }
  pass(`${label} is executable`);
}

function gatewayExecutablePath() {
  return join(
    GATEWAY_DIR,
    process.platform === "win32" ? "oclaw-gateway.exe" : "oclaw-gateway",
  );
}

requireExecutable(gatewayExecutablePath(), "resources/gateway executable");
requirePath(join(FRONTEND_OUT_DIR, "index.html"), "frontend/out index.html");
requirePath(join(FRONTEND_OUT_DIR, "_next"), "frontend/out _next assets");
requirePath(
  join(GATEWAY_DIR, "_internal", "config.embedded.yaml"),
  "resources/gateway config.embedded.yaml",
);
requirePath(
  join(GATEWAY_DIR, "_internal", "skills", "public"),
  "resources/gateway skills/public",
);
requireFileContains(
  join(GATEWAY_DIR, "_internal", "kkoclaw", "skills", "storage", "local_skill_storage.py"),
  "resources/gateway local_skill_storage.py",
  ["KKOCLAW_PUBLIC_SKILLS_ONLY", "public_only"],
);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const prefix = check.ok ? "[OK]" : "[FAIL]";
  console.log(`${prefix} ${check.label}`);
  if (!check.ok && check.detail) console.log(`       ${check.detail}`);
}

if (failed.length > 0) {
  console.error(
    `\nPackage resource verification failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}

console.log("\nPackage resources are ready for electron-builder.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const backendSource = readFileSync(
  new URL("../src/backend.ts", import.meta.url),
  "utf8",
);
const embeddedConfig = readFileSync(
  new URL("../backend-build/config.embedded.yaml", import.meta.url),
  "utf8",
);

test("desktop backend initializes and uses an isolated config.yaml", () => {
  assert.match(backendSource, /initConfig\(\)/);
  assert.match(backendSource, /config\.embedded\.yaml/);
  assert.match(backendSource, /KKOCLAW_CONFIG_PATH/);
  assert.match(backendSource, /KKOCLAW_DATA_DIR/);
  assert.match(backendSource, /getDesktopConfigPath\(\)/);
});

test("desktop backend migrates existing isolated config.yaml on launch", () => {
  assert.match(backendSource, /migrateConfig\(\)/);
  assert.match(backendSource, /migrateDesktopConfigYaml\(original\)/);
  assert.match(backendSource, /config-migration\.js/);
});

test("desktop default config enables the agents API used by the desktop UI", () => {
  assert.match(embeddedConfig, /agents_api:\s*\n\s+enabled:\s+true/);
});

test("desktop default config includes coding agent settings", () => {
  assert.match(embeddedConfig, /coding_agent:\s*\n\s+enabled:\s+true/);
  assert.match(embeddedConfig, /default_permission_mode:\s+safe-only/);
  assert.match(embeddedConfig, /post_edit_verify_enabled:\s+true/);
  assert.match(embeddedConfig, /post_edit_verify_mode:\s+soft/);
  assert.match(embeddedConfig, /auto_accept_forward_stage:\s+false/);
  assert.match(embeddedConfig, /worktree:\s*\n\s+enabled:\s+true/);
  assert.ok(
    embeddedConfig.includes("- pytest") &&
      embeddedConfig.includes("- jest") &&
      embeddedConfig.includes("- vitest") &&
      embeddedConfig.includes("- go test"),
    "embedded config must list pytest/jest/vitest/go test frameworks",
  );
});

test("desktop default config stores sqlite under the desktop data directory", () => {
  assert.match(embeddedConfig, /database:\s*\n\s+backend:\s+sqlite\n\s+sqlite_dir:\s+\$KKOCLAW_DATA_DIR/);
});

test("desktop backend uses an isolated extensions config instead of repo MCP config", () => {
  assert.match(backendSource, /KKOCLAW_EXTENSIONS_CONFIG_PATH/);
  assert.match(backendSource, /getDesktopExtensionsConfigPath\(\)/);
  assert.match(backendSource, /initExtensionsConfig\(\)/);
});

test("desktop seeds public skills and allows user-created custom skills", () => {
  // Still seed bundled public skills so first run has a non-empty skill set.
  assert.match(backendSource, /publicTarget/);
  // Create an empty custom/ dir so users can author their own skills at
  // runtime (web-to-desktop migration also depends on this).
  assert.match(backendSource, /mkdirSync\(join\(skillsRoot,\s*"custom"\)/);
  // Intentionally do NOT set KKOCLAW_PUBLIC_SKILLS_ONLY at runtime — that
  // flag was for bundling-time, not for forbidding user-created skills.
  assert.doesNotMatch(backendSource, /KKOCLAW_PUBLIC_SKILLS_ONLY:\s*"1"/);
});

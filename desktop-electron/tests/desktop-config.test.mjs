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
  assert.match(embeddedConfig, /worktree:\s*\n\s+enabled:\s+true/);
  assert.match(embeddedConfig, /frameworks:\s*\n\s+- pytest\n\s+- jest\n\s+- vitest\n\s+- go test/);
});

test("desktop default config stores sqlite under the desktop data directory", () => {
  assert.match(embeddedConfig, /database:\s*\n\s+backend:\s+sqlite\n\s+sqlite_dir:\s+\$KKOCLAW_DATA_DIR/);
});

test("desktop backend uses an isolated extensions config instead of repo MCP config", () => {
  assert.match(backendSource, /KKOCLAW_EXTENSIONS_CONFIG_PATH/);
  assert.match(backendSource, /getDesktopExtensionsConfigPath\(\)/);
  assert.match(backendSource, /initExtensionsConfig\(\)/);
});

test("desktop backend only initializes public skills", () => {
  assert.doesNotMatch(backendSource, /customTarget/);
  assert.doesNotMatch(backendSource, /mkdirSync\(.*custom/);
  assert.match(backendSource, /publicTarget/);
  assert.match(backendSource, /KKOCLAW_PUBLIC_SKILLS_ONLY:\s*"1"/);
});

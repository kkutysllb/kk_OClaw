import assert from "node:assert/strict";
import { test } from "node:test";

import { migrateDesktopConfigYaml } from "../dist/config-migration.js";

test("desktop config migration pins sqlite storage to the desktop data dir", () => {
  const migrated = migrateDesktopConfigYaml(`config_version: 8
database:
  backend: sqlite
  sqlite_dir: .kkoclaw/data
agents_api:
  enabled: false
`);

  assert.match(migrated, /database:\n\s+backend:\s+sqlite\n\s+sqlite_dir:\s+\$KKOCLAW_DATA_DIR/);
  assert.match(migrated, /agents_api:\n\s+enabled:\s+true/);
});

test("desktop config migration is idempotent for existing defaults", () => {
  const original = `config_version: 8
database:
  backend: sqlite
  sqlite_dir: $KKOCLAW_DATA_DIR
agents_api:
  enabled: true
`;

  assert.equal(migrateDesktopConfigYaml(original), original);
  assert.equal(migrateDesktopConfigYaml(migrateDesktopConfigYaml(original)), original);
});

test("desktop config migration removes duplicate agents api sections", () => {
  const migrated = migrateDesktopConfigYaml(`config_version: 8
agents_api:
  enabled: true

agents_api:
  enabled: true
`);

  assert.equal((migrated.match(/^agents_api:/gm) ?? []).length, 1);
  assert.match(migrated, /agents_api:\n\s+enabled:\s+true/);
});

test("desktop config migration preserves explicit postgres database configs", () => {
  const original = `config_version: 8
database:
  backend: postgres
  postgres_url: $DATABASE_URL
agents_api:
  enabled: true
`;

  assert.equal(migrateDesktopConfigYaml(original), original);
});

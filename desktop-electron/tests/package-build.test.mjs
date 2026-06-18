import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const verifierUrl = new URL("../scripts/verify-package-resources.mjs", import.meta.url);

test("packaged app build rebuilds and verifies the embedded gateway", () => {
  assert.match(packageJson.scripts["build:app"], /pnpm run build:gateway/);
  assert.match(packageJson.scripts["build:app"], /pnpm run verify:package-resources/);
  assert.match(packageJson.scripts["build:app:full"], /pnpm run build:app/);
});

test("package resource verifier rejects stale or incomplete gateway bundles", () => {
  assert.equal(existsSync(verifierUrl), true);
  const verifierSource = readFileSync(verifierUrl, "utf8");
  assert.match(verifierSource, /resources\/gateway/);
  assert.match(verifierSource, /frontend\/out/);
  assert.match(verifierSource, /KKOCLAW_PUBLIC_SKILLS_ONLY/);
  assert.match(verifierSource, /config\.embedded\.yaml/);
  assert.match(verifierSource, /skills\/public/);
});

test("packaged app ships small tray icons separately from the app icon", () => {
  const builderConfig = readFileSync(
    new URL("../electron-builder.yml", import.meta.url),
    "utf8",
  );
  assert.match(builderConfig, /from: build\/icons/);
  assert.match(builderConfig, /to: icons/);
  assert.match(builderConfig, /16x16\.png/);
  assert.match(builderConfig, /32x32\.png/);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveFrontendRequestPath } from "../dist/frontend-protocol.js";

test("maps app route URLs to exported html files", () => {
  assert.equal(resolveFrontendRequestPath("/"), "index.html");
  assert.equal(resolveFrontendRequestPath("/login"), "login.html");
  assert.equal(resolveFrontendRequestPath("/setup?from=login"), "setup.html");
  assert.equal(resolveFrontendRequestPath("/workspace/chats"), "workspace/chats.html");
});

test("keeps static asset paths unchanged", () => {
  assert.equal(
    resolveFrontendRequestPath("/_next/static/chunks/main.js"),
    "_next/static/chunks/main.js",
  );
  assert.equal(resolveFrontendRequestPath("/favicon.svg"), "favicon.svg");
});

test("blocks path traversal before serving static assets", () => {
  assert.equal(resolveFrontendRequestPath("/_next/static/../../package.json"), "index.html");
  assert.equal(resolveFrontendRequestPath("/images/%2e%2e/%2e%2e/package.json"), "index.html");
  assert.equal(resolveFrontendRequestPath("/../../desktop-electron/package.json"), "index.html");
});

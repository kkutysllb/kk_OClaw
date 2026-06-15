import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
} from "../dist/url-policy.js";

test("allows only app and dev-server URLs inside the desktop window", () => {
  assert.equal(isAllowedAppNavigationUrl("app://-/workspace"), true);
  assert.equal(
    isAllowedAppNavigationUrl("http://127.0.0.1:18659/workspace"),
    true,
  );
  assert.equal(isAllowedAppNavigationUrl("file:///tmp/dropped.html"), false);
  assert.equal(isAllowedAppNavigationUrl("https://example.com"), false);
});

test("allows only http and https external URLs", () => {
  assert.equal(isAllowedExternalUrl("https://example.com"), true);
  assert.equal(isAllowedExternalUrl("http://example.com"), true);
  assert.equal(isAllowedExternalUrl("file:///tmp/secret.txt"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("app://-/workspace"), false);
});

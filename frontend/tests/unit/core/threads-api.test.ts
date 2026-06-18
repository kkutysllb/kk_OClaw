import { describe, expect, test } from "vitest";

import { threadTitlePath } from "@/core/threads/api";

describe("threads api", () => {
  test("encodes thread id for title lookup path", () => {
    expect(threadTitlePath("thread/with space")).toBe(
      "/api/threads/thread%2Fwith%20space",
    );
  });
});

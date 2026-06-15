import { describe, expect, test } from "vitest";

import {
  getNextApiKeyInputState,
  toApiKeyRequestValue,
} from "@/components/workspace/models/model-dialog";

describe("ModelDialog API key input behavior", () => {
  test("keeps the pasted value when editing starts from a hidden API key field", () => {
    const next = getNextApiKeyInputState({
      nextInputValue: "sk-pasted-from-clipboard",
      showApiKey: false,
    });

    expect(next).toEqual({
      apiKey: "sk-pasted-from-clipboard",
      showApiKey: true,
    });
  });

  test("preserves an existing hidden API key when the saved value is unchanged", () => {
    expect(
      toApiKeyRequestValue({
        apiKey: "existing-secret",
        originalApiKey: "existing-secret",
        showApiKey: false,
      }),
    ).toBeNull();
  });

  test("sends a changed API key after hidden-field editing reveals the field", () => {
    expect(
      toApiKeyRequestValue({
        apiKey: "sk-new-secret",
        originalApiKey: "existing-secret",
        showApiKey: true,
      }),
    ).toBe("sk-new-secret");
  });
});

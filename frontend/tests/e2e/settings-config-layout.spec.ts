import { expect, test } from "@playwright/test";

import { mockLangGraphAPI, type MockModel } from "./utils/mock-api";

const longModelName =
  "deepseek-r1-ultra-long-display-name-for-layout-regression-" + "x".repeat(90);

const longModel: MockModel = {
  id: "long-model-1",
  name: longModelName,
  display_name: longModelName,
  use: "deepseek-openai-compatible-provider-with-a-very-long-route-name",
  model:
    "deepseek-reasoner-with-an-extraordinarily-long-model-identifier-" +
    "y".repeat(80),
  supports_thinking: true,
  supports_vision: true,
};

test.describe("System config layout", () => {
  test("keeps model actions visible when configured models have long names", async ({
    page,
  }) => {
    await page.context().addCookies([
      {
        name: "sidebar_state",
        value: "true",
        url: "http://localhost:9192",
      },
    ]);
    mockLangGraphAPI(page, { models: [longModel] });

    await page.goto("/workspace/chats/new");
    await page.getByRole("button", { name: /e2e@test\.local/i }).click();
    await page.getByRole("menuitem", { name: /Appearance|外观/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog
      .getByRole("button", { name: /System Config|系统配置/ })
      .click();

    await expect(dialog.getByText(longModelName)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      dialog.getByRole("button", { name: "应用并重启" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "添加模型" }).first(),
    ).toBeVisible();

    const bounds = await page.evaluate(() => {
      const dialogElement = document.querySelector('[role="dialog"]');
      if (!dialogElement) throw new Error("dialog missing");
      const buttons = Array.from(dialogElement.querySelectorAll("button"));
      const findButton = (text: string) => {
        const button = buttons.find((node) => node.textContent?.includes(text));
        if (!button) throw new Error(`${text} button missing`);
        return button;
      };
      const rectOf = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      };
      return {
        viewportWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        dialogClientWidth: dialogElement.clientWidth,
        dialogScrollWidth: dialogElement.scrollWidth,
        dialog: rectOf(dialogElement),
        restart: rectOf(findButton("应用并重启")),
        add: rectOf(findButton("添加模型")),
      };
    });

    expect(bounds.docScrollWidth).toBeLessThanOrEqual(bounds.viewportWidth + 2);
    expect(bounds.dialogScrollWidth).toBeLessThanOrEqual(
      bounds.dialogClientWidth + 2,
    );
    for (const button of [bounds.restart, bounds.add]) {
      expect(button.left).toBeGreaterThanOrEqual(bounds.dialog.left - 2);
      expect(button.right).toBeLessThanOrEqual(bounds.dialog.right + 2);
      expect(button.width).toBeGreaterThan(0);
    }
  });
});

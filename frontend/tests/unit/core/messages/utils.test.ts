import { expect, test } from "vitest";

import {
  extractContentFromMessage,
  isHiddenFromUIMessage,
  stripInternalContent,
} from "@/core/messages/utils";

test("stripInternalContent removes internal planning blocks with non-breaking spaces in the header", () => {
  const leakedContent = [
    "SESSION\u00A0INTENT",
    "用户请求分析2026年5月22日A股大盘情况，生成结构化大盘分析报告。",
    "",
    "SUMMARY",
    "数据采集完成情况",
  ].join("\n");

  expect(stripInternalContent(leakedContent)).toBe("");
});

test("isHiddenFromUIMessage hides ai messages whose internal header uses non-breaking spaces", () => {
  const message = {
    type: "ai",
    content: [
      {
        type: "text",
        text: "SESSION\u00A0INTENT\n用户请求分析2026年5月22日A股大盘情况，生成结构化大盘分析报告。",
      },
    ],
    additional_kwargs: {},
  };

  expect(isHiddenFromUIMessage(message as never)).toBe(true);
});

test("extractContentFromMessage strips internal planning blocks from tool messages", () => {
  const message = {
    type: "tool",
    content:
      "SESSION INTENT\n用户要求分析上周五的股指期货情况。\n\nSUMMARY\nTushare Token可用",
  };

  expect(extractContentFromMessage(message as never)).toBe("");
});

test("extractContentFromMessage strips internal planning blocks from ai array content", () => {
  const message = {
    type: "ai",
    content: [
      {
        type: "text",
        text: "SESSION INTENT\n用户要求分析上周五的股指期货情况。",
      },
    ],
    additional_kwargs: {},
  };

  expect(extractContentFromMessage(message as never)).toBe("");
});

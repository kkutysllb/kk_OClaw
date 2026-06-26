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

test("isHiddenFromUIMessage hides summarization human messages with internal headers", () => {
  const message = {
    type: "human",
    name: "summary",
    content: [
      {
        type: "text",
        text: "SESSION INTENT\nThe user wants to review implementation progress.\n\nSUMMARY\nProject root available.",
      },
    ],
    additional_kwargs: {},
  };

  expect(isHiddenFromUIMessage(message as never)).toBe(true);
});

test("isHiddenFromUIMessage hides internal header messages even without metadata", () => {
  const message = {
    type: "human",
    content:
      "SESSION INTENT\nThe user wants to review implementation progress.\n\nSUMMARY\nProject root available.",
    additional_kwargs: {},
  };

  expect(isHiddenFromUIMessage(message as never)).toBe(true);
});

test("isHiddenFromUIMessage hides todo middleware reminders by protocol name", () => {
  const reminder = {
    type: "human",
    name: "todo_completion_reminder",
    content:
      "<system_reminder>\nYou have incomplete todo items.\n</system_reminder>",
    additional_kwargs: {},
  };

  expect(isHiddenFromUIMessage(reminder as never)).toBe(true);
});

test("isHiddenFromUIMessage hides known internal system reminders without metadata", () => {
  const reminder = {
    type: "human",
    name: "todo_reminder",
    content:
      "<system_reminder>\nYour todo list from earlier is no longer visible.\n</system_reminder>",
    additional_kwargs: {},
  };

  expect(isHiddenFromUIMessage(reminder as never)).toBe(true);
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

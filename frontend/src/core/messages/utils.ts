import type { AIMessage, Message } from "@langchain/langgraph-sdk";

interface GenericMessageGroup<T = string> {
  type: T;
  id: string | undefined;
  messages: Message[];
}

interface HumanMessageGroup extends GenericMessageGroup<"human"> {}

interface AssistantProcessingGroup extends GenericMessageGroup<"assistant:processing"> {}

interface AssistantMessageGroup extends GenericMessageGroup<"assistant"> {}

interface AssistantPresentFilesGroup extends GenericMessageGroup<"assistant:present-files"> {}

interface AssistantClarificationGroup extends GenericMessageGroup<"assistant:clarification"> {}

interface AssistantSubagentGroup extends GenericMessageGroup<"assistant:subagent"> {}

type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup;

export function groupMessages<T>(
  messages: Message[],
  mapper: (group: MessageGroup) => T,
): T[] {
  if (messages.length === 0) {
    return [];
  }

  const groups: MessageGroup[] = [];
  let groupIndex = 0;

  function nextGroupId(messageId: string | undefined): string {
    return `${messageId ?? "unknown"}--${groupIndex++}`;
  }

  // Returns the last group if it can still accept tool messages
  // (i.e. it's an in-flight processing group, not a terminal human/assistant group).
  function lastOpenGroup() {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.type !== "human" &&
      last.type !== "assistant" &&
      last.type !== "assistant:clarification"
    ) {
      return last;
    }
    return null;
  }

  for (const message of messages) {
    if (isHiddenFromUIMessage(message)) {
      continue;
    }

    if (message.type === "human") {
      groups.push({ id: nextGroupId(message.id), type: "human", messages: [message] });
      continue;
    }

    if (message.type === "tool") {
      if (isClarificationToolMessage(message)) {
        // Add to the preceding processing group to preserve tool-call association,
        // then also open a standalone clarification group for prominent display.
        lastOpenGroup()?.messages.push(message);
        groups.push({
          id: nextGroupId(message.id),
          type: "assistant:clarification",
          messages: [message],
        });
      } else {
        const open = lastOpenGroup();
        if (open) {
          open.messages.push(message);
        } else {
          // Tool messages without an open processing group are typically
          // caused by upstream LLM failures (e.g. model errors, timeouts)
          // that prevented the corresponding tool-call AI message from
          // being created.  The backend already surfaces the error to the
          // user via the error-handling middleware, so we silently skip
          // the orphaned tool result here.
          console.warn(
            "Orphaned tool message (no open processing group) — this is expected when an LLM call fails upstream",
            message.name ?? message.type,
          );
        }
      }
      continue;
    }

    if (message.type === "ai") {
      if (hasPresentFiles(message)) {
        groups.push({
          id: nextGroupId(message.id),
          type: "assistant:present-files",
          messages: [message],
        });
      } else if (hasSubagent(message)) {
        groups.push({
          id: nextGroupId(message.id),
          type: "assistant:subagent",
          messages: [message],
        });
      } else if (hasReasoning(message) || hasToolCalls(message)) {
        const lastGroup = groups[groups.length - 1];
        // Accumulate consecutive intermediate AI messages into one processing group.
        if (lastGroup?.type !== "assistant:processing") {
          groups.push({
            id: nextGroupId(message.id),
            type: "assistant:processing",
            messages: [message],
          });
        } else {
          lastGroup.messages.push(message);
        }
      }

      // Not an else-if: a message with reasoning + content (but no tool calls) goes
      // into the processing group above AND gets its own assistant bubble here.
      if (hasContent(message) && !hasToolCalls(message)) {
        groups.push({ id: nextGroupId(message.id), type: "assistant", messages: [message] });
      }
    }
  }

  return groups
    .map(mapper)
    .filter((result) => result !== undefined && result !== null) as T[];
}

export function extractTextFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return (
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim()
    );
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g;

function splitInlineReasoning(content: string) {
  const reasoningParts: string[] = [];
  const cleaned = content
    .replace(THINK_TAG_RE, (_, reasoning: string) => {
      const normalized = reasoning.trim();
      if (normalized) {
        reasoningParts.push(normalized);
      }
      return "";
    })
    .trim();

  return {
    content: cleaned,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
  };
}

function splitInlineReasoningFromAIMessage(message: Message) {
  if (message.type !== "ai" || typeof message.content !== "string") {
    return null;
  }
  return splitInlineReasoning(message.content);
}

export function extractContentFromMessage(message: Message) {
  const sanitizeForDisplay = (content: string) =>
    message.type === "human" ? content : stripInternalContent(content);

  if (typeof message.content === "string") {
    return sanitizeForDisplay(
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim()
    );
  }
  if (Array.isArray(message.content)) {
    return sanitizeForDisplay(
      message.content
        .map((content) => {
          switch (content.type) {
            case "text":
              return content.text;
            case "image_url":
              const imageURL = extractURLFromImageURLContent(content.image_url);
              return `![image](${imageURL})`;
            default:
              return "";
          }
        })
        .join("\n")
        .trim(),
    );
  }
  return "";
}

export function extractReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return null;
  }
  if (
    message.additional_kwargs &&
    "reasoning_content" in message.additional_kwargs
  ) {
    return message.additional_kwargs.reasoning_content as string | null;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    if (part && "thinking" in part) {
      return part.thinking as string;
    }
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning;
  }
  return null;
}

export function removeReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai" || !message.additional_kwargs) {
    return;
  }
  delete message.additional_kwargs.reasoning_content;
}

export function extractURLFromImageURLContent(
  content:
    | string
    | {
        url: string;
      },
) {
  if (typeof content === "string") {
    return content;
  }
  return content.url;
}

export function hasContent(message: Message) {
  if (typeof message.content === "string") {
    return (
      (
        splitInlineReasoningFromAIMessage(message)?.content ??
        message.content.trim()
      ).length > 0
    );
  }
  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }
  return false;
}

export function hasReasoning(message: Message) {
  if (message.type !== "ai") {
    return false;
  }
  if (typeof message.additional_kwargs?.reasoning_content === "string") {
    return true;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    // Compatible with the Anthropic gateway
    return (part as unknown as { type: "thinking" })?.type === "thinking";
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning !== null;
  }
  return false;
}

export function hasToolCalls(message: Message) {
  return (
    message.type === "ai" && message.tool_calls && message.tool_calls.length > 0
  );
}

export function hasPresentFiles(message: Message) {
  return (
    message.type === "ai" &&
    message.tool_calls?.some((toolCall) => toolCall.name === "present_files")
  );
}

export function isClarificationToolMessage(message: Message) {
  return message.type === "tool" && message.name === "ask_clarification";
}

export function extractPresentFilesFromMessage(message: Message) {
  if (message.type !== "ai" || !hasPresentFiles(message)) {
    return [];
  }
  const files: string[] = [];
  for (const toolCall of message.tool_calls ?? []) {
    if (
      toolCall.name === "present_files" &&
      Array.isArray(toolCall.args.filepaths)
    ) {
      files.push(...(toolCall.args.filepaths as string[]));
    }
  }
  return files;
}

export function hasSubagent(message: AIMessage) {
  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.name === "task") {
      return true;
    }
  }
  return false;
}

export function findToolCallResult(toolCallId: string, messages: Message[]) {
  for (const message of messages) {
    if (message.type === "tool" && message.tool_call_id === toolCallId) {
      const content = extractTextFromMessage(message);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

const AGENT_ARTIFACT_HEADER_RE =
  /^(?:#\s*)?(?:SESSION\s+INTENT|SUMMARY|ARTIFACTS?)(?:[\s\n]|$)/i;
const INTERNAL_MESSAGE_NAMES = new Set([
  "summary",
  "loop_warning",
  "todo_reminder",
  "todo_completion_reminder",
  "memory_context",
  "token_economy_instruction",
  "view_image_details",
]);
const KNOWN_INTERNAL_REMINDER_NAMES = new Set([
  "todo_reminder",
  "todo_completion_reminder",
]);
const SYSTEM_REMINDER_RE = /^\s*<system[-_]reminder>[\s\S]*<\/system[-_]reminder>\s*$/i;

export function isHiddenFromUIMessage(message: Message) {
  if (
    message.additional_kwargs?.hide_from_ui === true ||
    typeof message.additional_kwargs?.internal_middleware_message === "string" ||
    (typeof message.name === "string" && INTERNAL_MESSAGE_NAMES.has(message.name))
  ) {
    return true;
  }
  // Filter out middleware messages from real-time stream
  const meta = (message as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined;
  if (typeof meta?.caller === "string" && meta.caller.startsWith("middleware:")) {
    return true;
  }
  // Check for internal artifact headers (SESSION INTENT / SUMMARY / ARTIFACTS).
  // These are AI agent internal planning blocks that should never be shown to users.
  // We check the full extracted content AND individual content blocks (for array
  // content where the header might not be at the start of the joined text).
  if (message.type !== "tool" && !("tool_calls" in message && message.tool_calls?.length)) {
    const content = extractContentFromMessage(message);
    if (content && AGENT_ARTIFACT_HEADER_RE.test(content.trim())) {
      return true;
    }
    // Also check individual content blocks
    if (Array.isArray(message.content)) {
      for (const block of message.content as Array<{ type?: string; text?: string }>) {
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          AGENT_ARTIFACT_HEADER_RE.test(block.text.trim())
        ) {
          return true;
        }
      }
    }
  }
  if (
    message.type === "human" &&
    typeof message.name === "string" &&
    KNOWN_INTERNAL_REMINDER_NAMES.has(message.name)
  ) {
    const content = extractTextFromMessage(message);
    if (SYSTEM_REMINDER_RE.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Strip internal planning blocks (SESSION INTENT, SUMMARY, ARTIFACTS)
 * from AI response content before displaying to the user.
 * Also masks sensitive values (API keys, tokens, passwords) in remaining text.
 *
 * Strategy:
 *   - First check: if the first non-blank line is an internal header, the
 *     ENTIRE text is internal planning content — return empty string.
 *     This handles the common case where SESSION INTENT + SUMMARY + details
 *     are the only content in the message.
 *   - Otherwise, remove internal blocks that appear AFTER user-facing content:
 *     enter skip mode on an internal header, and resume on a blank line when
 *     the next non-blank line is NOT another internal header.
 */
export function stripInternalContent(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");

  // Fast path: if the first non-blank line is an internal header,
  // the entire text is internal planning content.
  const firstNonBlank = findNextNonBlankLine(lines, 0);
  if (
    firstNonBlank !== null &&
    AGENT_ARTIFACT_HEADER_RE.test(lines[firstNonBlank]!.trim())
  ) {
    return "";
  }

  // Slow path: internal blocks appear mid-text (rare but possible).
  const result: string[] = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (AGENT_ARTIFACT_HEADER_RE.test(trimmed)) {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (trimmed === "") {
        const nextNonBlank = findNextNonBlankLine(lines, i + 1);
        if (
          nextNonBlank !== null &&
          AGENT_ARTIFACT_HEADER_RE.test(lines[nextNonBlank]!.trim())
        ) {
          continue;
        }
        skipping = false;
      }
      continue;
    }

    result.push(line);
  }

  let output = result.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Mask sensitive values that might remain in the text
  output = output.replace(
    /\b([A-Z_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z_]*)\s*[:=]\s*['"]?[0-9a-zA-Z_\-+/=]{8,}['"]?/gi,
    "$1=***masked***",
  );
  return output;
}

/** Find the index of the next non-blank line starting from `start`. */
function findNextNonBlankLine(lines: string[], start: number): number | null {
  for (let i = start; i < lines.length; i++) {
    if (lines[i]!.trim() !== "") return i;
  }
  return null;
}

/**
 * Represents a file stored in message additional_kwargs.files.
 * Used for optimistic UI (uploading state) and structured file metadata.
 */
export interface FileInMessage {
  filename: string;
  size: number; // bytes
  path?: string; // virtual path, may not be set during upload
  status?: "uploading" | "uploaded";
}

/**
 * Strip <uploaded_files> tag from message content.
 * Returns the content with the tag removed.
 */
export function stripUploadedFilesTag(content: string): string {
  return content
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, "")
    .trim();
}

export function parseUploadedFiles(content: string): FileInMessage[] {
  // Match <uploaded_files>...</uploaded_files> tag
  const uploadedFilesRegex = /<uploaded_files>([\s\S]*?)<\/uploaded_files>/;
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
  const match = content.match(uploadedFilesRegex);

  if (!match) {
    return [];
  }

  const uploadedFilesContent = match[1];

  // Check if it's "No files have been uploaded yet."
  if (uploadedFilesContent?.includes("No files have been uploaded yet.")) {
    return [];
  }

  // Check if the backend reported no new files were uploaded in this message
  if (uploadedFilesContent?.includes("(empty)")) {
    return [];
  }

  // Parse file list
  // Format: - filename (size)\n  Path: /path/to/file
  const fileRegex = /- ([^\n(]+)\s*\(([^)]+)\)\s*\n\s*Path:\s*([^\n]+)/g;
  const files: FileInMessage[] = [];
  let fileMatch;

  while ((fileMatch = fileRegex.exec(uploadedFilesContent ?? "")) !== null) {
    files.push({
      filename: fileMatch[1].trim(),
      size: parseInt(fileMatch[2].trim(), 10) ?? 0,
      path: fileMatch[3].trim(),
    });
  }

  return files;
}

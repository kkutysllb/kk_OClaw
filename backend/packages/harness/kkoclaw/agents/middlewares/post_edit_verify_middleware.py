"""Post-edit verification reminder middleware for the Coding Agent.

After a file-mutating tool succeeds (apply_diff, multi_edit, str_replace,
write_file, insert_at_line), this middleware injects reminders that keep
the model inside a lightweight TDD + verification loop:

1. For feature / bugfix tasks, prefer writing or running tests before
   editing production code.
2. After any edit, verify the change with run_linter / run_tests before
   reporting the task done.

The reminder is injected once per edit batch: if the model has already
called a verification tool (run_tests, run_linter, bash) after the last
edit, no new reminder is added. This avoids nagging while still enforcing
the edit-verify loop.

Enabled by default. Advanced deployments may override
``coding_agent.post_edit_verify_enabled`` or ``coding_agent.post_edit_verify_mode``:
    post_edit_verify_enabled: false  (optional opt-out; default true)
    post_edit_verify_mode:   "soft"|"hard"  (soft = reminder, hard = reserved strict mode)
"""

from __future__ import annotations

import logging
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.internal_messages import internal_human_message

logger = logging.getLogger(__name__)

# Tools that mutate project files. Seeing a *successful* ToolMessage from
# one of these triggers the "you should verify" reminder.
_MUTATING_TOOL_NAMES = frozenset({
    "apply_diff",
    "multi_edit",
    "str_replace",
    "write_file",
    "insert_at_line",
    "edit_file",
    "edit_diff",
    "apply_patch",
    # Structured refactor tools — these call sandbox.write_file internally,
    # so the post-edit verify reminder must cover them too.
    "rename_symbol",
    "extract_function",
})

# Tools that count as "verification". If the model has called any of these
# *after* the most recent mutation, the reminder is suppressed.
_VERIFICATION_TOOL_NAMES = frozenset({
    "run_tests",
    "run_linter",
    "bash",  # covers make test, npm test, cargo test, etc.
})

_REMINDER_MARKER = "post_edit_verify_reminder"
_TDD_FIRST_REMINDER_MARKER = "tdd_first_reminder"

_TDD_TASK_KEYWORDS = (
    "bug",
    "fix",
    "regression",
    "feature",
    "implement",
    "新增",
    "实现",
    "修复",
    "缺陷",
    "回归",
    "功能",
)
_TDD_SKIP_KEYWORDS = (
    "docs",
    "documentation",
    "readme",
    "comment",
    "copy",
    "style",
    "css",
    "文档",
    "说明",
    "注释",
    "样式",
)
_TEST_PATH_HINTS = (
    "/test/",
    "/tests/",
    "\\test\\",
    "\\tests\\",
    "test_",
    "_test.",
    ".test.",
    ".spec.",
)


class PostEditVerifyMiddleware(AgentMiddleware[AgentState]):
    """Inject an edit-verify reminder after successful file mutations.

    The middleware inspects the tool-message history each time the model
    is about to be called:

    1.  Find the most recent *successful* mutating ToolMessage.
    2.  If any verification ToolMessage appears after it, do nothing.
    3.  Otherwise, inject a reminder telling the model to verify.

    The reminder is suppressed once per pending-edit to avoid loops.
    """

    def __init__(self, *, mode: str = "soft") -> None:
        super().__init__()
        self._mode = mode if mode in ("soft", "hard") else "soft"

    # ------------------------------------------------------------------
    # Core detection logic
    # ------------------------------------------------------------------

    def _needs_reminder(self, messages: list[Any]) -> bool:
        """Return True if a successful edit happened and hasn't been verified."""
        if not messages:
            return False

        # Walk the messages in reverse to locate the most recent mutation
        # and check whether a verification call follows it.
        saw_mutation_after_last_verify = False
        for msg in reversed(messages):
            if isinstance(msg, ToolMessage):
                name = str(msg.name or "")
                if name in _VERIFICATION_TOOL_NAMES:
                    # A verification happened after the last mutation we've
                    # seen so far → no reminder needed.
                    return False
                if name in _MUTATING_TOOL_NAMES and not _is_error(msg):
                    saw_mutation_after_last_verify = True
            elif isinstance(msg, HumanMessage) and _is_verify_reminder(msg):
                # Already reminded for the current pending edit.
                return False

        return saw_mutation_after_last_verify

    def _needs_tdd_first_reminder(self, messages: list[Any]) -> bool:
        """Return True when a feature/bugfix edits production before test activity."""
        task_text = _latest_human_task_text(messages)
        if not _looks_like_tdd_task(task_text):
            return False

        saw_test_activity = False
        for msg in messages:
            if isinstance(msg, HumanMessage) and _is_tdd_first_reminder(msg):
                return False
            if not isinstance(msg, ToolMessage):
                continue
            name = str(msg.name or "")
            if name in _VERIFICATION_TOOL_NAMES or _tool_message_mentions_test_file(msg):
                saw_test_activity = True
                continue
            if name in _MUTATING_TOOL_NAMES and not _is_error(msg):
                if saw_test_activity or _tool_message_mentions_test_file(msg):
                    saw_test_activity = True
                    continue
                return True
        return False

    def _build_reminder(self) -> HumanMessage:
        body = (
            "<system-reminder>\n"
            "<post_edit_verify>\n"
            "你刚刚通过编辑工具修改了项目文件。在报告任务完成之前，请务必执行验证：\n"
            "- 优先调用 `run_linter` 检查语法和风格问题\n"
            "- 接着调用 `run_tests` 运行相关测试（如果项目有测试）\n"
            "- 或使用 `bash` 运行项目原生的检查命令（如 make test / npm test）\n"
            "\n"
            "规则：\n"
            "1. 严禁在没有验证证据的情况下声称“修复完成”或“已修复”。\n"
            "2. 如果验证失败，修复根因后重新验证，直到通过。\n"
            "3. 报告完成时必须引用验证输出的关键行（如 '3 passed' 或 '0 errors'）。\n"
            "</post_edit_verify>\n"
            "</system-reminder>"
        )
        return internal_human_message(
            content=body,
            marker=_REMINDER_MARKER,
            additional_kwargs={
                _REMINDER_MARKER: True,
            },
        )

    def _build_tdd_first_reminder(self) -> HumanMessage:
        body = (
            "<system-reminder>\n"
            "<tdd_first_guard>\n"
            "当前任务看起来是功能实现或缺陷修复。你已经先修改了生产代码，"
            "但还没有看到测试先行动作。\n"
            "\n"
            "请优先补齐轻量 TDD 证据：\n"
            "- 新增或修改能覆盖本次行为的测试；或\n"
            "- 先运行相关测试，看到可解释的失败，再进行实现；或\n"
            "- 如果项目没有测试条件，请明确说明原因，并使用最接近的验证命令。\n"
            "\n"
            "这是 soft guard：不阻塞继续工作，但完成说明中必须交代测试/验证证据。\n"
            "</tdd_first_guard>\n"
            "</system-reminder>"
        )
        return internal_human_message(
            content=body,
            marker=_TDD_FIRST_REMINDER_MARKER,
            additional_kwargs={
                _TDD_FIRST_REMINDER_MARKER: True,
            },
        )

    # ------------------------------------------------------------------
    # Middleware hooks
    # ------------------------------------------------------------------

    @override
    def before_model(self, state: AgentState, runtime: Runtime | None) -> dict[str, Any] | None:
        messages = list(state.get("messages", []) or [])
        if self._needs_tdd_first_reminder(messages):
            reminder = self._build_tdd_first_reminder()
            logger.info("PostEditVerifyMiddleware: injecting TDD-first reminder (mode=%s)", self._mode)
            return {"messages": [reminder]}
        if self._needs_reminder(messages):
            reminder = self._build_reminder()
            logger.info("PostEditVerifyMiddleware: injecting edit-verify reminder (mode=%s)", self._mode)
            return {"messages": [reminder]}
        return None

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime | None) -> dict[str, Any] | None:
        messages = list(state.get("messages", []) or [])
        if self._needs_tdd_first_reminder(messages):
            reminder = self._build_tdd_first_reminder()
            logger.info("PostEditVerifyMiddleware: injecting TDD-first reminder (mode=%s)", self._mode)
            return {"messages": [reminder]}
        if self._needs_reminder(messages):
            reminder = self._build_reminder()
            logger.info("PostEditVerifyMiddleware: injecting edit-verify reminder (mode=%s)", self._mode)
            return {"messages": [reminder]}
        return None


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _is_error(tool_msg: ToolMessage) -> bool:
    """Return True if a ToolMessage represents a failed tool call."""
    status = getattr(tool_msg, "status", None)
    if status == "error":
        return True
    content = tool_msg.content if isinstance(tool_msg.content, str) else str(tool_msg.content)
    return content.lower().startswith("error")


def _is_verify_reminder(msg: HumanMessage) -> bool:
    return bool(msg.additional_kwargs.get(_REMINDER_MARKER))


def _is_tdd_first_reminder(msg: HumanMessage) -> bool:
    return bool(msg.additional_kwargs.get(_TDD_FIRST_REMINDER_MARKER))


def _latest_human_task_text(messages: list[Any]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) and not _is_verify_reminder(msg) and not _is_tdd_first_reminder(msg):
            content = msg.content
            if isinstance(content, str):
                return content
    return ""


def _looks_like_tdd_task(text: str) -> bool:
    lowered = text.lower()
    if not lowered:
        return False
    if any(keyword in lowered for keyword in _TDD_SKIP_KEYWORDS):
        return False
    return any(keyword in lowered for keyword in _TDD_TASK_KEYWORDS)


def _tool_message_mentions_test_file(tool_msg: ToolMessage) -> bool:
    content = tool_msg.content if isinstance(tool_msg.content, str) else str(tool_msg.content)
    lowered = content.lower().replace("\\", "/")
    return any(hint.replace("\\", "/") in lowered for hint in _TEST_PATH_HINTS)

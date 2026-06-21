"""Post-edit verification reminder middleware for the Coding Agent.

After a file-mutating tool succeeds (apply_diff, multi_edit, str_replace,
write_file, insert_at_line), this middleware injects a system reminder
telling the model to verify the change with run_linter / run_tests before
reporting the task done.

The reminder is injected once per edit batch: if the model has already
called a verification tool (run_tests, run_linter, bash) after the last
edit, no new reminder is added. This avoids nagging while still enforcing
the edit-verify loop.

Configurable via ``coding_agent.post_edit_verify_enabled`` and
``coding_agent.post_edit_verify_mode`` in config.yaml:
    post_edit_verify_enabled: true|false  (default true)
    post_edit_verify_mode:   "soft"|"hard"  (soft = reminder, hard = block model exit)
"""

from __future__ import annotations

import logging
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.runtime import Runtime

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
        return HumanMessage(
            content=body,
            additional_kwargs={
                "hide_from_ui": True,
                _REMINDER_MARKER: True,
            },
        )

    # ------------------------------------------------------------------
    # Middleware hooks
    # ------------------------------------------------------------------

    @override
    def before_model(self, state: AgentState, runtime: Runtime | None) -> dict[str, Any] | None:
        messages = list(state.get("messages", []) or [])
        if self._needs_reminder(messages):
            reminder = self._build_reminder()
            logger.info("PostEditVerifyMiddleware: injecting edit-verify reminder (mode=%s)", self._mode)
            return {"messages": [reminder]}
        return None

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime | None) -> dict[str, Any] | None:
        messages = list(state.get("messages", []) or [])
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

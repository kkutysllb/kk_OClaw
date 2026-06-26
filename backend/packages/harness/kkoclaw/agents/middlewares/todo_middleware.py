"""Middleware that extends TodoListMiddleware with context-loss detection and premature-exit prevention.

When the message history is truncated (e.g., by SummarizationMiddleware), the
original `write_todos` tool call and its ToolMessage can be scrolled out of the
active context window. This middleware detects that situation and injects a
reminder message so the model still knows about the outstanding todo list.

Additionally, this middleware prevents the agent from exiting the loop while
there are still incomplete todo items. When the model produces a final response
(no tool calls) but todos are not yet complete, the middleware injects a reminder
and jumps back to the model node to force continued engagement.
"""

from __future__ import annotations

from typing import Any, override

from langchain.agents.middleware import TodoListMiddleware
from langchain.agents.middleware.todo import PlanningState, Todo
from langchain.agents.middleware.types import hook_config
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.internal_messages import internal_human_message


def _todos_in_messages(messages: list[Any]) -> bool:
    """Return True if any AIMessage in *messages* contains a write_todos tool call."""
    for msg in messages:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            for tc in msg.tool_calls:
                if tc.get("name") == "write_todos":
                    return True
    return False


def _reminder_in_messages(messages: list[Any]) -> bool:
    """Return True if a todo_reminder HumanMessage is already present in *messages*."""
    for msg in messages:
        if isinstance(msg, HumanMessage) and getattr(msg, "name", None) == "todo_reminder":
            return True
    return False


def _completion_reminder_count(messages: list[Any]) -> int:
    """Return the number of todo_completion_reminder HumanMessages in *messages*."""
    return sum(1 for msg in messages if isinstance(msg, HumanMessage) and getattr(msg, "name", None) == "todo_completion_reminder")


def _format_todos(todos: list[Todo]) -> str:
    """Format a list of Todo items into a human-readable string."""
    lines: list[str] = []
    for todo in todos:
        status = todo.get("status", "pending")
        content = todo.get("content", "")
        lines.append(f"- [{status}] {content}")
    return "\n".join(lines)


def _todo_progress_snapshot(todos: list[Todo]) -> tuple[tuple[str, str], ...]:
    """Return a compact comparable snapshot of current todo progress."""
    return tuple((str(todo.get("content", "")), str(todo.get("status", "pending"))) for todo in todos)


# Phrases that strongly indicate the agent is explicitly asking the user
# to make a decision or provide input.  Conservative list — common words
# like "是否" (whether) are intentionally excluded because they appear in
# self-talk ("I need to check whether the file exists") and would cause
# false positives.
_STRONG_USER_PROMPT_PHRASES = (
    # Chinese — explicit decision requests
    "请确认", "请你确认", "确认一下", "你来决定", "你来选择",
    "你希望我", "你倾向", "你想要", "是否需要我",
    "要不要我", "是否要我", "等你确认", "你选哪个",
    # English — explicit decision requests
    "please confirm", "would you prefer", "would you like me to",
    "shall i", "which option do you prefer", "which would you like",
    "could you confirm", "can you confirm", "what do you think",
)


def _extract_response_text(message: AIMessage) -> str:
    """Extract plain text from an AIMessage's content.

    Handles both ``str`` content and multi-part ``list`` content (e.g.
    messages that include images or tool-output blocks).
    """
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            elif isinstance(part, str):
                parts.append(part)
        return " ".join(parts)
    return ""


def _is_user_facing_response(message: AIMessage) -> bool:
    """Return True if *message* appears to be addressing the user.

    This detects responses where the agent is asking a question or
    requesting confirmation — situations where the agent should be
    allowed to hand back to the user rather than being forced to continue
    working on the todo list.

    Two signals are checked:

    1. **Strong signal**: the response ends with a question mark (``?`` or
       full-width ``？``).
    2. **Phrase signal**: the last ~3 sentences (300 chars) contain an
       explicit decision-request phrase from :data:`_STRONG_USER_PROMPT_PHRASES`.

    Only the tail of the response is checked to avoid matching the same
    phrases embedded in earlier self-talk.
    """
    text = _extract_response_text(message)
    if not text:
        return False
    stripped = text.rstrip()
    # Strong signal: ends with a question mark
    if stripped.endswith(("?", "？")):
        return True
    # Phrase signal: check only the last ~300 characters
    tail = stripped[-300:].lower()
    return any(phrase in tail for phrase in _STRONG_USER_PROMPT_PHRASES)


class TodoMiddleware(TodoListMiddleware):
    """Extends TodoListMiddleware with `write_todos` context-loss detection.

    When the original `write_todos` tool call has been truncated from the message
    history (e.g., after summarization), the model loses awareness of the current
    todo list. This middleware detects that gap in `before_model` / `abefore_model`
    and injects a reminder message so the model can continue tracking progress.
    """

    @override
    def before_model(
        self,
        state: PlanningState,
        runtime: Runtime,
    ) -> dict[str, Any] | None:
        """Inject a todo-list reminder when write_todos has left the context window."""
        todos: list[Todo] = state.get("todos") or []  # type: ignore[assignment]
        if not todos:
            return None

        messages = state.get("messages") or []
        if _todos_in_messages(messages):
            # write_todos is still visible in context — nothing to do.
            return None

        if _reminder_in_messages(messages):
            # A reminder was already injected and hasn't been truncated yet.
            return None

        # The todo list exists in state but the original write_todos call is gone.
        # Inject a reminder as a HumanMessage so the model stays aware.
        formatted = _format_todos(todos)
        reminder = internal_human_message(
            name="todo_reminder",
            marker="todo_reminder",
            content=(
                "<system_reminder>\n"
                "Your todo list from earlier is no longer visible in the current context window, "
                "but it is still active. Here is the current state:\n\n"
                f"{formatted}\n\n"
                "Continue tracking and updating this todo list as you work. "
                "Call `write_todos` whenever the status of any item changes.\n"
                "</system_reminder>"
            ),
        )
        return {"messages": [reminder]}

    @override
    async def abefore_model(
        self,
        state: PlanningState,
        runtime: Runtime,
    ) -> dict[str, Any] | None:
        """Async version of before_model."""
        return self.before_model(state, runtime)

    # Fallback cap used when AppConfig cannot be read (e.g. during early
    # import or in unit tests that bypass config loading). The real value
    # comes from ``AppConfig.todo_max_completion_reminders``.
    _MAX_COMPLETION_REMINDERS = 2

    @staticmethod
    def _todo_progress_snapshot(todos: list[Todo]) -> tuple[tuple[str, str], ...]:
        return _todo_progress_snapshot(todos)

    def _effective_max_reminders(self) -> int:
        """Return the configured completion-reminder cap.

        Reads ``AppConfig.todo_max_completion_reminders`` so operators can
        tune the safety net from ``config.yaml`` without touching code. Any
        failure reading config falls back to the class default.
        """
        try:
            from kkoclaw.config.app_config import get_app_config

            value = get_app_config().todo_max_completion_reminders
            if isinstance(value, int) and value >= 0:
                return value
        except Exception:  # noqa: BLE001 — never break the agent loop on config read
            pass
        return self._MAX_COMPLETION_REMINDERS

    def _effective_strict_completion(self) -> bool:
        """Return whether the force-continue behavior is enabled.

        Reads ``AppConfig.todo_strict_completion`` so operators can disable
        the safety net entirely (fully interactive mode) from ``config.yaml``.
        Any failure reading config defaults to ``True`` (enabled).
        """
        try:
            from kkoclaw.config.app_config import get_app_config

            return bool(get_app_config().todo_strict_completion)
        except Exception:  # noqa: BLE001 — never break the agent loop on config read
            return True

    @hook_config(can_jump_to=["model"])
    @override
    def after_model(
        self,
        state: PlanningState,
        runtime: Runtime,
    ) -> dict[str, Any] | None:
        """Prevent premature agent exit when todo items are still incomplete.

        In addition to the base class check for parallel ``write_todos`` calls,
        this override intercepts model responses that have no tool calls while
        there are still incomplete todo items. It injects a reminder
        ``HumanMessage`` and jumps back to the model node so the agent
        continues working through the todo list.

        A retry cap of ``_MAX_COMPLETION_REMINDERS`` (default 2) prevents
        infinite loops when the agent cannot make further progress.
        """
        # 1. Preserve base class logic (parallel write_todos detection).
        base_result = super().after_model(state, runtime)
        if base_result is not None:
            return base_result

        # 2. Only intervene when the agent wants to exit (no tool calls).
        messages = state.get("messages") or []
        last_ai = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
        if not last_ai or last_ai.tool_calls:
            return None

        # 3. If strict completion is disabled (fully interactive mode),
        #    never force-continue — let the agent hand back to the user.
        if not self._effective_strict_completion():
            return None

        # 4. User-facing-response gate: if the agent appears to be asking
        #    the user a question or requesting confirmation, let it through.
        #    This prevents the middleware from steamrolling natural-language
        #    questions that happen to have no tool calls (e.g. "Which option
        #    do you prefer?", "请确认是否继续？").
        if _is_user_facing_response(last_ai):
            return None

        # 5. Allow exit when all todos are completed or there are no todos.
        todos: list[Todo] = state.get("todos") or []  # type: ignore[assignment]
        if not todos or all(t.get("status") == "completed" for t in todos):
            return None

        # 6. Enforce a progress-aware reminder cap. If the todo snapshot has
        # changed since the previous reminder, reset the count; otherwise,
        # stop force-continuing after the configured cap.
        snapshot = _todo_progress_snapshot(todos)
        control = state.get("todo_completion_control") or {}
        previous_snapshot = control.get("snapshot") if isinstance(control, dict) else None
        previous_count = control.get("reminder_count", 0) if isinstance(control, dict) else 0
        if previous_snapshot != snapshot:
            reminder_count = 0
        else:
            reminder_count = previous_count if isinstance(previous_count, int) else 0
        reminder_count = max(reminder_count, _completion_reminder_count(messages))
        if reminder_count >= self._effective_max_reminders():
            return None

        # 7. Inject a reminder and force the agent back to the model.
        incomplete = [t for t in todos if t.get("status") != "completed"]
        incomplete_text = "\n".join(f"- [{t.get('status', 'pending')}] {t.get('content', '')}" for t in incomplete)
        reminder = internal_human_message(
            name="todo_completion_reminder",
            marker="todo_completion_reminder",
            content=(
                "<system_reminder>\n"
                "You have incomplete todo items that must be finished before giving your final response:\n\n"
                f"{incomplete_text}\n\n"
                "Please continue working on these tasks. Call `write_todos` to mark items as completed "
                "as you finish them, and only respond when all items are done.\n"
                "</system_reminder>"
            ),
        )
        return {
            "jump_to": "model",
            "messages": [reminder],
            "todo_completion_control": {
                "snapshot": snapshot,
                "reminder_count": reminder_count + 1,
            },
        }

    @override
    @hook_config(can_jump_to=["model"])
    async def aafter_model(
        self,
        state: PlanningState,
        runtime: Runtime,
    ) -> dict[str, Any] | None:
        """Async version of after_model."""
        return self.after_model(state, runtime)

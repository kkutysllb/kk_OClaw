"""Middleware to inject dynamic context (memory, current date) as a system-reminder.

The system prompt is kept fully static for maximum prefix-cache reuse across users
and sessions.  The current date is always injected.  Per-user memory is also injected
when ``memory.injection_enabled`` is True in the app config.  Both are delivered once
per conversation as a dedicated <system-reminder> HumanMessage inserted before the
first user message (frozen-snapshot pattern).

When a conversation spans midnight the middleware detects the date change and injects
a lightweight date-update reminder as a separate HumanMessage before the current turn.
This correction is persisted so subsequent turns on the new day see a consistent history
and do not re-inject.

Reminder format:

    <system-reminder>
    <memory>...</memory>

    <current_date>2026-05-08, Friday</current_date>
    </system-reminder>

Date-update format:

    <system-reminder>
    <current_date>2026-05-09, Saturday</current_date>
    </system-reminder>
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, override

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.internal_messages import internal_human_message
from kkoclaw.agents.memory.scope import resolve_active_scope
from kkoclaw.runtime.user_context import resolve_runtime_user_id

if TYPE_CHECKING:
    from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"<current_date>([^<]+)</current_date>")
_DYNAMIC_CONTEXT_REMINDER_KEY = "dynamic_context_reminder"
_SUMMARY_MESSAGE_NAME = "summary"


def _extract_date(content: str) -> str | None:
    """Return the first <current_date> value found in *content*, or None."""
    m = _DATE_RE.search(content)
    return m.group(1) if m else None


def is_dynamic_context_reminder(message: object) -> bool:
    """Return whether *message* is a hidden dynamic-context reminder."""
    return isinstance(message, HumanMessage) and bool(message.additional_kwargs.get(_DYNAMIC_CONTEXT_REMINDER_KEY))


def _last_injected_date(messages: list) -> str | None:
    """Scan messages in reverse and return the most recently injected date."""
    for msg in reversed(messages):
        if is_dynamic_context_reminder(msg):
            content_str = msg.content if isinstance(msg.content, str) else str(msg.content)
            return _extract_date(content_str)
    return None


def _is_user_injection_target(message: object) -> bool:
    """Return whether *message* can receive a dynamic-context reminder."""
    return isinstance(message, HumanMessage) and not is_dynamic_context_reminder(message) and message.name != _SUMMARY_MESSAGE_NAME


class DynamicContextMiddleware(AgentMiddleware):
    """Inject memory and current date into HumanMessages as a <system-reminder>.

    First turn: Prepends a full system-reminder (memory + date) to the first
    HumanMessage and persists it. The first message is frozen for the whole session.

    Midnight crossing: If the conversation spans midnight, a lightweight date-update
    reminder is prepended to the current (last) HumanMessage and persisted.
    """

    def __init__(self, agent_name: str | None = None, *, app_config: AppConfig | None = None):
        super().__init__()
        self._agent_name = agent_name
        self._app_config = app_config

    def _build_full_reminder(self, runtime: Runtime | None = None) -> str:
        from kkoclaw.agents.lead_agent.prompt import _get_memory_context

        # Memory injection is gated by injection_enabled; date is always included.
        injection_enabled = self._app_config.memory.injection_enabled if self._app_config else True
        runtime_context = runtime.context if runtime is not None and runtime.context else None
        active_scope = resolve_active_scope(runtime_context)
        memory_context = (
            _get_memory_context(
                self._agent_name,
                app_config=self._app_config,
                active_scope=active_scope,
                user_id=resolve_runtime_user_id(runtime),
            )
            if injection_enabled
            else ""
        )
        current_date = datetime.now().strftime("%Y-%m-%d, %A")

        lines: list[str] = ["<system-reminder>"]
        if memory_context:
            lines.append(memory_context.strip())
            lines.append("")  # blank line separating memory from date
        lines.append(f"<current_date>{current_date}</current_date>")
        lines.append("</system-reminder>")

        return "\n".join(lines)

    def _build_date_update_reminder(self) -> str:
        current_date = datetime.now().strftime("%Y-%m-%d, %A")
        return "\n".join(
            [
                "<system-reminder>",
                f"<current_date>{current_date}</current_date>",
                "</system-reminder>",
            ]
        )

    @staticmethod
    def _make_reminder_and_user_messages(original: HumanMessage, reminder_content: str) -> tuple[HumanMessage, HumanMessage]:
        """Return (reminder_msg, user_msg) using the ID-swap technique."""
        stable_id = original.id or str(uuid.uuid4())
        reminder_msg = internal_human_message(
            content=reminder_content,
            id=stable_id,
            marker="dynamic_context_reminder",
            additional_kwargs={_DYNAMIC_CONTEXT_REMINDER_KEY: True},
        )
        user_msg = HumanMessage(
            content=original.content,
            id=f"{stable_id}__user",
            name=original.name,
            additional_kwargs=original.additional_kwargs,
        )
        return reminder_msg, user_msg

    def _inject(self, state, runtime: Runtime | None = None) -> dict | None:
        messages = list(state.get("messages", []))
        if not messages:
            return None

        current_date = datetime.now().strftime("%Y-%m-%d, %A")
        last_date = _last_injected_date(messages)
        logger.debug(
            "DynamicContextMiddleware._inject: msg_count=%d last_date=%r current_date=%r",
            len(messages),
            last_date,
            current_date,
        )

        if last_date is None:
            # First turn: inject full reminder
            first_idx = next((i for i, m in enumerate(messages) if _is_user_injection_target(m)), None)
            if first_idx is None:
                return None
            full_reminder = self._build_full_reminder(runtime)
            logger.info(
                "DynamicContextMiddleware: injecting full reminder (len=%d, has_memory=%s) into first HumanMessage id=%r",
                len(full_reminder),
                "<memory>" in full_reminder,
                messages[first_idx].id,
            )
            reminder_msg, user_msg = self._make_reminder_and_user_messages(messages[first_idx], full_reminder)
            return {"messages": [reminder_msg, user_msg]}

        if last_date == current_date:
            # Same day: nothing to do
            return None

        # Midnight crossed: inject date-update reminder
        last_human_idx = next((i for i in reversed(range(len(messages))) if _is_user_injection_target(messages[i])), None)
        if last_human_idx is None:
            return None

        reminder_msg, user_msg = self._make_reminder_and_user_messages(messages[last_human_idx], self._build_date_update_reminder())
        logger.info("DynamicContextMiddleware: midnight crossing detected — injected date update before current turn")
        return {"messages": [reminder_msg, user_msg]}

    @override
    def before_agent(self, state, runtime: Runtime) -> dict | None:
        return self._inject(state, runtime)

    @override
    async def abefore_agent(self, state, runtime: Runtime) -> dict | None:
        return self._inject(state, runtime)

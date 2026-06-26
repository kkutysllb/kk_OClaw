"""Coding Agent middleware for activating Coding-only skills per turn."""

from __future__ import annotations

import logging
from typing import override

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.internal_messages import internal_human_message
from kkoclaw.agents.coding_agent.runtime import (
    CodingAgentRuntime,
    _CODING_ACTIVE_SKILLS_STATE_KEY,
    _latest_user_text,
    active_skills_to_state,
)
from kkoclaw.coding_core.engine import CodingEngine

logger = logging.getLogger(__name__)

_CODING_SKILLS_REMINDER_KEY = "coding_skills_reminder"


class CodingSkillsMiddleware(AgentMiddleware):
    """Inject active Coding skill instructions based on the latest user task."""

    def __init__(self, coding_engine: CodingEngine):
        super().__init__()
        self._engine = coding_engine
        self._runtime = CodingAgentRuntime(coding_engine)

    def _inject(self, state) -> dict | None:
        messages = list(state.get("messages", []))
        if _has_current_skill_reminder(messages):
            return None
        active_skills = self._runtime.active_skills_for_state(state)
        self._persist_session_boundary(state, active_skills)
        if not active_skills:
            return None

        content = _format_active_skill_reminder(active_skills)
        logger.info("CodingSkillsMiddleware: injecting %d active Coding skill(s)", len(active_skills))
        return {
            "messages": [
                internal_human_message(
                    content=content,
                    marker="coding_skills_reminder",
                    additional_kwargs={_CODING_SKILLS_REMINDER_KEY: True},
                )
            ],
            _CODING_ACTIVE_SKILLS_STATE_KEY: active_skills_to_state(active_skills),
        }

    def _persist_session_boundary(self, state, active_skills) -> None:
        try:
            self._engine.persist_task_session(
                task_text=_latest_user_text(list(state.get("messages", [])) if isinstance(state, dict) else []),
                active_skills=active_skills,
            )
        except ValueError:
            logger.debug("CodingSkillsMiddleware: skip session persistence without safe thread_id")
        except Exception:
            logger.exception("CodingSkillsMiddleware: failed to persist Qiongqi session boundary")

    @override
    def before_model(self, state, runtime: Runtime) -> dict | None:
        return self._inject(state)

    @override
    async def abefore_model(self, state, runtime: Runtime) -> dict | None:
        return self._inject(state)


def _has_current_skill_reminder(messages: list) -> bool:
    for message in reversed(messages):
        if isinstance(message, HumanMessage) and message.additional_kwargs.get(_CODING_SKILLS_REMINDER_KEY):
            return True
        if isinstance(message, HumanMessage):
            return False
    return False


def _format_active_skill_reminder(active_skills) -> str:
    sections = [
        "<system-reminder>",
        "<coding_skills>",
        "The following Coding-specific skills are active for the current task. Follow their instructions.",
    ]
    for active in active_skills:
        sections.append(
            f"\n## {active.skill.name} ({active.skill.id})\n"
            f"Source: {active.skill.skill_file}\n\n"
            f"{active.instructions}"
        )
    sections.extend(["</coding_skills>", "</system-reminder>"])
    return "\n".join(sections)

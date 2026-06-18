"""Shared per-agent runtime helpers for Coding Agent middlewares."""

from __future__ import annotations

from langchain_core.messages import HumanMessage

from kkoclaw.coding_core.skills import ActiveCodingSkill

_CODING_ACTIVE_SKILLS_STATE_KEY = "active_coding_skills"


class CodingAgentRuntime:
    """Per-graph runtime facade around the Coding Core engine."""

    def __init__(self, coding_engine):
        self._coding_engine = coding_engine

    @property
    def skills(self):
        return self._coding_engine.skills

    def active_skills_for_state(self, state: object) -> list[ActiveCodingSkill]:
        task_text = _latest_user_text(list(state.get("messages", [])) if isinstance(state, dict) else [])
        if not task_text:
            return []
        return self._coding_engine.activate_skills(task_text)

    def active_skill_policy_for_state(self, state: object) -> list[dict]:
        if isinstance(state, dict):
            cached = state.get(_CODING_ACTIVE_SKILLS_STATE_KEY)
            if isinstance(cached, list):
                return cached
        return active_skills_to_state(self.active_skills_for_state(state))


def active_skills_to_state(active_skills: list[ActiveCodingSkill]) -> list[dict]:
    from kkoclaw.coding_core.qiongqi import active_skills_to_state as _active_skills_to_state

    return _active_skills_to_state(active_skills)


def _latest_user_text(messages: list) -> str | None:
    for message in reversed(messages):
        if isinstance(message, HumanMessage) and not message.additional_kwargs.get("coding_skills_reminder"):
            content = message.content
            if isinstance(content, str):
                return content
            return str(content)
    return None

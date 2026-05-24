"""Subagent configuration definitions."""

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)


@dataclass
class SubagentConfig:
    """Configuration for a subagent.

    Attributes:
        name: Unique identifier for the subagent.
        description: When Claude should delegate to this subagent.
        system_prompt: The system prompt that guides the subagent's behavior.
        tools: Optional list of tool names to allow. If None, inherits all tools.
        disallowed_tools: Optional list of tool names to deny.
        skills: Optional list of skill names to load. If None, inherits all enabled skills.
                If an empty list, no skills are loaded.
        model: Model to use - 'inherit' uses parent's model.
        max_turns: Maximum number of agent turns before stopping.
        timeout_seconds: Maximum execution time in seconds (default: 900 = 15 minutes).
    """

    name: str
    description: str
    system_prompt: str
    tools: list[str] | None = None
    disallowed_tools: list[str] | None = field(default_factory=lambda: ["task"])
    skills: list[str] | None = None
    model: str = "inherit"
    max_turns: int = 25
    timeout_seconds: int = 900


def _default_model_name(app_config: "AppConfig") -> str:
    if not app_config.models:
        raise ValueError("No chat models are configured. Please configure at least one model in config.yaml.")
    return app_config.models[0].name


def _configured_model_names(app_config: "AppConfig") -> set[str]:
    return {model.name for model in app_config.models}


def _rule_matches(*, rule: object, parent_model: str | None, subagent_type: str | None) -> bool:
    if parent_model is None or parent_model not in rule.parent_models:
        return False
    if rule.include_subagent_types and subagent_type not in rule.include_subagent_types:
        return False
    if rule.exclude_subagent_types and subagent_type in rule.exclude_subagent_types:
        return False
    return True


def resolve_subagent_model_name(
    config: SubagentConfig,
    parent_model: str | None,
    *,
    subagent_type: str | None = None,
    app_config: "AppConfig | None" = None,
) -> str:
    """Resolve the effective model name a subagent should use."""
    if config.model != "inherit":
        return config.model

    if app_config is None:
        if parent_model is not None:
            return parent_model
        from kkoclaw.config import get_app_config

        app_config = get_app_config()

    routing = getattr(getattr(app_config, "subagents", None), "model_routing", None)
    if routing is not None and routing.enabled:
        configured_names = _configured_model_names(app_config)
        for rule in routing.rules:
            if not _rule_matches(rule=rule, parent_model=parent_model, subagent_type=subagent_type):
                continue

            fallback_used = False
            for candidate in rule.preferred_models:
                if candidate in configured_names:
                    logger.debug(
                        "subagent.model_routing matched parent=%s type=%s selected=%s fallback=%s",
                        parent_model,
                        subagent_type,
                        candidate,
                        fallback_used,
                    )
                    return candidate

            if rule.fallback == "inherit" and parent_model is not None:
                fallback_used = True
                logger.debug(
                    "subagent.model_routing matched parent=%s type=%s selected=%s fallback=%s",
                    parent_model,
                    subagent_type,
                    parent_model,
                    fallback_used,
                )
                return parent_model

            selected_model = _default_model_name(app_config)
            fallback_used = True
            logger.debug(
                "subagent.model_routing matched parent=%s type=%s selected=%s fallback=%s",
                parent_model,
                subagent_type,
                selected_model,
                fallback_used,
            )
            return selected_model

    if parent_model is not None:
        return parent_model

    return _default_model_name(app_config)

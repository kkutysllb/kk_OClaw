"""Configuration for the subagent system loaded from config.yaml."""

import logging
from typing import Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SubagentOverrideConfig(BaseModel):
    """Per-agent configuration overrides."""

    timeout_seconds: int | None = Field(
        default=None,
        ge=1,
        description="Timeout in seconds for this subagent (None = use global default)",
    )
    max_turns: int | None = Field(
        default=None,
        ge=1,
        description="Maximum turns for this subagent (None = use global or builtin default)",
    )
    model: str | None = Field(
        default=None,
        min_length=1,
        description="Model name for this subagent (None = inherit from parent agent)",
    )
    skills: list[str] | None = Field(
        default=None,
        description="Skill names whitelist for this subagent (None = inherit all enabled skills, [] = no skills)",
    )


class CustomSubagentConfig(BaseModel):
    """User-defined subagent type declared in config.yaml."""

    description: str = Field(
        description="When the lead agent should delegate to this subagent",
    )
    system_prompt: str = Field(
        description="System prompt that guides the subagent's behavior",
    )
    tools: list[str] | None = Field(
        default=None,
        description="Tool names whitelist (None = inherit all tools from parent)",
    )
    disallowed_tools: list[str] | None = Field(
        default_factory=lambda: ["task", "ask_clarification", "present_files"],
        description="Tool names to deny",
    )
    skills: list[str] | None = Field(
        default=None,
        description="Skill names whitelist (None = inherit all enabled skills, [] = no skills)",
    )
    model: str = Field(
        default="inherit",
        description="Model to use - 'inherit' uses parent's model",
    )
    max_turns: int = Field(
        default=25,
        ge=1,
        description="Maximum number of agent turns before stopping",
    )
    timeout_seconds: int = Field(
        default=900,
        ge=1,
        description="Maximum execution time in seconds",
    )


class SubagentModelRoutingRuleConfig(BaseModel):
    """A single parent-model to subagent-model routing rule."""

    parent_models: list[str] = Field(
        default_factory=list,
        description="Parent model names that trigger this rule",
    )
    include_subagent_types: list[str] | None = Field(
        default=None,
        description="Optional allowlist of subagent types",
    )
    exclude_subagent_types: list[str] | None = Field(
        default=None,
        description="Optional denylist of subagent types",
    )
    preferred_models: list[str] = Field(
        default_factory=list,
        description="Preferred target models in priority order",
    )
    fallback: Literal["default", "inherit"] = Field(
        default="default",
        description="Fallback behavior when no preferred model exists",
    )


class SubagentModelRoutingConfig(BaseModel):
    """Configuration for subagent model routing."""

    enabled: bool = Field(
        default=False,
        description="Whether subagent model routing is enabled",
    )
    rules: list[SubagentModelRoutingRuleConfig] = Field(
        default_factory=list,
        description="Ordered routing rules; first match wins",
    )


class SubagentsAppConfig(BaseModel):
    """Configuration for the subagent system."""

    timeout_seconds: int = Field(
        default=900,
        ge=1,
        description="Default timeout in seconds for all subagents (default: 900 = 15 minutes)",
    )
    max_turns: int | None = Field(
        default=None,
        ge=1,
        description="Optional default max-turn override for all subagents (None = keep builtin defaults)",
    )
    recursion_limit_multiplier: int = Field(
        default=3,
        ge=1,
        description="Multiplier for recursion_limit formula: max_turns * multiplier + base (default: 3)",
    )
    recursion_limit_base: int = Field(
        default=20,
        ge=0,
        description="Base offset for recursion_limit formula: max_turns * multiplier + base (default: 20)",
    )
    agents: dict[str, SubagentOverrideConfig] = Field(
        default_factory=dict,
        description="Per-agent configuration overrides keyed by agent name",
    )
    custom_agents: dict[str, CustomSubagentConfig] = Field(
        default_factory=dict,
        description="User-defined subagent types keyed by agent name",
    )
    model_routing: SubagentModelRoutingConfig = Field(
        default_factory=SubagentModelRoutingConfig,
        description="Optional parent-model to subagent-model routing rules",
    )

    def get_timeout_for(self, agent_name: str) -> int:
        """Get the effective timeout for a specific agent.

        Args:
            agent_name: The name of the subagent.

        Returns:
            The timeout in seconds, using per-agent override if set, otherwise global default.
        """
        override = self.agents.get(agent_name)
        if override is not None and override.timeout_seconds is not None:
            return override.timeout_seconds
        return self.timeout_seconds

    def get_model_for(self, agent_name: str) -> str | None:
        """Get the model override for a specific agent.

        Args:
            agent_name: The name of the subagent.

        Returns:
            Model name if overridden, None otherwise (subagent will inherit parent model).
        """
        override = self.agents.get(agent_name)
        if override is not None and override.model is not None:
            return override.model
        return None

    def get_max_turns_for(self, agent_name: str, builtin_default: int) -> int:
        """Get the effective max_turns for a specific agent."""
        override = self.agents.get(agent_name)
        if override is not None and override.max_turns is not None:
            return override.max_turns
        if self.max_turns is not None:
            return self.max_turns
        return builtin_default

    def get_skills_for(self, agent_name: str) -> list[str] | None:
        """Get the skills override for a specific agent.

        Args:
            agent_name: The name of the subagent.

        Returns:
            Skill names whitelist if overridden, None otherwise (subagent will inherit all enabled skills).
        """
        override = self.agents.get(agent_name)
        if override is not None and override.skills is not None:
            return override.skills
        return None

    def compute_recursion_limit(self, max_turns: int) -> int:
        """Compute the LangGraph recursion_limit for a given max_turns.

        Formula: max_turns * recursion_limit_multiplier + recursion_limit_base
        Default: max_turns * 3 + 20

        Args:
            max_turns: The effective max_turns for the subagent.

        Returns:
            The computed recursion_limit value.
        """
        return max_turns * self.recursion_limit_multiplier + self.recursion_limit_base


_subagents_config: SubagentsAppConfig = SubagentsAppConfig()


def get_subagents_app_config() -> SubagentsAppConfig:
    """Get the current subagents configuration."""
    return _subagents_config


def load_subagents_config_from_dict(config_dict: dict) -> None:
    """Load subagents configuration from a dictionary."""
    global _subagents_config
    _subagents_config = SubagentsAppConfig(**config_dict)

    overrides_summary = {}
    for name, override in _subagents_config.agents.items():
        parts = []
        if override.timeout_seconds is not None:
            parts.append(f"timeout={override.timeout_seconds}s")
        if override.max_turns is not None:
            parts.append(f"max_turns={override.max_turns}")
        if override.model is not None:
            parts.append(f"model={override.model}")
        if override.skills is not None:
            parts.append(f"skills={override.skills}")
        if parts:
            overrides_summary[name] = ", ".join(parts)

    custom_agents_names = list(_subagents_config.custom_agents.keys())
    routing_summary = (
        f"enabled={_subagents_config.model_routing.enabled}, "
        f"rules={len(_subagents_config.model_routing.rules)}"
    )

    recursion_summary = f"recursion_limit={_subagents_config.recursion_limit_multiplier}*max_turns+{_subagents_config.recursion_limit_base}"

    if overrides_summary or custom_agents_names:
        logger.info(
            "Subagents config loaded: default timeout=%ss, default max_turns=%s, %s, per-agent overrides=%s, custom_agents=%s, model_routing=%s",
            _subagents_config.timeout_seconds,
            _subagents_config.max_turns,
            recursion_summary,
            overrides_summary or "none",
            custom_agents_names or "none",
            routing_summary,
        )
    else:
        logger.info(
            "Subagents config loaded: default timeout=%ss, default max_turns=%s, %s, no per-agent overrides, model_routing=%s",
            _subagents_config.timeout_seconds,
            _subagents_config.max_turns,
            recursion_summary,
            routing_summary,
        )

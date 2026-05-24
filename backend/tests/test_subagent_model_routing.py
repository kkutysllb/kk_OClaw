"""Tests for subagent model routing configuration."""

from kkoclaw.config.subagents_config import SubagentsAppConfig


def test_subagents_config_parses_model_routing_rules() -> None:
    config = SubagentsAppConfig(
        model_routing={
            "enabled": True,
            "rules": [
                {
                    "parent_models": ["deepseek-v4-flash", "deepseek-v4-pro"],
                    "include_subagent_types": ["general-purpose"],
                    "exclude_subagent_types": ["bash"],
                    "preferred_models": ["glm-5.1", "minimax-m2.5"],
                    "fallback": "default",
                }
            ],
        }
    )

    assert config.model_routing.enabled is True
    assert len(config.model_routing.rules) == 1
    rule = config.model_routing.rules[0]
    assert rule.parent_models == ["deepseek-v4-flash", "deepseek-v4-pro"]
    assert rule.include_subagent_types == ["general-purpose"]
    assert rule.exclude_subagent_types == ["bash"]
    assert rule.preferred_models == ["glm-5.1", "minimax-m2.5"]
    assert rule.fallback == "default"


def test_subagents_config_defaults_model_routing_to_disabled() -> None:
    config = SubagentsAppConfig()

    assert config.model_routing.enabled is False
    assert config.model_routing.rules == []

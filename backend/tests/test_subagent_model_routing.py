"""Tests for subagent model routing configuration and resolution."""

from types import SimpleNamespace

from kkoclaw.config.subagents_config import SubagentsAppConfig
from kkoclaw.subagents.config import SubagentConfig, resolve_subagent_model_name


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


def test_resolve_subagent_model_name_preserves_explicit_model() -> None:
    config = SubagentConfig(
        name="general-purpose",
        description="gp",
        system_prompt="test",
        model="custom-executor",
    )
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="default-model")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "custom-executor"


def test_resolve_subagent_model_name_uses_first_available_preferred_model() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[
            SimpleNamespace(name="default-model"),
            SimpleNamespace(name="glm-5.1"),
            SimpleNamespace(name="minimax-m2.5"),
        ],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "minimax-m2.5"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "glm-5.1"


def test_resolve_subagent_model_name_falls_back_to_default_model_when_candidates_missing() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="deepseek-v4-flash")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "minimax-m2.5"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "deepseek-v4-flash"


def test_resolve_subagent_model_name_skips_rule_for_excluded_subagent_type() -> None:
    config = SubagentConfig(name="bash", description="bash", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="default-model"), SimpleNamespace(name="glm-5.1")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose", "bash"],
                        "exclude_subagent_types": ["bash"],
                        "preferred_models": ["glm-5.1"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="bash",
        app_config=app_config,
    )
    assert resolved == "deepseek-v4-flash"


def test_resolve_subagent_model_name_with_single_configured_model_still_runs() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="only-model")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["only-model"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "custom-minimax"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "only-model",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "only-model"

"""Validation helpers for model configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any


OPENAI_COMPATIBLE_ENV_VARS = ("OPENAI_API_KEY",)
MODEL_CREDENTIAL_ENV_VARS: dict[str, tuple[str, ...]] = {
    "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek": ("DEEPSEEK_API_KEY", "OPENAI_API_KEY"),
    "langchain_deepseek:ChatDeepSeek": ("DEEPSEEK_API_KEY", "OPENAI_API_KEY"),
    "kkoclaw.models.patched_zhipu:PatchedChatZhipu": ("ZHIPU_API_KEY", "OPENAI_API_KEY"),
    "kkoclaw.models.patched_openai:PatchedChatOpenAI": OPENAI_COMPATIBLE_ENV_VARS,
    "langchain_openai:ChatOpenAI": OPENAI_COMPATIBLE_ENV_VARS,
    "kkoclaw.models.mindie_provider:MindIEChatModel": OPENAI_COMPATIBLE_ENV_VARS,
    "langchain_anthropic:ChatAnthropic": ("ANTHROPIC_API_KEY",),
    "kkoclaw.models.claude_provider:ClaudeChatModel": ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"),
    "langchain_google_genai:ChatGoogleGenerativeAI": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
}
MODEL_CREDENTIAL_FIELDS: dict[str, tuple[str, ...]] = {
    "langchain_anthropic:ChatAnthropic": ("api_key", "anthropic_api_key"),
    "kkoclaw.models.claude_provider:ClaudeChatModel": ("api_key", "anthropic_api_key"),
    "langchain_google_genai:ChatGoogleGenerativeAI": ("gemini_api_key", "google_api_key", "api_key"),
}
NO_API_KEY_REQUIRED_USE_PATHS = {
    "kkoclaw.models.openai_codex_provider:CodexChatModel",
    "langchain_ollama:ChatOllama",
}


def _is_present(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value.strip() != "***"


def _env_reference_is_configured(value: str) -> bool:
    raw = value.strip()
    if not raw.startswith("$"):
        return True
    env_name = raw[1:]
    if env_name.startswith("{") and env_name.endswith("}"):
        env_name = env_name[1:-1]
    return bool(os.getenv(env_name))


def _configured_value(value: Any) -> bool:
    return _is_present(value) and _env_reference_is_configured(str(value))


def required_credential_env_vars(use_path: str) -> tuple[str, ...]:
    if use_path in NO_API_KEY_REQUIRED_USE_PATHS:
        return ()
    if use_path in MODEL_CREDENTIAL_ENV_VARS:
        return MODEL_CREDENTIAL_ENV_VARS[use_path]
    return ()


def credential_field_names(use_path: str) -> tuple[str, ...]:
    return MODEL_CREDENTIAL_FIELDS.get(use_path, ("api_key",))


def should_validate_resolved_model_class(use_path: str, model_class: type) -> bool:
    """Return whether runtime credential validation should run for a class.

    Factory unit tests often monkeypatch provider resolution to a local fake
    model while keeping a real provider use path. In production, the resolved
    class module should share the configured module root, so this check keeps
    tests focused on factory behavior while still validating real providers.
    """
    if not required_credential_env_vars(use_path):
        return False

    configured_module = use_path.split(":", 1)[0]
    configured_root = configured_module.split(".", 1)[0]
    resolved_root = getattr(model_class, "__module__", "").split(".", 1)[0]
    return configured_root == resolved_root


def model_has_usable_credentials(model_data: Mapping[str, Any]) -> bool:
    use_path = str(model_data.get("use") or "")
    env_vars = required_credential_env_vars(use_path)
    if not env_vars:
        return True

    for field in credential_field_names(use_path):
        if _configured_value(model_data.get(field)):
            return True

    return any(bool(os.getenv(env_name)) for env_name in env_vars)


def validate_model_credentials(model_data: Mapping[str, Any]) -> None:
    """Validate model credentials before saving or instantiating providers.

    Raises:
        ValueError: if the provider is known to require credentials and neither
            the model config nor process environment provides one.
    """
    use_path = str(model_data.get("use") or "")
    env_vars = required_credential_env_vars(use_path)
    if not env_vars or model_has_usable_credentials(model_data):
        return

    fields = ", ".join(credential_field_names(use_path))
    env_text = ", ".join(env_vars)
    model_name = model_data.get("name") or model_data.get("model") or "<unnamed>"
    raise ValueError(
        f"Model '{model_name}' uses {use_path} but has no usable credential. "
        f"Set {fields} in config.yaml, use a configured ${env_vars[0]} reference, "
        f"or set one of these environment variables before starting the backend: {env_text}."
    )

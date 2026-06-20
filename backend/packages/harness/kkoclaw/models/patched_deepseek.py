"""Patched ChatDeepSeek that preserves reasoning_content in multi-turn conversations.

This module provides a patched version of ChatDeepSeek that properly handles
reasoning_content when sending messages back to the API. The original implementation
stores reasoning_content in additional_kwargs but doesn't include it when making
subsequent API calls, which causes errors with APIs that require reasoning_content
on all assistant messages when thinking mode is enabled.
"""

from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_deepseek import ChatDeepSeek
from pydantic import model_validator

from kkoclaw.models.assistant_payload_replay import (
    ensure_reasoning_content,
    restore_assistant_payloads,
    restore_reasoning_content,
)


def _is_thinking_enabled(payload: dict[str, Any], kwargs: dict[str, Any]) -> bool:
    """Detect whether thinking mode is active for this request.

    Thinking mode is configured via ``extra_body.thinking.type`` in the
    model settings.  The value can appear either in the top-level payload
    (non-streaming path) or in the kwargs passed to ``_get_request_payload``.
    """
    # Check kwargs first (runtime override path)
    extra_body = kwargs.get("extra_body")
    if isinstance(extra_body, dict):
        thinking = extra_body.get("thinking")
        if isinstance(thinking, dict) and thinking.get("type") in ("enabled", "adaptive"):
            return True

    # Fall back to the payload itself
    payload_extra_body = payload.get("extra_body")
    if isinstance(payload_extra_body, dict):
        thinking = payload_extra_body.get("thinking")
        if isinstance(thinking, dict) and thinking.get("type") in ("enabled", "adaptive"):
            return True

    return False


class PatchedChatDeepSeek(ChatDeepSeek):
    """ChatDeepSeek with proper reasoning_content preservation.

    When using thinking/reasoning enabled models, the API expects reasoning_content
    to be present on ALL assistant messages in multi-turn conversations. This patched
    version ensures reasoning_content from additional_kwargs is included in the
    request payload.

    Model name aliases are resolved so that locally deployed model names (e.g.
    ``deepseek_v4``) are automatically mapped to the name accepted by the API.
    """

    # Mapping from local/custom model names to API-accepted names.
    _MODEL_NAME_ALIASES: dict[str, str] = {
        "deepseek_v4": "deepseek-v4-flash",
    }

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True

    @property
    def lc_secrets(self) -> dict[str, str]:
        return {"api_key": "DEEPSEEK_API_KEY", "openai_api_key": "DEEPSEEK_API_KEY"}

    @model_validator(mode="before")
    @classmethod
    def _remap_base_url(cls, data: Any) -> Any:
        """Map ``base_url`` / ``openai_api_base`` to ChatDeepSeek's ``api_base``.

        The factory passes ``base_url`` (standardised across all model providers),
        but ``ChatDeepSeek`` expects ``api_base``.  Without this remap the custom
        URL is silently ignored and requests always go to the official endpoint.
        """
        if isinstance(data, dict):
            if "base_url" in data and "api_base" not in data:
                data["api_base"] = data.pop("base_url")
            elif "openai_api_base" in data and "api_base" not in data:
                data["api_base"] = data.pop("openai_api_base")
        return data

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """Get request payload with reasoning_content preserved and image_url stripped.

        Overrides the parent method to:
        1. Inject reasoning_content from additional_kwargs into assistant messages.
        2. Strip image_url content from user messages — DeepSeek's standard
           /v1/chat/completions endpoint does not support the image_url content
           type and rejects requests with error 400 (unknown variant 'image_url').
        """
        # Get the original messages before conversion
        original_messages = self._convert_input(input_).to_messages()

        # Call parent to get the base payload
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        # Resolve model name aliases (e.g. deepseek_v4 → deepseek-v4-flash)
        model_name = payload.get("model")
        if model_name and model_name in self._MODEL_NAME_ALIASES:
            payload["model"] = self._MODEL_NAME_ALIASES[model_name]

        # Strip image_url parts from multi-modal user messages.
        # DeepSeek's API cannot deserialize image_url content in user messages.
        payload_messages = payload.get("messages", [])
        for msg in payload_messages:
            if isinstance(msg, dict) and msg.get("role") in ("user", "human"):
                content = msg.get("content")
                if isinstance(content, list):
                    stripped = [
                        block for block in content
                        if not (isinstance(block, dict) and block.get("type") == "image_url")
                    ]
                    if stripped:
                        msg["content"] = stripped
                    else:
                        # All content was image_url — replace with a placeholder
                        msg["content"] = [{"type": "text", "text": "[Image content omitted — DeepSeek API does not support direct image input]"}]

        # Restore reasoning_content on assistant messages using the generic
        # assistant-payload-replay framework.
        restore_assistant_payloads(
            payload.get("messages", []),
            original_messages,
            restore_reasoning_content,
        )

        # When thinking mode is enabled, the DeepSeek API requires EVERY
        # assistant message to carry a ``reasoning_content`` field — even if
        # the original response for that turn did not include one (e.g. pure
        # tool-call turns, post-summarisation turns, or checkpoint replay).
        # Without this guard the API returns HTTP 400:
        #   "The reasoning_content in the thinking mode must be passed back
        #    to the API."
        if _is_thinking_enabled(payload, kwargs):
            ensure_reasoning_content(payload.get("messages", []))

        return payload

"""Patched ChatOpenAI for Zhipu GLM API compatibility.

The Zhipu GLM API (https://open.bigmodel.cn) is OpenAI-compatible but does NOT
support the ``stream_options`` parameter that LangChain injects when
``stream_usage=True``.  Sending ``stream_options`` causes a ``400 Bad Request``
with error code ``1210`` ("API 调用参数有误").

This module overrides ``_get_request_payload`` to strip ``stream_options``
from the outgoing payload, allowing ``stream_usage=True`` for token usage
tracking in the response while keeping the Zhipu API happy.

Usage in ``config.yaml``::

    - name: glm-5-turbo
      use: kkoclaw.models.patched_zhipu:PatchedChatZhipu
      model: GLM-5-Turbo
      api_key: $ZHIPU_API_KEY
      base_url: https://open.bigmodel.cn/api/coding/paas/v4
      supports_thinking: true
      supports_reasoning_effort: false
      when_thinking_enabled:
        extra_body:
          thinking:
            type: enabled
      when_thinking_disabled:
        extra_body:
          thinking:
            type: disabled
"""

from __future__ import annotations

from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_openai import ChatOpenAI


class PatchedChatZhipu(ChatOpenAI):
    """ChatOpenAI with Zhipu GLM API compatibility fixes.

    Strips ``stream_options`` from the request payload to avoid error 1210.
    The Zhipu API returns token usage in the final streaming chunk by default,
    so usage tracking still works without ``stream_options``.
    """

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """Build request payload with Zhipu-incompatible parameters stripped.

        The Zhipu GLM API rejects several parameters that LangChain injects:

        1. ``stream_options`` — causes error 1210.  LangChain adds
           ``stream_options={"include_usage": True}`` when
           ``stream_usage=True``.  Zhipu returns usage in the final chunk
           by default, so this is safe to strip.

        2. ``max_completion_tokens`` — causes error 1210.  LangChain's
           ``ChatOpenAI._get_request_payload`` renames ``max_tokens`` to
           ``max_completion_tokens`` for OpenAI compatibility, but the
           Zhipu API only accepts ``max_tokens``.
        """
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        # Zhipu API does not support stream_options — causes error 1210.
        payload.pop("stream_options", None)

        # Zhipu API only accepts "max_tokens", not "max_completion_tokens".
        # LangChain's ChatOpenAI renames max_tokens → max_completion_tokens
        # in _get_request_payload, which the Zhipu API rejects with 1210.
        if "max_completion_tokens" in payload:
            payload["max_tokens"] = payload.pop("max_completion_tokens")

        return payload

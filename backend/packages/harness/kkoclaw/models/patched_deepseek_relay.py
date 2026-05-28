"""DeepSeek relay/proxy adapter using ChatOpenAI as base.

Dedicated adapter for DeepSeek models accessed through relay/proxy endpoints
(e.g. card.nassaapi.xyz). Uses ChatOpenAI directly to avoid ChatDeepSeek's
dual-field (api_base vs openai_api_base) bug.

Key relay-specific handling:
- Removes `stream_options` from payload (many relays don't support it)
- Caps max_tokens at 8192 (DeepSeek API limit)
- Strips image_url blocks (DeepSeek API rejects them)
- Preserves reasoning_content for multi-turn thinking conversations
- Truncates oversized system messages to fit relay context limits
"""

import json
import logging
import time
from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

# Relay constraints for card.nassaapi.xyz:
# - 18 tools + 47K system = 87KB → 400 context_length_exceeded
# - 6 tools + 47K system (no history) = 66KB → 200 OK
# - But WITH conversation history, even 6 tools + 47K system → 57KB → 400
# So we must ALSO truncate the system message when history is present.
# Strategy: limit tools to 6, then truncate system message until payload ≤ 50KB.
_RELAY_MAX_TOOLS = 4
_RELAY_MAX_PAYLOAD_BYTES = 50000
_RELAY_SYS_CHAR_LIMIT = 8000


class RelayChatDeepSeek(ChatOpenAI):
    """ChatOpenAI-based adapter for DeepSeek models via relay/proxy endpoints.

    Handles relay-specific issues:
    - stream_options removal (relays often don't support this OpenAI extension)
    - system message truncation (relay tokenizers may count CJK more aggressively)
    - max_tokens capping at 8192 (DeepSeek API hard limit)
    - image_url stripping (DeepSeek API doesn't support image_url content type)
    - reasoning_content preservation for thinking mode
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
        return {"api_key": "DEEPSEEK_API_KEY"}

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """Build request payload with relay-compatible adjustments."""
        # Get the original messages before conversion
        original_messages = self._convert_input(input_).to_messages()

        # Call parent to get the base payload
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        # Resolve model name aliases
        model_name = payload.get("model")
        if model_name and model_name in self._MODEL_NAME_ALIASES:
            payload["model"] = self._MODEL_NAME_ALIASES[model_name]

        # --- Relay-specific payload fixes ---

        # 1. Remove stream_options — many relays don't support this OpenAI extension
        if "stream_options" in payload:
            del payload["stream_options"]

        # 2. Convert max_completion_tokens → max_tokens and cap at 8192
        #    DeepSeek API uses max_tokens, but ChatOpenAI sends max_completion_tokens.
        mct = payload.pop("max_completion_tokens", None)
        if mct is not None:
            payload["max_tokens"] = min(mct, 8192)
        elif payload.get("max_tokens", 0) > 8192:
            payload["max_tokens"] = 8192

        # 3. Process messages
        payload_messages = payload.get("messages", [])

        # Strip image_url blocks (DeepSeek API rejects image_url content type)
        for msg in payload_messages:
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, list):
                    filtered = [
                        block for block in content
                        if not (isinstance(block, dict) and block.get("type") == "image_url")
                    ]
                    if len(filtered) != len(content):
                        msg["content"] = filtered if filtered else [
                            {"type": "text", "text": "[Image omitted]"}
                        ]

        # 4. Limit tools to _RELAY_MAX_TOOLS
        tools_list = payload.get("tools", [])
        if tools_list and len(tools_list) > _RELAY_MAX_TOOLS:
            payload["tools"] = tools_list[:_RELAY_MAX_TOOLS]
            logger.warning(
                f"[RELAY] Trimmed tools: {len(tools_list)} → {_RELAY_MAX_TOOLS}"
            )

        # 5. Truncate system message (handles BOTH str and list content formats)
        #    LangChain sends system message as list of text blocks, e.g.:
        #    [{"type": "text", "text": "..."}, {"type": "text", "text": "..."}]
        #    Previous code only checked isinstance(str) so truncation never fired.
        def _extract_system_text(msg: dict) -> str:
            c = msg.get("content")
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                return " ".join(
                    b.get("text", "") for b in c if isinstance(b, dict)
                )
            return ""

        def _set_system_text(msg: dict, text: str) -> None:
            c = msg.get("content")
            if isinstance(c, str) or c is None:
                msg["content"] = text
            elif isinstance(c, list):
                msg["content"] = [{"type": "text", "text": text}]

        # Truncate ALL system messages (not just the first one).
        # Conversation history may contain old oversized system messages
        # from previous turns before relay adapter was active.
        sys_truncated_count = 0
        for msg in payload_messages:
            if isinstance(msg, dict) and msg.get("role") == "system":
                sys_text = _extract_system_text(msg)
                if len(sys_text) > _RELAY_SYS_CHAR_LIMIT:
                    _set_system_text(msg, sys_text[:_RELAY_SYS_CHAR_LIMIT])
                    sys_truncated_count += 1
        if sys_truncated_count:
            logger.warning(
                f"[RELAY] Truncated {sys_truncated_count} system message(s) "
                f"to {_RELAY_SYS_CHAR_LIMIT} chars"
            )

        # 6. If payload still too large, iteratively halve ALL system messages
        for attempt in range(5):
            payload_size = len(json.dumps(payload, ensure_ascii=False))
            if payload_size <= _RELAY_MAX_PAYLOAD_BYTES:
                break

            shrunk = False
            for msg in payload_messages:
                if isinstance(msg, dict) and msg.get("role") == "system":
                    sys_text = _extract_system_text(msg)
                    if len(sys_text) > 2000:
                        new_len = max(2000, len(sys_text) // 2)
                        _set_system_text(msg, sys_text[:new_len])
                        logger.warning(
                            f"[RELAY] Iter {attempt+1}: system "
                            f"{len(sys_text)} → {new_len} chars "
                            f"(payload {payload_size}b > {_RELAY_MAX_PAYLOAD_BYTES}b)"
                        )
                        shrunk = True
                        break  # halve one at a time

            if not shrunk:
                if payload.get("tools"):
                    payload.pop("tools")
                    logger.warning(
                        f"[RELAY] Iter {attempt+1}: removed all tools "
                        f"(payload {payload_size}b)"
                    )
                else:
                    break

        # 7. Restore reasoning_content on assistant messages
        if len(payload_messages) == len(original_messages):
            for payload_msg, orig_msg in zip(payload_messages, original_messages):
                if payload_msg.get("role") == "assistant" and isinstance(orig_msg, AIMessage):
                    reasoning_content = orig_msg.additional_kwargs.get("reasoning_content")
                    if reasoning_content is not None:
                        payload_msg["reasoning_content"] = reasoning_content
        else:
            ai_messages = [m for m in original_messages if isinstance(m, AIMessage)]
            assistant_payloads = [
                (i, m) for i, m in enumerate(payload_messages)
                if m.get("role") == "assistant"
            ]
            for (idx, _payload_msg), ai_msg in zip(assistant_payloads, ai_messages):
                reasoning_content = ai_msg.additional_kwargs.get("reasoning_content")
                if reasoning_content is not None:
                    payload_messages[idx]["reasoning_content"] = reasoning_content

        # 8. Debug logging
        payload_size = len(json.dumps(payload, ensure_ascii=False))
        final_tools = payload.get("tools", [])

        # Dump full payload to temp file for curl debugging
        import os, tempfile
        dump_path = os.path.join(tempfile.gettempdir(), f"kkoclaw_relay_{int(time.time()*1000)}.json")
        with open(dump_path, "w") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        # Log per-message sizes
        msg_sizes = []
        for i, m in enumerate(payload_messages):
            c = m.get("content")
            if isinstance(c, str):
                msg_sizes.append(f"{m.get('role')}:{len(c)}")
            elif isinstance(c, list):
                total = sum(len(b.get('text','')) for b in c if isinstance(b, dict))
                msg_sizes.append(f"{m.get('role')}:list({total})")
            else:
                msg_sizes.append(f"{m.get('role')}:?")

        logger.info(
            f"[RELAY] model={payload.get('model')} max_tokens={payload.get('max_tokens')} "
            f"stream={payload.get('stream')} msg_count={len(payload_messages)} "
            f"tools={len(final_tools)} payload_bytes={payload_size} "
            f"msgs=[{', '.join(msg_sizes)}] "
            f"keys={sorted(payload.keys())} dump={dump_path}"
        )

        return payload

"""Qiongqi ROI telemetry persistence middleware for the Coding Agent."""

from __future__ import annotations

import logging
import re
from typing import Any, override

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime

from kkoclaw.coding_core.qiongqi import QiongqiEngine, QiongqiRoiReport

logger = logging.getLogger(__name__)

_EXTERNALIZED_OUTPUT_RE = re.compile(
    r"\[Full (?P<tool_name>.+?) output saved to (?P<path>\S+) "
    r"\((?P<chars>\d+) chars, ~(?P<tokens>\d+) tokens\).*?"
    r"(?P<omitted>\d+) chars omitted from this preview\.\]",
    re.DOTALL,
)
_FALLBACK_TRUNCATED_RE = re.compile(
    r"\[\.\.\. (?P<chars>\d+) chars omitted from (?P<tool_name>.+?) output\. "
    r"Persistent storage unavailable\.",
    re.DOTALL,
)
_TOKEN_ECONOMY_RE = re.compile(
    r"\[\.\.\. (?P<chars>\d+) chars omitted by token economy \.\.\.\]",
)


class QiongqiRoiTelemetryMiddleware(AgentMiddleware):
    """Persist Qiongqi ROI telemetry when model usage metadata is available."""

    def __init__(self, engine: QiongqiEngine, *, report: QiongqiRoiReport | dict[str, Any]):
        super().__init__()
        self._engine = engine
        self._report = report
        self._last_total_tokens: int | None = None
        self._seen_tool_output_keys: set[str] = set()
        self._seen_token_economy_keys: set[str] = set()

    @override
    def after_model(self, state, runtime: Runtime | None) -> dict | None:
        self._persist_usage(state)
        return None

    @override
    async def aafter_model(self, state, runtime: Runtime | None) -> dict | None:
        self._persist_usage(state)
        return None

    def _persist_usage(self, state) -> None:
        provider_usage = _latest_provider_usage(state)
        if not provider_usage:
            return
        total_tokens = provider_usage.get("total_tokens")
        if isinstance(total_tokens, int) and total_tokens == self._last_total_tokens:
            return
        counters = _roi_counters_from_state(
            state,
            seen_tool_output_keys=self._seen_tool_output_keys,
            seen_token_economy_keys=self._seen_token_economy_keys,
        )
        try:
            self._engine.persist_roi_telemetry(
                report=self._report,
                provider_usage=provider_usage,
                tool_output=counters["tool_output"],
                token_economy=counters["token_economy"],
            )
            self._last_total_tokens = total_tokens if isinstance(total_tokens, int) else None
        except Exception as exc:
            logger.debug("Failed to persist Qiongqi ROI telemetry: %s", exc)


def _latest_provider_usage(state) -> dict[str, int] | None:
    messages = state.get("messages", []) if isinstance(state, dict) else []
    for message in reversed(messages):
        usage = getattr(message, "usage_metadata", None)
        if not isinstance(usage, dict):
            continue
        input_tokens = _int_usage(usage.get("input_tokens"))
        output_tokens = _int_usage(usage.get("output_tokens"))
        total_tokens = _int_usage(usage.get("total_tokens")) or input_tokens + output_tokens
        if input_tokens == 0 and output_tokens == 0 and total_tokens == 0:
            continue
        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        }
    return None


def _roi_counters_from_state(
    state,
    *,
    seen_tool_output_keys: set[str],
    seen_token_economy_keys: set[str],
) -> dict[str, dict[str, int]]:
    messages = state.get("messages", []) if isinstance(state, dict) else []
    tool_output: dict[str, int] = {}
    token_economy: dict[str, int] = {}
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        text = _message_text(message.content)
        if text is None:
            continue
        tool_call_id = str(getattr(message, "tool_call_id", "") or "")
        for match in _EXTERNALIZED_OUTPUT_RE.finditer(text):
            key = f"externalized:{tool_call_id}:{match.group('path')}:{match.group('chars')}"
            if key in seen_tool_output_keys:
                continue
            seen_tool_output_keys.add(key)
            _increment(tool_output, "externalized_count", 1)
            _increment(tool_output, "externalized_chars", _int_text(match.group("chars")))
        for match in _FALLBACK_TRUNCATED_RE.finditer(text):
            key = f"truncated:{tool_call_id}:{match.group('tool_name')}:{match.group('chars')}"
            if key in seen_tool_output_keys:
                continue
            seen_tool_output_keys.add(key)
            _increment(tool_output, "truncated_count", 1)
            _increment(tool_output, "truncated_chars", _int_text(match.group("chars")))
        for match in _TOKEN_ECONOMY_RE.finditer(text):
            key = f"token-economy:{tool_call_id}:{match.group('chars')}:{match.start()}"
            if key in seen_token_economy_keys:
                continue
            seen_token_economy_keys.add(key)
            _increment(token_economy, "compressed_messages", 1)
            _increment(token_economy, "compressed_chars_saved", _int_text(match.group("chars")))
    return {"tool_output": tool_output, "token_economy": token_economy}


def _message_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if content is None:
        return None
    if isinstance(content, list):
        pieces: list[str] = []
        for part in content:
            if isinstance(part, str):
                pieces.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                pieces.append(part["text"])
            else:
                return None
        return "\n".join(pieces) if pieces else None
    return None


def _increment(counters: dict[str, int], key: str, value: int) -> None:
    if value <= 0:
        return
    counters[key] = counters.get(key, 0) + value


def _int_text(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError:
        return 0
    return parsed if parsed > 0 else 0


def _int_usage(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0

"""Qiongqi ROI telemetry persistence middleware for the Coding Agent."""

from __future__ import annotations

import logging
from typing import Any, override

from langchain.agents.middleware import AgentMiddleware
from langgraph.runtime import Runtime

from kkoclaw.coding_core.qiongqi import QiongqiEngine, QiongqiRoiReport

logger = logging.getLogger(__name__)


class QiongqiRoiTelemetryMiddleware(AgentMiddleware):
    """Persist Qiongqi ROI telemetry when model usage metadata is available."""

    def __init__(self, engine: QiongqiEngine, *, report: QiongqiRoiReport | dict[str, Any]):
        super().__init__()
        self._engine = engine
        self._report = report
        self._last_total_tokens: int | None = None

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
        try:
            self._engine.persist_roi_telemetry(
                report=self._report,
                provider_usage=provider_usage,
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


def _int_usage(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0

"""Suppress tool execution when the provider safety-terminated the response.

Some providers (OpenAI ``finish_reason='content_filter'``, Anthropic
``stop_reason='refusal'``, Gemini ``finish_reason='SAFETY'`` ...) can stop
generation mid-stream while still returning partially-formed ``tool_calls``.
LangChain's tool router treats any AIMessage with a non-empty ``tool_calls``
field as "go execute these", so half-truncated arguments get dispatched as if
they were complete.

This middleware sits at ``after_model`` and gates that behaviour: when a
configured ``SafetyTerminationDetector`` fires *and* the AIMessage carries
tool calls, we strip the tool calls, append a user-facing explanation, and
stash observability fields in ``additional_kwargs.safety_termination``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.safety_termination_detectors import (
    SafetyTermination,
    SafetyTerminationDetector,
    default_detectors,
)
from kkoclaw.agents.middlewares.tool_call_metadata import clone_ai_message_with_tool_calls

if TYPE_CHECKING:
    from kkoclaw.config.safety_finish_reason_config import SafetyFinishReasonConfig

logger = logging.getLogger(__name__)


_USER_FACING_MESSAGE = (
    "The model provider stopped this response with a safety-related signal "
    "({reason_field}={reason_value!r}, detector={detector!r}). Any tool "
    "calls produced in this turn were suppressed because their arguments "
    "may be truncated and unsafe to execute. Please rephrase the request "
    "or ask for a narrower output."
)


class SafetyFinishReasonMiddleware(AgentMiddleware[AgentState]):
    """Strip tool_calls from AIMessages flagged by a SafetyTerminationDetector."""

    def __init__(self, detectors: list[SafetyTerminationDetector] | None = None) -> None:
        super().__init__()
        self._detectors: list[SafetyTerminationDetector] = list(detectors) if detectors else default_detectors()

    @classmethod
    def from_config(cls, config: SafetyFinishReasonConfig) -> SafetyFinishReasonMiddleware:
        if config.detectors is None:
            return cls()

        if not config.detectors:
            raise ValueError(
                "safety_finish_reason.detectors must be omitted (use built-ins) or contain at least one entry; "
                "use enabled=false to disable the middleware entirely."
            )

        from kkoclaw.reflection import resolve_variable

        detectors: list[SafetyTerminationDetector] = []
        for entry in config.detectors:
            detector_cls = resolve_variable(entry.use)
            kwargs = dict(entry.config) if entry.config else {}
            detector = detector_cls(**kwargs)
            if not isinstance(detector, SafetyTerminationDetector):
                raise TypeError(
                    f"{entry.use} did not produce a SafetyTerminationDetector "
                    f"(got {type(detector).__name__}); ensure it has a `name` attribute "
                    "and a `detect(message)` method"
                )
            detectors.append(detector)
        return cls(detectors=detectors)

    # ----- detection -------------------------------------------------------

    def _detect(self, message: AIMessage) -> SafetyTermination | None:
        for detector in self._detectors:
            try:
                hit = detector.detect(message)
            except Exception:
                logger.exception(
                    "SafetyTerminationDetector %r raised; treating as no-match",
                    getattr(detector, "name", type(detector).__name__),
                )
                continue
            if hit is not None:
                return hit
        return None

    # ----- message rewriting ----------------------------------------------

    @staticmethod
    def _append_user_message(content: object, text: str) -> str | list:
        if content is None or content == "":
            return text
        if isinstance(content, list):
            return [*content, {"type": "text", "text": f"\n\n{text}"}]
        if isinstance(content, str):
            return content + f"\n\n{text}"
        return str(content) + f"\n\n{text}"

    def _build_suppressed_message(
        self,
        message: AIMessage,
        termination: SafetyTermination,
    ) -> AIMessage:
        suppressed_names = [tc.get("name") or "unknown" for tc in (message.tool_calls or [])]
        explanation = _USER_FACING_MESSAGE.format(
            reason_field=termination.reason_field,
            reason_value=termination.reason_value,
            detector=termination.detector,
        )
        new_content = self._append_user_message(message.content, explanation)

        cleared = clone_ai_message_with_tool_calls(message, [], content=new_content)

        kwargs = dict(getattr(cleared, "additional_kwargs", None) or {})
        kwargs["safety_termination"] = {
            "detector": termination.detector,
            "reason_field": termination.reason_field,
            "reason_value": termination.reason_value,
            "suppressed_tool_call_count": len(suppressed_names),
            "suppressed_tool_call_names": suppressed_names,
            "extras": dict(termination.extras) if termination.extras else {},
        }
        return cleared.model_copy(update={"additional_kwargs": kwargs})

    # ----- main apply ------------------------------------------------------

    def _apply(self, state: AgentState, runtime: Runtime) -> dict | None:
        messages = state.get("messages", [])
        if not messages:
            return None

        last = messages[-1]
        if not isinstance(last, AIMessage):
            return None

        tool_calls = last.tool_calls
        if not tool_calls:
            return None

        termination = self._detect(last)
        if termination is None:
            return None

        patched = self._build_suppressed_message(last, termination)

        thread_id = None
        if runtime is not None and getattr(runtime, "context", None):
            thread_id = runtime.context.get("thread_id") if isinstance(runtime.context, dict) else None

        logger.warning(
            "Provider safety termination detected — suppressed %d tool call(s)",
            len(tool_calls),
            extra={
                "thread_id": thread_id,
                "detector": termination.detector,
                "reason_field": termination.reason_field,
                "reason_value": termination.reason_value,
                "suppressed_tool_call_names": [tc.get("name") for tc in tool_calls],
            },
        )

        return {"messages": [patched]}

    # ----- hooks -----------------------------------------------------------

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._apply(state, runtime)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._apply(state, runtime)

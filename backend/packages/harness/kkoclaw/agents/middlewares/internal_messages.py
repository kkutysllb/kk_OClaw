"""Helpers for middleware messages that are model-visible but UI-hidden."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage

INTERNAL_MIDDLEWARE_MESSAGE_KEY = "internal_middleware_message"


def internal_human_message(
    *,
    content: Any,
    marker: str,
    name: str | None = None,
    id: str | None = None,
    additional_kwargs: dict[str, Any] | None = None,
) -> HumanMessage:
    """Create a HumanMessage intended only for model context."""
    kwargs = dict(additional_kwargs or {})
    kwargs["hide_from_ui"] = True
    kwargs[INTERNAL_MIDDLEWARE_MESSAGE_KEY] = marker
    return HumanMessage(
        content=content,
        id=id,
        name=name,
        additional_kwargs=kwargs,
    )

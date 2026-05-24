"""Middleware that strips internal planning blocks from AI messages.

Some LLMs spontaneously emit structured internal-planning headers such as
```
SESSION INTENT
...
SUMMARY
...
```
in their ``reasoning_content`` (thinking chain) or ``content``.  These blocks
are **never** meant for end-users; they are the model's private scratch-pad.

Previously we relied solely on frontend ``stripInternalContent()`` to filter
them, but that approach is fragile because new rendering paths may be added
that miss the filtering step.  Stripping at the middleware layer is more
robust: the content never reaches the wire in the first place.

The middleware runs *after* the model call (``after_model`` /
``aafter_model``) so the LLM still sees its own planning during the current
turn — we only strip it from the persisted message that gets streamed to the
client.
"""

from __future__ import annotations

import re
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage
from langgraph.runtime import Runtime

_LOGGER_HEADER = "internal_content_strip"

# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------

# Matches the header line: "SESSION INTENT", "SUMMARY", "ARTIFACTS", optionally
# prefixed with "# " (markdown heading) and followed by whitespace / EOL.
_HEADER_RE = re.compile(
    r"^(?:#\s*)?(?:SESSION\s+INTENT|SUMMARY|ARTIFACTS?)(?:[\s]|$)",
    re.IGNORECASE | re.MULTILINE,
)

# A more aggressive block-level stripper: when the *first* non-blank line in
# the text is an internal header, the **entire** text is considered internal
# planning and is removed.
_FIRST_HEADER_RE = re.compile(
    r"^\s*(?:#\s*)?(?:SESSION\s+INTENT|SUMMARY|ARTIFACTS?)\b",
    re.IGNORECASE,
)


def _strip_internal_blocks(text: str) -> str:
    """Remove internal planning blocks from *text*.

    Strategy (mirrors the frontend ``stripInternalContent`` v3 logic):
      1. Fast path: if the first non-blank line is an internal header, the
         entire text is internal → return ``""``.
      2. Slow path: walk line-by-line, entering skip-mode on an internal
         header and resuming only on a blank line whose next non-blank line
         is *not* another internal header.
    """
    if not text:
        return text

    lines = text.split("\n")

    # Fast path
    first_non_blank: int | None = None
    for idx, line in enumerate(lines):
        if line.strip():
            first_non_blank = idx
            break

    if first_non_blank is not None and _FIRST_HEADER_RE.match(lines[first_non_blank].strip()):
        return ""

    # Slow path
    result: list[str] = []
    skipping = False
    i = 0
    while i < len(lines):
        line = lines[i]
        trimmed = line.strip()

        if _FIRST_HEADER_RE.match(trimmed):
            skipping = True
            i += 1
            continue

        if skipping:
            if trimmed == "":
                # Peek ahead: if next non-blank is another header, stay in skip
                next_nb: int | None = None
                for j in range(i + 1, len(lines)):
                    if lines[j].strip():
                        next_nb = j
                        break
                if next_nb is not None and _FIRST_HEADER_RE.match(lines[next_nb].strip()):
                    i += 1
                    continue
                # Otherwise resume normal output
                skipping = False
            i += 1
            continue

        result.append(line)
        i += 1

    output = "\n".join(result).replace("\n\n\n", "\n\n").strip()
    return output


def _needs_stripping(text: str | None) -> bool:
    """Return True if *text* contains at least one internal header."""
    return bool(text and _HEADER_RE.search(text))


class InternalContentMiddleware(AgentMiddleware[AgentState]):
    """Strip internal planning headers (SESSION INTENT / SUMMARY / ARTIFACTS)
    from the latest AIMessage's ``content`` and ``reasoning_content``.
    """

    def _strip(self, state: AgentState) -> dict | None:
        messages: list[Any] = state.get("messages", [])
        if not messages:
            return None

        last_msg = messages[-1]
        if not isinstance(last_msg, AIMessage):
            return None

        updates: dict[str, Any] = {}

        # --- Strip reasoning_content (thinking chain) ---
        additional_kwargs = dict(last_msg.additional_kwargs or {})
        reasoning = additional_kwargs.get("reasoning_content")
        if isinstance(reasoning, str) and _needs_stripping(reasoning):
            stripped = _strip_internal_blocks(reasoning)
            if stripped != reasoning:
                additional_kwargs["reasoning_content"] = stripped
                updates["additional_kwargs"] = additional_kwargs

        # --- Strip main content ---
        content = last_msg.content
        if isinstance(content, str) and _needs_stripping(content):
            stripped = _strip_internal_blocks(content)
            if stripped != content:
                updates["content"] = stripped
        elif isinstance(content, list):
            new_parts: list[Any] = []
            changed = False
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text" and _needs_stripping(part.get("text", "")):
                    new_text = _strip_internal_blocks(part.get("text", ""))
                    if new_text != part.get("text", ""):
                        new_parts.append({**part, "text": new_text})
                        changed = True
                    else:
                        new_parts.append(part)
                else:
                    new_parts.append(part)
            if changed:
                updates["content"] = new_parts

        if not updates:
            return None

        updated_msg = last_msg.model_copy(update=updates)
        return {"messages": [updated_msg]}

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._strip(state)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._strip(state)

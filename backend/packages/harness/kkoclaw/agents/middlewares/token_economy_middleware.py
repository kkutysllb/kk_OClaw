"""Token Economy Middleware — systematic token optimization for OClaw.

Ported and adapted from Kun's ``token-economy.ts``. This middleware
applies two token-saving strategies on every model call:

1. **Historical tool-result compression**: Old ToolMessages in the
   conversation history are truncated to a head+tail preview. Protected
   segments (code blocks, URLs, file paths, error signals) are preserved
   using placeholder substitution so compression never destroys critical
   information.

2. **Concise response instruction**: A system-reminder is injected at
   the top of the message list, instructing the model to reply concisely.

The middleware is **disabled by default**. Enable via
``token_economy.enabled: true`` in config.yaml.
"""

from __future__ import annotations

import logging
import re
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest
from langchain_core.messages import HumanMessage, ToolMessage

from kkoclaw.agents.middlewares.internal_messages import internal_human_message
from kkoclaw.config.token_economy_config import TokenEconomyConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Concise response instruction (injected as a system-reminder)
# ---------------------------------------------------------------------------

TOKEN_ECONOMY_INSTRUCTION = "\n".join([
    "Token economy mode is enabled.",
    "Reply concisely: answer directly, skip pleasantries, filler, and hedging.",
    "Preserve exact code, commands, paths, URLs, identifiers, and quoted errors.",
    "When tool output says content was omitted, use narrower read/grep/bash ranges instead of guessing.",
])

# ---------------------------------------------------------------------------
# Protected segments — patterns that must survive compression
# ---------------------------------------------------------------------------

_PROTECTED_SEGMENT_PREFIX = "__OCLAW_PROTECTED_SEGMENT_"
_PROTECTED_SEGMENT_SUFFIX = "__"

_PROTECTED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"```[\s\S]*?```", re.MULTILINE),  # Code blocks
    re.compile(r"`[^`\n]+`"),  # Inline code
    re.compile(r"\bhttps?://\S+", re.IGNORECASE),  # URLs
    re.compile(r"[\w.\-]*[/\\][\w./\\\-]+"),  # File paths
    re.compile(r"\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b"),  # Constants (UPPER_SNAKE_CASE)
    re.compile(r"\b\d+\.\d+\.\d+\b"),  # Version numbers
]

# Signal lines — lines containing these words are always preserved during truncation
_SIGNAL_LINE_RE = re.compile(
    r"\b(error|failed?|fatal|panic|exception|traceback|warning|warn|denied|"
    r"timeout|timed out|not found|cannot|invalid)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Protected segments helper
# ---------------------------------------------------------------------------


def _with_protected_segments(text: str, transform: Any) -> str:
    """Protect critical patterns, apply *transform*, then restore them.

    Args:
        text: Original text.
        transform: A callable(str) -> str that operates on the text with
            protected segments replaced by placeholders.

    Returns:
        The transformed text with original protected segments restored.
    """
    segments: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        idx = len(segments)
        segments.append(match.group(0))
        return f"{_PROTECTED_SEGMENT_PREFIX}{idx}{_PROTECTED_SEGMENT_SUFFIX}"

    working = text
    for pattern in _PROTECTED_PATTERNS:
        working = pattern.sub(_replace, working)

    result = transform(working)

    # Restore all placeholders
    marker_re = re.compile(
        re.escape(_PROTECTED_SEGMENT_PREFIX) + r"(\d+)" + re.escape(_PROTECTED_SEGMENT_SUFFIX)
    )
    return marker_re.sub(lambda m: segments[int(m.group(1))] if int(m.group(1)) < len(segments) else "", result)


# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------


def _message_text(content: Any) -> str | None:
    """Extract plain-text content from a ToolMessage content field."""
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


# ---------------------------------------------------------------------------
# Head + tail truncation
# ---------------------------------------------------------------------------


def _truncate_head_tail(
    text: str,
    max_chars: int,
    *,
    head_ratio: float = 0.6,
) -> str:
    """Truncate *text* to *max_chars* using head+tail split.

    Signal lines (containing error/warning keywords) are always preserved.
    Protected segments within the text are NOT destroyed — they appear
    in whichever portion they fall in naturally.

    Args:
        text: The text to truncate.
        max_chars: Maximum total characters (including the omission marker).
        head_ratio: Fraction of the budget allocated to the head.

    Returns:
        Truncated text with an omission marker, or original if within budget.
    """
    if max_chars <= 0 or len(text) <= max_chars:
        return text

    marker = f"\n\n[... {len(text) - max_chars + 80} chars omitted by token economy ...]\n\n"
    marker_overhead = len(marker)

    if marker_overhead >= max_chars:
        # Extremely tight budget — just take what fits
        return text[:max_chars]

    budget = max_chars - marker_overhead
    head_chars = int(budget * head_ratio)
    tail_chars = budget - head_chars

    lines = text.split("\n")

    # Collect signal lines that fall outside the head/tail window
    head_end_byte = head_chars
    tail_start_byte = len(text) - tail_chars

    # Build head and tail
    head_text = text[:head_end_byte]
    tail_text = text[tail_start_byte:]

    # Snap to line boundaries
    nl = text.rfind("\n", 0, head_end_byte)
    if nl >= 0:
        head_text = text[: nl + 1]

    nl = text.find("\n", tail_start_byte)
    if nl >= 0:
        tail_text = text[nl + 1 :]

    # Look for signal lines in the omitted region
    omitted_start = len(head_text)
    omitted_end = len(text) - len(tail_text)
    if omitted_end > omitted_start:
        omitted_region = text[omitted_start:omitted_end]
        signal_lines: list[str] = []
        for line in omitted_region.split("\n"):
            if _SIGNAL_LINE_RE.search(line):
                signal_lines.append(line.strip())
        if signal_lines:
            # Add up to 5 signal lines between head and tail
            signal_block = "\n".join(signal_lines[:5])
            return head_text + marker + f"[signal lines from omitted region]\n{signal_block}\n" + tail_text

    return head_text + marker + tail_text


# ---------------------------------------------------------------------------
# Middleware class
# ---------------------------------------------------------------------------


class TokenEconomyMiddleware(AgentMiddleware[AgentState]):
    """Apply token-saving strategies to model calls.

    Hooks into ``wrap_model_call`` to:
    - Compress old ToolMessage content in the conversation history.
    - Inject a concise-response system-reminder.

    Args:
        config: TokenEconomyConfig instance. If None, uses defaults.
    """

    def __init__(self, config: TokenEconomyConfig | None = None) -> None:
        super().__init__()
        self._config = config if config is not None else TokenEconomyConfig()

    @classmethod
    def from_app_config(cls, app_config: Any) -> TokenEconomyMiddleware:
        token_economy = getattr(app_config, "token_economy", None)
        if isinstance(token_economy, TokenEconomyConfig):
            return cls(config=token_economy)
        return cls()

    # -- Model call hooks ---

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Any,
    ) -> ModelCallResult:
        if not self._config.enabled:
            return handler(request)

        messages = getattr(request, "messages", None)
        if isinstance(messages, list):
            patched = self._process_messages(messages)
            if patched is not None:
                request = request.override(messages=patched)

        return handler(request)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Any,
    ) -> ModelCallResult:
        if not self._config.enabled:
            return await handler(request)

        messages = getattr(request, "messages", None)
        if isinstance(messages, list):
            patched = self._process_messages(messages)
            if patched is not None:
                request = request.override(messages=patched)

        return await handler(request)

    # -- Core message processing ---

    def _process_messages(self, messages: list[Any]) -> list[Any] | None:
        """Process messages for token economy. Returns None if unchanged."""
        changed = False
        updated: list[Any] = list(messages)

        # 1. Compress historical tool results
        if self._config.compress_history_tool_results:
            for i, msg in enumerate(updated):
                if self._should_compress(updated, i):
                    patched = self._compress_tool_message(msg)
                    if patched is not msg:
                        updated[i] = patched
                        changed = True

        # 2. Inject concise response instruction at the beginning
        if self._config.concise_responses:
            if not self._already_has_instruction(updated):
                instruction_msg = internal_human_message(
                    marker="token_economy_instruction",
                    name="token_economy_instruction",
                    content=f"<system-reminder>\n{TOKEN_ECONOMY_INSTRUCTION}\n</system-reminder>",
                )
                updated.insert(0, instruction_msg)
                changed = True

        return updated if changed else None

    def _should_compress(self, messages: list[Any], index: int) -> bool:
        """Check if the ToolMessage at *index* should be compressed.

        A ToolMessage is compressed only if:
        - It is a ToolMessage with string content.
        - Its content exceeds ``max_history_tool_result_chars``.
        - It is NOT among the most recent ``recent_tool_result_count`` ToolMessages.
        """
        msg = messages[index]
        if not isinstance(msg, ToolMessage):
            return False

        text = _message_text(msg.content)
        if text is None:
            return False
        if len(text) <= self._config.max_history_tool_result_chars:
            return False

        # Count ToolMessages after this one — if there are >= recent_tool_result_count,
        # this message is old enough to compress.
        tool_msgs_after = sum(
            1 for i in range(index + 1, len(messages))
            if isinstance(messages[i], ToolMessage)
        )

        return tool_msgs_after >= self._config.recent_tool_result_count

    def _compress_tool_message(self, msg: ToolMessage) -> ToolMessage:
        """Compress a single ToolMessage's content."""
        text = _message_text(msg.content)
        if text is None:
            return msg

        truncated = _with_protected_segments(
            text,
            lambda t: _truncate_head_tail(t, self._config.max_history_tool_result_chars),
        )

        if truncated == text:
            return msg

        update: dict[str, Any] = {"content": truncated}
        if getattr(msg, "response_metadata", None):
            update["response_metadata"] = dict(msg.response_metadata)
        if getattr(msg, "additional_kwargs", None):
            update["additional_kwargs"] = dict(msg.additional_kwargs)
        return msg.model_copy(update=update)

    def _already_has_instruction(self, messages: list[Any]) -> bool:
        """Check if the concise instruction was already injected."""
        if not messages:
            return False
        first = messages[0]
        content = getattr(first, "content", "")
        if isinstance(content, str):
            return "Token economy mode is enabled" in content
        return False

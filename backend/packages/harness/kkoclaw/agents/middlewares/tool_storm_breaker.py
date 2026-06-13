"""Tool Storm Breaker — same-turn duplicate tool call suppression.

Ported from Kun's ``tool-storm-breaker.ts``. Prevents the model from
calling the same tool with identical arguments multiple times within
a single turn, which inflates dynamic history and wastes tokens.

The breaker is **turn-scoped**: call :meth:`reset_turn` when a new
user turn starts. Mutating tool calls (write/edit/delete) clear the
read-only history so legitimate retries after file changes are allowed.
"""

from __future__ import annotations

import json
import logging
from collections import deque
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_WINDOW_SIZE = 8
_DEFAULT_THRESHOLD = 2  # suppress on the 3rd identical call (0-indexed: count >= threshold-1... see Kun logic)

_MUTATING_TOOL_NAMES = frozenset({
    "write_file",
    "write",
    "edit",
    "str_replace",
    "edit_diff",
    "apply_patch",
    "delete",
    "move",
    "bash",
    "bash_tool",
})

_STORM_EXEMPT_TOOL_NAMES = frozenset({
    "request_user_input",
    "user_input",
})


@dataclass
class StormBreakerResult:
    """Result of inspecting a tool call."""

    suppress: bool
    reason: str | None = None


class ToolStormBreaker:
    """Prevents repeated identical tool calls within a single turn.

    Tracks recent tool calls (name + canonical args) in a sliding window.
    When the same call appears ``threshold`` times, subsequent calls are
    suppressed with an explanatory message.

    Args:
        window_size: Maximum number of recent calls to track. Default: 8.
        threshold: Number of identical calls before suppression triggers.
            With threshold=2, the 3rd identical call is suppressed
            (count starts at 0, suppress when count >= threshold).
            Minimum: 2 (to allow at least one retry).
    """

    def __init__(
        self,
        *,
        window_size: int = _DEFAULT_WINDOW_SIZE,
        threshold: int = _DEFAULT_THRESHOLD,
    ) -> None:
        self._window_size = max(1, window_size)
        self._threshold = max(2, threshold)
        self._recent: deque[dict[str, Any]] = deque(maxlen=self._window_size)

    def inspect(
        self,
        tool_name: str,
        tool_args: dict | Any,
    ) -> StormBreakerResult:
        """Check if a tool call should be suppressed.

        Args:
            tool_name: Name of the tool being called.
            tool_args: Arguments passed to the tool (dict or other).

        Returns:
            :class:`StormBreakerResult` with ``suppress=True`` if the call
            should be blocked.
        """
        if tool_name in _STORM_EXEMPT_TOOL_NAMES:
            return StormBreakerResult(suppress=False)

        args_key = _stable_stringify(tool_args)
        is_read_only = not _is_mutating_tool(tool_name)

        if not is_read_only:
            self._clear_read_only_entries()

        # Count how many times this exact call appeared in the window
        count = sum(
            1
            for entry in self._recent
            if entry["name"] == tool_name and entry["args"] == args_key
        )

        # Suppress when count >= threshold - 1 (i.e., threshold-th call)
        if count >= self._threshold - 1:
            return StormBreakerResult(
                suppress=True,
                reason=(
                    f"{tool_name} was called with identical arguments {count + 1} times in this turn; "
                    "repeat-loop guard suppressed the duplicate. Choose a narrower query or explain why "
                    "another identical call is needed."
                ),
            )

        self._recent.append({
            "name": tool_name,
            "args": args_key,
            "read_only": is_read_only,
        })
        return StormBreakerResult(suppress=False)

    def reset_turn(self) -> None:
        """Clear all tracked calls for a new turn."""
        self._recent.clear()

    def _clear_read_only_entries(self) -> None:
        """Remove read-only entries when a mutating call is made."""
        to_keep = [e for e in self._recent if not e.get("read_only", False)]
        self._recent.clear()
        self._recent.extend(to_keep)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_mutating_tool(tool_name: str) -> bool:
    """Check if a tool is a mutating (write/edit/delete) operation."""
    return tool_name in _MUTATING_TOOL_NAMES


def _stable_stringify(value: Any) -> str:
    """Produce a canonical JSON string with sorted keys for stable comparison."""
    try:
        return json.dumps(_canonicalize(value), sort_keys=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def _canonicalize(value: Any) -> Any:
    """Recursively canonicalize a value: sort dict keys, recurse into lists."""
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {k: _canonicalize(value[k]) for k in sorted(value.keys())}
    return value

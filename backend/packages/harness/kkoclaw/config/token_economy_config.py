"""Configuration for the Token Economy system.

Implements Kun-inspired token optimization layers:
- Concise response instructions
- Historical tool-result compression
- Tool Storm Breaker (same-turn duplicate call suppression)

All features are **disabled by default** to ensure backward compatibility.
Enable explicitly in config.yaml.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TokenEconomyConfig(BaseModel):
    """Config section for the Token Economy middleware.

    When enabled, the system applies multiple token-saving strategies:
    concise response instructions, historical tool-result compression,
    and same-turn duplicate tool call suppression (Storm Breaker).

    All fields default to safe values; the system is opt-in via ``enabled``.
    """

    enabled: bool = Field(
        default=False,
        description="Master switch for the entire Token Economy system. When False, no token economy logic runs.",
    )

    # -- Concise response instructions ---
    concise_responses: bool = Field(
        default=True,
        description="Inject a system-reminder instructing the model to reply concisely (skip pleasantries, preserve code/commands/paths).",
    )

    # -- Historical tool-result compression ---
    compress_history_tool_results: bool = Field(
        default=True,
        description="Compress old ToolMessage content in the conversation history to reduce token usage.",
    )
    max_history_tool_result_chars: int = Field(
        default=2000,
        ge=0,
        description="Maximum characters to retain for each old ToolMessage in history (head+tail split). 0 disables truncation.",
    )
    recent_tool_result_count: int = Field(
        default=4,
        ge=0,
        description="Number of most recent ToolMessages exempt from historical compression.",
    )

    # -- Storm Breaker (same-turn duplicate suppression) ---
    storm_breaker_enabled: bool = Field(
        default=True,
        description="Suppress identical tool calls repeated within the same turn (Storm Breaker).",
    )
    storm_breaker_threshold: int = Field(
        default=2,
        ge=1,
        description="Number of identical calls (name+args) before suppression triggers. The Nth call (count >= threshold) is suppressed.",
    )
    storm_breaker_window: int = Field(
        default=8,
        ge=1,
        description="Sliding window size for tracking recent tool calls in Storm Breaker.",
    )

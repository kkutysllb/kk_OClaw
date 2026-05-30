"""Configuration for SafetyFinishReasonMiddleware."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SafetyDetectorConfig(BaseModel):
    """One detector entry under ``safety_finish_reason.detectors``."""

    use: str = Field(
        description="Class path of a SafetyTerminationDetector implementation.",
    )
    config: dict = Field(
        default_factory=dict,
        description="Constructor kwargs passed to the detector class.",
    )


class SafetyFinishReasonConfig(BaseModel):
    """Configuration for the SafetyFinishReasonMiddleware."""

    enabled: bool = Field(
        default=True,
        description="Master switch for the SafetyFinishReasonMiddleware.",
    )
    detectors: list[SafetyDetectorConfig] | None = Field(
        default=None,
        description=(
            "Custom detector list. Leave unset (None) to use the built-in "
            "set covering OpenAI-compatible content_filter, Anthropic "
            "refusal, and Gemini SAFETY/BLOCKLIST/PROHIBITED_CONTENT/SPII/"
            "RECITATION. Provide a non-null list to fully override."
        ),
    )

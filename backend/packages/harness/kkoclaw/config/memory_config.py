"""Configuration for memory mechanism."""

from typing import Literal

from pydantic import BaseModel, Field


class MemoryRetrievalConfig(BaseModel):
    """Configuration for context-aware memory fact retrieval."""

    enabled: bool = Field(
        default=False,
        description="Whether to enable context-aware memory retrieval",
    )
    strategy: Literal["tfidf"] = Field(
        default="tfidf",
        description="Fact retrieval strategy",
    )
    context_max_turns: int = Field(
        default=4,
        ge=1,
        le=12,
        description="Recent user/final-assistant turns used to build current context",
    )
    context_max_chars: int = Field(
        default=4000,
        ge=200,
        le=20000,
        description="Maximum characters retained in the current context query",
    )
    similarity_weight: float = Field(
        default=0.6,
        ge=0.0,
        le=1.0,
        description="Weight applied to similarity score",
    )
    confidence_weight: float = Field(
        default=0.4,
        ge=0.0,
        le=1.0,
        description="Weight applied to fact confidence",
    )
    min_similarity: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Minimum similarity floor for ranking",
    )


class MemoryConfig(BaseModel):
    """Configuration for global memory mechanism."""

    enabled: bool = Field(
        default=True,
        description="Whether to enable memory mechanism",
    )
    storage_path: str = Field(
        default="",
        description=(
            "Path to store memory data. "
            "If empty, defaults to per-user memory at `{base_dir}/users/{user_id}/memory.json`. "
            "Absolute paths are used as-is and opt out of per-user isolation "
            "(all users share the same file). "
            "Relative paths are resolved against `Paths.base_dir` "
            "(not the backend working directory). "
            "Note: if you previously set this to `.kkoclaw/memory.json`, "
            "the file will now be resolved as `{base_dir}/.kkoclaw/memory.json`; "
            "migrate existing data or use an absolute path to preserve the old location."
        ),
    )
    storage_class: str = Field(
        default="kkoclaw.agents.memory.storage.FileMemoryStorage",
        description="The class path for memory storage provider",
    )
    debounce_seconds: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Seconds to wait before processing queued updates (debounce)",
    )
    model_name: str | None = Field(
        default=None,
        description="Model name to use for memory updates (None = use default model)",
    )
    max_facts: int = Field(
        default=100,
        ge=10,
        le=500,
        description="Maximum number of facts to store",
    )
    fact_confidence_threshold: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Minimum confidence threshold for storing facts",
    )
    injection_enabled: bool = Field(
        default=True,
        description="Whether to inject memory into system prompt",
    )
    max_injection_tokens: int = Field(
        default=2000,
        ge=100,
        le=8000,
        description="Maximum tokens to use for memory injection",
    )
    retrieval: MemoryRetrievalConfig = Field(
        default_factory=MemoryRetrievalConfig,
        description="Context-aware memory retrieval configuration",
    )


# Global configuration instance
_memory_config: MemoryConfig = MemoryConfig()


def get_memory_config() -> MemoryConfig:
    """Get the current memory configuration."""
    return _memory_config


def set_memory_config(config: MemoryConfig) -> None:
    """Set the memory configuration."""
    global _memory_config
    _memory_config = config


def load_memory_config_from_dict(config_dict: dict) -> None:
    """Load memory configuration from a dictionary."""
    global _memory_config
    _memory_config = MemoryConfig(**config_dict)

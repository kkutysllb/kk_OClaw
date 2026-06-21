"""Configuration for the dedicated Coding Agent graph."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CodingAgentWorktreeConfig(BaseModel):
    enabled: bool = Field(default=True, description="Whether git worktree isolation is enabled")
    auto_create: bool = Field(default=False, description="Create a worktree automatically when a coding task starts")
    base_branch: str = Field(default="main", description="Base branch for new coding worktrees")


class CodingAgentGitConfig(BaseModel):
    auto_commit: bool = Field(default=False, description="Automatically commit coding-agent changes")
    conventional_commits: bool = Field(default=True, description="Require Conventional Commit style messages")


class CodingAgentTestConfig(BaseModel):
    auto_run: bool = Field(default=False, description="Automatically run configured test commands/frameworks")
    frameworks: list[str] = Field(default_factory=lambda: ["pytest", "jest", "vitest", "go test"])


class CodingAgentConfig(BaseModel):
    enabled: bool = Field(default=True, description="Whether the dedicated coding_agent graph is enabled")
    model: str | None = Field(default=None, description="Optional model override for coding tasks")
    sandbox: Literal["local", "docker"] = Field(default="local", description="Preferred sandbox mode for coding tasks")
    default_permission_mode: Literal["safe-only", "safe", "yolo"] = Field(
        default="safe-only",
        description="Default permission policy for coding-agent tools",
    )
    post_edit_verify_enabled: bool = Field(
        default=True,
        description="Enable the default lightweight TDD-first and post-edit verification guard",
    )
    post_edit_verify_mode: Literal["soft", "hard"] = Field(
        default="soft",
        description="Post-edit verification enforcement mode",
    )
    auto_accept_forward_stage: bool = Field(
        default=False,
        description=(
            "When true, agent suggestions that move the project exactly one "
            "step forward (current.next_stage_id) are auto-accepted without "
            "a confirmation banner. Backward, skip, or entry into the final "
            "'delivery' stage still require manual confirmation."
        ),
    )
    worktree: CodingAgentWorktreeConfig = Field(default_factory=CodingAgentWorktreeConfig)
    git: CodingAgentGitConfig = Field(default_factory=CodingAgentGitConfig)
    test: CodingAgentTestConfig = Field(default_factory=CodingAgentTestConfig)

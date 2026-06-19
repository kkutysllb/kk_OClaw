"""Coding Agent runtime context helpers."""

from __future__ import annotations

from dataclasses import dataclass

from kkoclaw.coding_core.paths import coding_home


def resolve_coding_scratch_root(thread_id: str | None) -> str | None:
    """Return the Coding scratch root for a thread, if a thread is known.

    Resolves under :func:`coding_home` so the desktop shell (which sets
    ``KKOCLAW_CODING_HOME``) writes scratch workspaces to its isolated
    ``~/.oclaw-coding-desktop`` instead of the web's ``~/.oclaw-coding``.
    """
    if not thread_id:
        return None
    return str(coding_home() / thread_id / "workspace")


@dataclass(frozen=True)
class CodingRuntimeContext:
    """Stable context passed into the isolated Coding runtime boundary."""

    project_root: str | None
    thread_id: str | None = None
    scratch_root: str | None = None

    @classmethod
    def from_runtime(
        cls,
        *,
        project_root: str | None = None,
        thread_id: str | None = None,
        scratch_root: str | None = None,
    ) -> "CodingRuntimeContext":
        return cls(
            project_root=project_root,
            thread_id=thread_id,
            scratch_root=scratch_root or resolve_coding_scratch_root(thread_id),
        )

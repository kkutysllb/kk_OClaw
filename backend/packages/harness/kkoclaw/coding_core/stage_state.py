"""Per-project persistent delivery-stage state.

Each project (identified by its absolute ``project_root``) has exactly one
"current delivery stage" plus an append-only history of every transition.
This is project-scoped (not thread-scoped): when the user opens multiple
coding-agent threads for the same project, they all observe the same stage.

Storage layout
--------------
    {coding_home()}/projects/{project_hash}/stage-state.json

``coding_home()`` resolves to ``~/.oclaw-coding`` on web or
``~/.oclaw-coding-desktop`` on the desktop build (set via the
``KKOCLAW_CODING_HOME`` env var). ``project_hash`` is the first 16 hex
chars of ``sha1(realpath(project_root))`` so paths with spaces, unicode,
or other awkward characters map to a filesystem-safe directory name.

Concurrency
-----------
Writes are atomic (``tmp + rename``). The store has no locking; concurrent
writes from multiple threads in the same process can race, but the
append-only history model means the worst case is a duplicate or missing
entry — never corruption.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from kkoclaw.coding_core.delivery_stages import is_valid_stage_id
from kkoclaw.coding_core.paths import coding_home

logger = logging.getLogger(__name__)

_STAGE_STATE_FILENAME = "stage-state.json"
_PROJECTS_DIRNAME = "projects"
_HASH_LEN = 16

StageSource = Literal["user", "agent_suggested", "agent_accepted"]


@dataclass(frozen=True)
class StageHistoryEntry:
    """A single transition recorded in the project's stage history.

    ``thread_id`` and ``run_outcome`` are optional metadata that bind a
    transition to the specific agent run that triggered it (G1/G2).
    They default to ``None`` so old persisted state still deserialises.
    """

    from_stage_id: str | None
    to_stage_id: str
    reason: str
    source: StageSource
    timestamp: str  # ISO-8601 UTC
    thread_id: str | None = None
    run_outcome: str | None = None


@dataclass(frozen=True)
class StageSuggestion:
    """An agent-suggested stage transition awaiting user confirmation."""

    stage_id: str
    reason: str
    suggested_by_thread_id: str
    timestamp: str  # ISO-8601 UTC


@dataclass(frozen=True)
class ProjectStageState:
    """The complete per-project stage state snapshot."""

    project_root: str
    current_stage: str | None  # None = not started yet
    stage_history: tuple[StageHistoryEntry, ...]
    pending_suggestion: StageSuggestion | None
    updated_at: str | None

    def to_payload(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dict suitable for API responses."""
        return _state_to_payload(self)


class ProjectStageStore:
    """Filesystem-backed store for per-project delivery stage state."""

    root: Path

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or coding_home()

    @classmethod
    def from_home(cls) -> ProjectStageStore:
        """Create a store rooted at the Coding Agent home directory."""
        return cls(coding_home())

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_state(self, project_root: str) -> ProjectStageState:
        """Read the current state for *project_root*.

        Always returns a ``ProjectStageState`` — empty if no state has
        been persisted yet (current_stage=None, empty history, no
        pending suggestion).
        """
        path = self._state_path(project_root)
        raw = _read_json(path)
        return _payload_to_state(project_root, raw)

    def set_current_stage(
        self,
        project_root: str,
        stage_id: str,
        *,
        reason: str,
        source: StageSource,
        thread_id: str | None = None,
        run_outcome: str | None = None,
    ) -> ProjectStageState:
        """Transition the project to *stage_id* and append a history entry.

        Raises ``ValueError`` if *stage_id* is not a known delivery stage.

        ``thread_id`` / ``run_outcome`` are optional metadata binding the
        transition to the agent run that triggered it (G1/G2).
        """
        if not is_valid_stage_id(stage_id):
            raise ValueError(f"Unknown delivery stage id: {stage_id!r}")
        if source not in ("user", "agent_suggested", "agent_accepted"):
            raise ValueError(f"Invalid source: {source!r}")

        state = self.get_state(project_root)
        if state.current_stage == stage_id and source != "agent_suggested":
            # No-op transition (user re-enters the current stage). We still
            # record it so the history reflects user intent, but we skip
            # the write if absolutely nothing changed.
            return state

        entry = StageHistoryEntry(
            from_stage_id=state.current_stage,
            to_stage_id=stage_id,
            reason=reason,
            source=source,
            timestamp=_now_iso(),
            thread_id=thread_id,
            run_outcome=run_outcome,
        )
        new_state = ProjectStageState(
            project_root=project_root,
            current_stage=stage_id,
            stage_history=(*state.stage_history, entry),
            pending_suggestion=None,  # a manual set clears any pending suggestion
            updated_at=entry.timestamp,
        )
        self._write_state(project_root, new_state)
        return new_state

    def suggest_stage(
        self,
        project_root: str,
        stage_id: str,
        *,
        reason: str,
        thread_id: str,
    ) -> ProjectStageState:
        """Record an agent-suggested transition. Does NOT change current_stage.

        If a suggestion already exists, it is overwritten (only the most
        recent suggestion is kept).
        """
        if not is_valid_stage_id(stage_id):
            raise ValueError(f"Unknown delivery stage id: {stage_id!r}")

        state = self.get_state(project_root)
        suggestion = StageSuggestion(
            stage_id=stage_id,
            reason=reason,
            suggested_by_thread_id=thread_id,
            timestamp=_now_iso(),
        )
        new_state = ProjectStageState(
            project_root=project_root,
            current_stage=state.current_stage,
            stage_history=state.stage_history,
            pending_suggestion=suggestion,
            updated_at=suggestion.timestamp,
        )
        self._write_state(project_root, new_state)
        return new_state

    def accept_suggestion(
        self,
        project_root: str,
        *,
        run_outcome: str | None = None,
    ) -> ProjectStageState:
        """Apply the pending suggestion as the new current stage.

        Raises ``ValueError`` if there is no pending suggestion.
        The originating ``thread_id`` from the suggestion is propagated
        into the history entry (G1/G2).
        """
        state = self.get_state(project_root)
        if state.pending_suggestion is None:
            raise ValueError("No pending stage suggestion to accept")

        suggestion = state.pending_suggestion
        return self.set_current_stage(
            project_root,
            suggestion.stage_id,
            reason=suggestion.reason,
            source="agent_accepted",
            thread_id=suggestion.suggested_by_thread_id or None,
            run_outcome=run_outcome,
        )

    def dismiss_suggestion(self, project_root: str) -> ProjectStageState:
        """Discard the pending suggestion without applying it.

        No-op (returns current state) if there is no pending suggestion.
        """
        state = self.get_state(project_root)
        if state.pending_suggestion is None:
            return state
        new_state = ProjectStageState(
            project_root=project_root,
            current_stage=state.current_stage,
            stage_history=state.stage_history,
            pending_suggestion=None,
            updated_at=_now_iso(),
        )
        self._write_state(project_root, new_state)
        return new_state

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _state_path(self, project_root: str) -> Path:
        return (
            self.root
            / _PROJECTS_DIRNAME
            / _project_hash(project_root)
            / _STAGE_STATE_FILENAME
        )

    def _write_state(self, project_root: str, state: ProjectStageState) -> None:
        path = self._state_path(project_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(path, _state_to_payload(state))


# ----------------------------------------------------------------------
# (De)serialisation helpers
# ----------------------------------------------------------------------


def _project_hash(project_root: str) -> str:
    """Stable filesystem-safe key derived from the absolute project path.

    Uses ``os.path.realpath`` so symlinks don't fragment state across
    resolvings, and SHA-1 (first 16 hex chars) for a compact, collision-
    resistant directory name. The original ``project_root`` is always
    stored inside the JSON payload so it can be recovered.
    """
    real = os.path.realpath(project_root)
    digest = hashlib.sha1(real.encode("utf-8")).hexdigest()
    return digest[:_HASH_LEN]


def _payload_to_state(project_root: str, raw: dict[str, Any]) -> ProjectStageState:
    """Build a ``ProjectStageState`` from a JSON dict.

    Missing fields default to empty values, so a missing or corrupt file
    yields a clean "fresh project" state instead of raising.
    """
    if not isinstance(raw, dict):
        return _empty_state(project_root)

    history_raw = raw.get("stage_history")
    history: tuple[StageHistoryEntry, ...] = ()
    if isinstance(history_raw, list):
        for item in history_raw:
            entry = _parse_history_entry(item)
            if entry is not None:
                history = (*history, entry)

    pending_raw = raw.get("pending_suggestion")
    pending = _parse_suggestion(pending_raw) if isinstance(pending_raw, dict) else None

    current = raw.get("current_stage")
    if not isinstance(current, str):
        current = None
    elif not is_valid_stage_id(current):
        # Defensive: a future stage-list change could orphan old state
        # files. Don't crash, just treat as "no current stage".
        logger.warning(
            "stage-state for %s references unknown stage %r; ignoring",
            project_root,
            current,
        )
        current = None

    updated = raw.get("updated_at")
    if not isinstance(updated, str):
        updated = None

    return ProjectStageState(
        project_root=raw.get("project_root") or project_root,
        current_stage=current,
        stage_history=history,
        pending_suggestion=pending,
        updated_at=updated,
    )


def _empty_state(project_root: str) -> ProjectStageState:
    return ProjectStageState(
        project_root=project_root,
        current_stage=None,
        stage_history=(),
        pending_suggestion=None,
        updated_at=None,
    )


def _parse_history_entry(raw: Any) -> StageHistoryEntry | None:
    if not isinstance(raw, dict):
        return None
    to_stage = raw.get("to_stage_id")
    if not isinstance(to_stage, str) or not is_valid_stage_id(to_stage):
        return None
    from_stage = raw.get("from_stage_id")
    if not (from_stage is None or isinstance(from_stage, str)):
        from_stage = None
    source = raw.get("source")
    if source not in ("user", "agent_suggested", "agent_accepted"):
        source = "user"
    reason = raw.get("reason")
    if not isinstance(reason, str):
        reason = ""
    timestamp = raw.get("timestamp")
    if not isinstance(timestamp, str):
        timestamp = _now_iso()
    thread_id = raw.get("thread_id")
    if not isinstance(thread_id, str) or not thread_id:
        thread_id = None
    run_outcome = raw.get("run_outcome")
    if not isinstance(run_outcome, str) or not run_outcome:
        run_outcome = None

    return StageHistoryEntry(
        from_stage_id=from_stage,
        to_stage_id=to_stage,
        reason=reason,
        source=source,  # type: ignore[arg-type]
        timestamp=timestamp,
        thread_id=thread_id,
        run_outcome=run_outcome,
    )


def _parse_suggestion(raw: Any) -> StageSuggestion | None:
    if not isinstance(raw, dict):
        return None
    stage_id = raw.get("stage_id")
    if not isinstance(stage_id, str) or not is_valid_stage_id(stage_id):
        return None
    reason = raw.get("reason")
    if not isinstance(reason, str):
        reason = ""
    thread_id = raw.get("suggested_by_thread_id")
    if not isinstance(thread_id, str):
        thread_id = ""
    timestamp = raw.get("timestamp")
    if not isinstance(timestamp, str):
        timestamp = _now_iso()
    return StageSuggestion(
        stage_id=stage_id,
        reason=reason,
        suggested_by_thread_id=thread_id,
        timestamp=timestamp,
    )


def _state_to_payload(state: ProjectStageState) -> dict[str, Any]:
    return {
        "project_root": state.project_root,
        "current_stage": state.current_stage,
        "stage_history": [
            {
                "from_stage_id": entry.from_stage_id,
                "to_stage_id": entry.to_stage_id,
                "reason": entry.reason,
                "source": entry.source,
                "timestamp": entry.timestamp,
                "thread_id": entry.thread_id,
                "run_outcome": entry.run_outcome,
            }
            for entry in state.stage_history
        ],
        "pending_suggestion": (
            None
            if state.pending_suggestion is None
            else {
                "stage_id": state.pending_suggestion.stage_id,
                "reason": state.pending_suggestion.reason,
                "suggested_by_thread_id": state.pending_suggestion.suggested_by_thread_id,
                "timestamp": state.pending_suggestion.timestamp,
            }
        ),
        "updated_at": state.updated_at,
    }


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    """Atomic write: write to ``path.tmp`` then rename over *path*."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return raw if isinstance(raw, dict) else {}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


__all__ = [
    "ProjectStageState",
    "ProjectStageStore",
    "StageHistoryEntry",
    "StageSource",
    "StageSuggestion",
]

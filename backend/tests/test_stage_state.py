"""Unit tests for the per-project delivery stage store."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kkoclaw.coding_core.stage_state import (
    ProjectStageStore,
    StageHistoryEntry,
    StageSuggestion,
)

PROJECT_ROOT = "/tmp/demo-project"


@pytest.fixture()
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProjectStageStore:
    """A ProjectStageStore rooted at a temp dir.

    We construct the store directly with an explicit root so we don't
    need to touch the real ``coding_home()``.
    """
    return ProjectStageStore(root=tmp_path)


def test_new_project_returns_empty_state(store: ProjectStageStore) -> None:
    state = store.get_state(PROJECT_ROOT)
    assert state.project_root == PROJECT_ROOT
    assert state.current_stage is None
    assert state.stage_history == ()
    assert state.pending_suggestion is None
    assert state.updated_at is None


def test_set_current_stage_records_history(store: ProjectStageStore) -> None:
    state = store.set_current_stage(
        PROJECT_ROOT,
        "requirements",
        reason="kickoff",
        source="user",
    )
    assert state.current_stage == "requirements"
    assert len(state.stage_history) == 1
    entry = state.stage_history[0]
    assert entry.from_stage_id is None
    assert entry.to_stage_id == "requirements"
    assert entry.reason == "kickoff"
    assert entry.source == "user"
    assert state.updated_at is not None
    assert state.pending_suggestion is None


def test_history_accumulates_across_jumps_and_backtracks(
    store: ProjectStageStore,
) -> None:
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="r1", source="user")
    store.set_current_stage(PROJECT_ROOT, "implementation", reason="r2", source="user")
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="rollback", source="user")

    state = store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    assert [h.to_stage_id for h in state.stage_history] == [
        "requirements",
        "implementation",
        "requirements",
    ]
    assert state.stage_history[-1].from_stage_id == "implementation"


def test_set_current_stage_persists_across_store_instances(
    store: ProjectStageStore, tmp_path: Path,
) -> None:
    store.set_current_stage(PROJECT_ROOT, "design", reason="start", source="user")

    fresh_store = ProjectStageStore(root=tmp_path)
    state = fresh_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "design"


def test_set_current_stage_rejects_unknown_stage(store: ProjectStageStore) -> None:
    with pytest.raises(ValueError, match="Unknown delivery stage"):
        store.set_current_stage(PROJECT_ROOT, "nope", reason="", source="user")


def test_set_current_stage_rejects_bad_source(store: ProjectStageStore) -> None:
    with pytest.raises(ValueError, match="Invalid source"):
        store.set_current_stage(
            PROJECT_ROOT, "requirements", reason="", source="alien",  # type: ignore[arg-type]
        )


def test_suggest_stage_does_not_change_current(store: ProjectStageStore) -> None:
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")
    state = store.suggest_stage(
        PROJECT_ROOT,
        "design",
        reason="requirements done",
        thread_id="thread-1",
    )
    assert state.current_stage == "requirements"  # unchanged
    assert state.pending_suggestion is not None
    assert state.pending_suggestion.stage_id == "design"
    assert state.pending_suggestion.reason == "requirements done"
    assert state.pending_suggestion.suggested_by_thread_id == "thread-1"


def test_suggest_stage_overwrites_previous_suggestion(
    store: ProjectStageStore,
) -> None:
    store.suggest_stage(PROJECT_ROOT, "design", reason="first", thread_id="t1")
    store.suggest_stage(PROJECT_ROOT, "implementation", reason="second", thread_id="t2")
    state = store.get_state(PROJECT_ROOT)
    assert state.pending_suggestion is not None
    assert state.pending_suggestion.stage_id == "implementation"
    assert state.pending_suggestion.suggested_by_thread_id == "t2"


def test_suggest_stage_rejects_unknown_stage(store: ProjectStageStore) -> None:
    with pytest.raises(ValueError, match="Unknown delivery stage"):
        store.suggest_stage(PROJECT_ROOT, "nope", reason="", thread_id="t")


def test_accept_suggestion_applies_and_clears(store: ProjectStageStore) -> None:
    store.suggest_stage(
        PROJECT_ROOT, "design", reason="ready", thread_id="t1",
    )
    state = store.accept_suggestion(PROJECT_ROOT)
    assert state.current_stage == "design"
    assert state.pending_suggestion is None
    # The accepted transition is recorded in history.
    assert len(state.stage_history) == 1
    assert state.stage_history[0].to_stage_id == "design"
    assert state.stage_history[0].source == "agent_accepted"
    assert state.stage_history[0].reason == "ready"


def test_accept_suggestion_without_pending_raises(
    store: ProjectStageStore,
) -> None:
    with pytest.raises(ValueError, match="No pending"):
        store.accept_suggestion(PROJECT_ROOT)


def test_dismiss_suggestion_clears_pending(store: ProjectStageStore) -> None:
    store.suggest_stage(PROJECT_ROOT, "design", reason="", thread_id="t")
    state = store.dismiss_suggestion(PROJECT_ROOT)
    assert state.pending_suggestion is None


def test_dismiss_without_pending_is_noop(store: ProjectStageStore) -> None:
    state_before = store.get_state(PROJECT_ROOT)
    state_after = store.dismiss_suggestion(PROJECT_ROOT)
    assert state_after.pending_suggestion is None
    assert state_after.current_stage == state_before.current_stage


def test_manual_set_clears_pending_suggestion(store: ProjectStageStore) -> None:
    store.suggest_stage(PROJECT_ROOT, "design", reason="from agent", thread_id="t")
    state = store.set_current_stage(
        PROJECT_ROOT, "implementation", reason="override", source="user",
    )
    assert state.pending_suggestion is None
    assert state.current_stage == "implementation"


def test_distinct_projects_have_isolated_state(store: ProjectStageStore) -> None:
    store.set_current_stage("/tmp/proj-a", "requirements", reason="", source="user")
    store.set_current_stage("/tmp/proj-b", "delivery", reason="", source="user")

    a = store.get_state("/tmp/proj-a")
    b = store.get_state("/tmp/proj-b")
    assert a.current_stage == "requirements"
    assert b.current_stage == "delivery"


def test_state_file_path_uses_project_hash(
    store: ProjectStageStore, tmp_path: Path,
) -> None:
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")
    # The state file should live under tmp/projects/<16-hex>/stage-state.json
    projects_dir = tmp_path / "projects"
    assert projects_dir.is_dir()
    subdirs = [p for p in projects_dir.iterdir() if p.is_dir()]
    assert len(subdirs) == 1
    assert len(subdirs[0].name) == 16  # hex hash length
    assert (subdirs[0] / "stage-state.json").is_file()


def test_corrupt_state_file_recovers_to_empty(
    store: ProjectStageStore, tmp_path: Path,
) -> None:
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")
    state_path = store._state_path(PROJECT_ROOT)  # noqa: SLF001 — test only
    state_path.write_text("{not valid json", encoding="utf-8")
    state = store.get_state(PROJECT_ROOT)
    assert state.current_stage is None
    assert state.stage_history == ()


def test_state_to_payload_round_trip(store: ProjectStageStore) -> None:
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="r1", source="user")
    store.suggest_stage(PROJECT_ROOT, "design", reason="go", thread_id="t1")

    state_path = store._state_path(PROJECT_ROOT)  # noqa: SLF001 — test only
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert payload["current_stage"] == "requirements"
    assert payload["pending_suggestion"]["stage_id"] == "design"
    assert payload["stage_history"][0]["to_stage_id"] == "requirements"


def test_history_entry_with_unknown_to_stage_is_dropped(
    store: ProjectStageStore, tmp_path: Path,
) -> None:
    """Defensive: a future stage-list change could orphan old state files.

    History entries pointing at removed stages are silently dropped on
    load so the UI doesn't break.
    """
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")
    state_path = store._state_path(PROJECT_ROOT)  # noqa: SLF001 — test only
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    payload["stage_history"].append(
        {
            "from_stage_id": "requirements",
            "to_stage_id": "deleted-in-future",
            "reason": "x",
            "source": "user",
            "timestamp": "2026-01-01T00:00:00+00:00",
        }
    )
    state_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    state = store.get_state(PROJECT_ROOT)
    assert len(state.stage_history) == 1  # orphan entry dropped
    assert state.stage_history[0].to_stage_id == "requirements"

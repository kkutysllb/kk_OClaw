"""Tests for the delivery-stage auto-accept feature (B) and the
``_is_forward_transition`` helper.

These verify:
- G1/G2: ``thread_id`` propagation on auto-accepted transitions
- B: forward-only auto-accept (backward / skip / delivery remain manual)
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from kkoclaw.coding_core.stage_state import ProjectStageStore

PROJECT_ROOT = "/tmp/demo-project"


# ------------------------------------------------------------------ #
# Mock helpers
# ------------------------------------------------------------------ #

def _runtime(
    project_root: str = PROJECT_ROOT,
    thread_id: str = "thread-1",
    test_results: list | None = None,
) -> SimpleNamespace:
    state: dict = {
        "thread_data": {"project_root": project_root, "thread_id": thread_id},
    }
    if test_results is not None:
        state["test_results"] = test_results
    return SimpleNamespace(state=state)


def _make_config(auto_accept: bool) -> SimpleNamespace:
    return SimpleNamespace(
        coding_agent=SimpleNamespace(auto_accept_forward_stage=auto_accept),
    )


@pytest.fixture()
def temp_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProjectStageStore:
    """Patch ``ProjectStageStore.from_home`` to use a temp-rooted store."""
    store = ProjectStageStore(root=tmp_path)
    monkeypatch.setattr(
        "kkoclaw.tools.coding.stage_tools.ProjectStageStore.from_home",
        staticmethod(lambda: store),
    )
    return store


def _patch_tool_deps(
    monkeypatch: pytest.MonkeyPatch,
    *,
    auto_accept: bool,
    project_root: str = PROJECT_ROOT,
    thread_id: str = "thread-1",
) -> None:
    """Patch ``get_app_config`` + ``get_thread_data`` inside stage_tools."""
    from kkoclaw.tools.coding import stage_tools

    monkeypatch.setattr(stage_tools, "get_app_config", lambda: _make_config(auto_accept))
    monkeypatch.setattr(
        stage_tools,
        "get_thread_data",
        lambda r: {"project_root": project_root, "thread_id": thread_id},
    )


# ------------------------------------------------------------------ #
# Pure-function tests: _is_forward_transition
# ------------------------------------------------------------------ #

def test_forward_transition_next_stage() -> None:
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    assert _is_forward_transition("requirements", "design") is True
    assert _is_forward_transition("design", "initialization") is True
    assert _is_forward_transition("implementation", "verification") is True
    assert _is_forward_transition("verification", "review") is True


def test_forward_transition_backward_is_false() -> None:
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    assert _is_forward_transition("design", "requirements") is False
    assert _is_forward_transition("implementation", "design") is False


def test_forward_transition_skip_is_false() -> None:
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    # Jumping 2+ stages forward is NOT auto-accepted
    assert _is_forward_transition("requirements", "implementation") is False
    assert _is_forward_transition("requirements", "delivery") is False


def test_forward_transition_to_delivery_always_false() -> None:
    """Entering the terminal 'delivery' stage always requires manual confirm."""
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    assert _is_forward_transition("review", "delivery") is False


def test_forward_transition_from_none_to_first_stage() -> None:
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    assert _is_forward_transition(None, "requirements") is True


def test_forward_transition_from_none_to_non_first_is_false() -> None:
    from kkoclaw.tools.coding.stage_tools import _is_forward_transition

    assert _is_forward_transition(None, "design") is False
    assert _is_forward_transition(None, "delivery") is False


# ------------------------------------------------------------------ #
# Full tool tests: auto-accept behaviour
# ------------------------------------------------------------------ #

def test_auto_accept_forward_transitions_immediately(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forward suggestion is auto-accepted — no pending_suggestion banner."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="design", reason="requirements done",
    )

    assert "Automatically transitioned" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "design"
    assert state.pending_suggestion is None
    entry = state.stage_history[-1]
    assert entry.source == "agent_accepted"
    assert entry.thread_id == "thread-1"


def test_auto_accept_disabled_creates_suggestion(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=False)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="design", reason="requirements done",
    )

    assert "Suggested transitioning" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    assert state.pending_suggestion is not None


def test_auto_accept_skip_still_creates_suggestion(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Skip (jump >1 forward) remains manual even with auto-accept on."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="implementation", reason="skip ahead",
    )

    assert "Suggested transitioning" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    assert state.pending_suggestion is not None


def test_auto_accept_backward_still_creates_suggestion(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "implementation", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="design", reason="rollback",
    )

    assert "Suggested transitioning" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "implementation"


def test_auto_accept_delivery_still_creates_suggestion(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Entering 'delivery' always requires manual confirmation."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "review", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="delivery", reason="ready to ship",
    )

    assert "Suggested transitioning" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "review"
    assert state.pending_suggestion is not None


def test_auto_accept_from_none_to_requirements(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Project not started → suggesting 'requirements' is auto-accepted."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="requirements", reason="kickoff",
    )

    assert "Automatically transitioned" in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    assert state.pending_suggestion is None


# ------------------------------------------------------------------ #
# G4: run_outcome auto-fill on auto-accept path
# ------------------------------------------------------------------ #


def test_summarize_run_outcome_empty_state() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    assert _summarize_run_outcome(None) is None
    assert _summarize_run_outcome(SimpleNamespace(state=None)) is None


def test_summarize_run_outcome_no_results() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    rt = SimpleNamespace(state={"thread_data": {}})
    assert _summarize_run_outcome(rt) is None


def test_summarize_run_outcome_lint_clean() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    rt = SimpleNamespace(state={
        "test_results": [
            {"command": "ruff check .", "passed": True},
        ],
    })
    assert _summarize_run_outcome(rt) == "lint_clean"


def test_summarize_run_outcome_tests_passed_with_count() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    rt = SimpleNamespace(state={
        "test_results": [
            {
                "command": "pytest",
                "passed": True,
                "summary": {"passed": 5, "total": 5},
            },
        ],
    })
    outcome = _summarize_run_outcome(rt)
    assert outcome is not None
    assert "tests_passed:5" in outcome


def test_summarize_run_outcome_tests_failed() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    rt = SimpleNamespace(state={
        "test_results": [
            {
                "command": "jest",
                "passed": False,
                "summary": {"passed": 2, "failed": 1, "total": 3},
            },
        ],
    })
    assert _summarize_run_outcome(rt) == "tests_failed"


def test_summarize_run_outcome_combined() -> None:
    from kkoclaw.tools.coding.stage_tools import _summarize_run_outcome

    rt = SimpleNamespace(state={
        "test_results": [
            {"command": "ruff check .", "passed": True},
            {"command": "pytest", "passed": True, "summary": {"passed": 3}},
        ],
    })
    outcome = _summarize_run_outcome(rt)
    assert outcome == "lint_clean, tests_passed:3"


def test_auto_accept_records_run_outcome(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G4: auto-accept path captures test_results into history run_outcome."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    test_results = [
        {"command": "ruff check .", "passed": True},
        {"command": "pytest", "passed": True, "summary": {"passed": 4}},
    ]
    rt = _runtime(test_results=test_results)

    result = stage_tools.suggest_delivery_stage_tool.func(
        rt, stage_id="design", reason="requirements done",
    )

    assert "Automatically transitioned" in result
    assert "Run outcome:" in result
    state = temp_store.get_state(PROJECT_ROOT)
    entry = state.stage_history[-1]
    assert entry.run_outcome is not None
    assert "lint_clean" in entry.run_outcome
    assert "tests_passed:4" in entry.run_outcome


def test_auto_accept_without_test_results_has_no_outcome(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When no verification data exists, run_outcome stays None."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=True)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    result = stage_tools.suggest_delivery_stage_tool.func(
        _runtime(), stage_id="design", reason="requirements done",
    )

    assert "Automatically transitioned" in result
    assert "Run outcome:" not in result
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.stage_history[-1].run_outcome is None


def test_manual_suggestion_path_does_not_capture_outcome(
    temp_store: ProjectStageStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G4 only fills outcome on the auto-accept path, not on manual suggestion."""
    from kkoclaw.tools.coding import stage_tools

    _patch_tool_deps(monkeypatch, auto_accept=False)
    temp_store.set_current_stage(PROJECT_ROOT, "requirements", reason="", source="user")

    test_results = [{"command": "pytest", "passed": True, "summary": {"passed": 5}}]
    rt = _runtime(test_results=test_results)

    result = stage_tools.suggest_delivery_stage_tool.func(
        rt, stage_id="design", reason="requirements done",
    )

    assert "Suggested transitioning" in result
    # No history entry is created on the suggestion path (only pending_suggestion).
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.pending_suggestion is not None
    assert len(state.stage_history) == 1  # only the initial 'requirements' set

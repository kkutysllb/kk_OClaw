"""Tests for the cold-start bootstrap behaviour of
``_build_delivery_stage_section``.

When a project has no stage yet (``current_stage is None``), the first
call to ``_build_delivery_stage_section`` must automatically initialise
the project to the ``requirements`` stage so the workflow panel and the
agent's dynamic context are populated without any manual click.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from kkoclaw.coding_core.stage_state import ProjectStageStore

PROJECT_ROOT = "/tmp/demo-cold-start"


@pytest.fixture()
def temp_store(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> ProjectStageStore:
    """Patch ``ProjectStageStore.from_home`` to a temp-rooted store."""
    store = ProjectStageStore(root=tmp_path)
    monkeypatch.setattr(
        "kkoclaw.coding_core.stage_state.ProjectStageStore.from_home",
        staticmethod(lambda: store),
    )
    # qiongqi imports ProjectStageStore inside the function, so patching
    # the class method is enough — both `from_home()` callers resolve to
    # the same monkeypatched store.
    return store


def test_cold_start_auto_initialises_to_requirements(
    temp_store: ProjectStageStore,
) -> None:
    """First call on a fresh project writes current_stage=requirements."""
    from kkoclaw.coding_core.qiongqi import _build_delivery_stage_section

    assert temp_store.get_state(PROJECT_ROOT).current_stage is None

    section = _build_delivery_stage_section(PROJECT_ROOT)

    # The section must be rendered (not None) and mention requirements.
    assert section is not None
    assert "requirements" in section.lower()

    # The store must now have current_stage = requirements.
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    assert len(state.stage_history) == 1
    entry = state.stage_history[0]
    assert entry.from_stage_id is None
    assert entry.to_stage_id == "requirements"
    assert entry.source == "agent_accepted"


def test_cold_start_is_idempotent(temp_store: ProjectStageStore) -> None:
    """Second call does NOT create another history entry."""
    from kkoclaw.coding_core.qiongqi import _build_delivery_stage_section

    _build_delivery_stage_section(PROJECT_ROOT)
    _build_delivery_stage_section(PROJECT_ROOT)
    _build_delivery_stage_section(PROJECT_ROOT)

    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "requirements"
    # Still only one transition — the bootstrap is a one-shot.
    assert len(state.stage_history) == 1


def test_cold_start_preserves_existing_stage(temp_store: ProjectStageStore) -> None:
    """If the project is already past requirements, bootstrap is skipped."""
    from kkoclaw.coding_core.qiongqi import _build_delivery_stage_section

    temp_store.set_current_stage(
        PROJECT_ROOT, "design", reason="already started", source="user",
    )

    section = _build_delivery_stage_section(PROJECT_ROOT)

    assert section is not None
    assert "design" in section.lower()
    state = temp_store.get_state(PROJECT_ROOT)
    assert state.current_stage == "design"
    # No spurious requirements entry injected.
    assert all(h.to_stage_id != "requirements" for h in state.stage_history)


def test_cold_start_section_contains_goal_and_signals(
    temp_store: ProjectStageStore,
) -> None:
    """The rendered section must include the stage goal + completion signals
    so the agent has full context after the bootstrap."""
    from kkoclaw.coding_core.qiongqi import _build_delivery_stage_section

    section = _build_delivery_stage_section(PROJECT_ROOT)

    assert section is not None
    # The requirements stage goal mentions "验收标准".
    assert "验收标准" in section
    # Completion signals block must be present.
    assert "Completion signals" in section or "完成信号" in section
    # Next stage hint must point to design.
    assert "design" in section.lower()

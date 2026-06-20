"""Unit tests for the delivery stage catalog."""

from __future__ import annotations

from kkoclaw.coding_core.delivery_stages import (
    DELIVERY_STAGES,
    DeliveryStage,
    get_stage,
    is_valid_stage_id,
    list_stages,
)

EXPECTED_IDS = (
    "requirements",
    "design",
    "initialization",
    "implementation",
    "verification",
    "review",
    "delivery",
)


def test_list_stages_returns_seven_canonical_stages_in_order() -> None:
    stages = list_stages()
    assert [s.id for s in stages] == list(EXPECTED_IDS)
    assert len(stages) == 7


def test_list_stages_returns_fresh_copy() -> None:
    first = list_stages()
    first.append(first[0])
    second = list_stages()
    assert len(second) == 7


def test_get_stage_returns_match() -> None:
    stage = get_stage("implementation")
    assert isinstance(stage, DeliveryStage)
    assert stage.id == "implementation"
    assert stage.title == "实现"
    assert stage.next_stage_id == "verification"


def test_get_stage_returns_none_for_unknown_id() -> None:
    assert get_stage("nonexistent") is None
    assert get_stage("") is None


def test_is_valid_stage_id_accepts_known_ids() -> None:
    for stage_id in EXPECTED_IDS:
        assert is_valid_stage_id(stage_id), f"{stage_id} should be valid"


def test_is_valid_stage_id_rejects_unknown_ids() -> None:
    assert not is_valid_stage_id("Requirements")  # case sensitive
    assert not is_valid_stage_id("requirements ")  # whitespace
    assert not is_valid_stage_id("unknown-stage")
    assert not is_valid_stage_id("")


def test_chain_of_next_stage_ids_is_contiguous() -> None:
    """Walking next_stage_id from requirements should hit every stage
    exactly once and end with delivery.next_stage_id == None."""
    visited: list[str] = []
    current: DeliveryStage | None = get_stage("requirements")
    while current is not None:
        visited.append(current.id)
        if current.next_stage_id is None:
            break
        current = get_stage(current.next_stage_id)
    assert visited == list(EXPECTED_IDS)


def test_only_delivery_has_no_next_stage() -> None:
    terminal = [s for s in DELIVERY_STAGES if s.next_stage_id is None]
    assert len(terminal) == 1
    assert terminal[0].id == "delivery"


def test_next_stage_id_targets_are_valid() -> None:
    for stage in DELIVERY_STAGES:
        if stage.next_stage_id is not None:
            assert is_valid_stage_id(stage.next_stage_id)

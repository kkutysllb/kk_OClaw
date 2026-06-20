"""Integration tests for the coding delivery API endpoints."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import coding_delivery


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A FastAPI TestClient with only the delivery router mounted."""
    monkeypatch.setenv("KKOCLAW_CODING_HOME", str(tmp_path / "oclaw-coding"))
    app = FastAPI()
    app.include_router(coding_delivery.router)
    return TestClient(app)


PROJECT_ROOT = "/tmp/demo-project"
ROOT_QUERY = f"?project_root={quote(PROJECT_ROOT, safe='')}"


def test_get_delivery_stages_returns_seven(client: TestClient) -> None:
    resp = client.get("/api/coding/delivery-stages")
    assert resp.status_code == 200
    data = resp.json()
    assert "stages" in data
    assert len(data["stages"]) == 7
    assert data["stages"][0]["id"] == "requirements"
    assert data["stages"][-1]["id"] == "delivery"
    stage = data["stages"][2]
    assert "title" in stage
    assert "goal" in stage
    assert "recommended_skills" in stage
    assert "suggested_prompt" in stage
    assert "next_stage_id" in stage


def test_get_project_stage_empty(client: TestClient) -> None:
    resp = client.get(f"/api/coding/stage{ROOT_QUERY}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_root"] == PROJECT_ROOT
    assert data["current_stage"] is None
    assert data["stage_history"] == []
    assert data["pending_suggestion"] is None
    assert data["updated_at"] is None


def test_set_project_stage(client: TestClient) -> None:
    resp = client.post(
        f"/api/coding/stage{ROOT_QUERY}",
        json={"stage_id": "requirements", "reason": "Starting project"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_stage"] == "requirements"
    assert len(data["stage_history"]) == 1
    assert data["stage_history"][0]["to_stage_id"] == "requirements"
    assert data["stage_history"][0]["source"] == "user"
    assert data["updated_at"] is not None


def test_set_project_stage_invalid_id(client: TestClient) -> None:
    resp = client.post(
        f"/api/coding/stage{ROOT_QUERY}",
        json={"stage_id": "nonexistent", "reason": ""},
    )
    assert resp.status_code == 400


def test_set_project_stage_with_jumps_and_backtrack(client: TestClient) -> None:
    """User can jump forward and backtrack; history accumulates."""
    r1 = client.post(
        f"/api/coding/stage{ROOT_QUERY}",
        json={"stage_id": "implementation", "reason": "skip ahead"},
    )
    assert r1.status_code == 200
    assert r1.json()["current_stage"] == "implementation"

    r2 = client.post(
        f"/api/coding/stage{ROOT_QUERY}",
        json={"stage_id": "requirements", "reason": "going back"},
    )
    assert r2.status_code == 200
    assert r2.json()["current_stage"] == "requirements"

    state = client.get(f"/api/coding/stage{ROOT_QUERY}").json()
    assert len(state["stage_history"]) == 2
    assert state["stage_history"][0]["to_stage_id"] == "implementation"
    assert state["stage_history"][1]["to_stage_id"] == "requirements"


def test_project_root_with_spaces_and_chinese(client: TestClient) -> None:
    """project_root with spaces and CJK characters must round-trip correctly."""
    root = "/Users/test/我的 项目"
    q = f"?project_root={quote(root, safe='')}"
    resp = client.post(
        f"/api/coding/stage{q}",
        json={"stage_id": "design", "reason": "unicode test"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_root"] == root
    assert data["current_stage"] == "design"

    resp2 = client.get(f"/api/coding/stage{q}")
    assert resp2.status_code == 200
    assert resp2.json()["project_root"] == root


def test_accept_suggestion_without_pending_returns_400(client: TestClient) -> None:
    resp = client.post(f"/api/coding/stage/suggestion/accept{ROOT_QUERY}")
    assert resp.status_code == 400


def test_dismiss_suggestion_without_pending_is_noop(client: TestClient) -> None:
    resp = client.post(f"/api/coding/stage/suggestion/dismiss{ROOT_QUERY}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending_suggestion"] is None


def test_accept_suggestion_after_agent_suggests(client: TestClient) -> None:
    """Simulate agent suggestion then user acceptance."""
    from kkoclaw.coding_core.stage_state import ProjectStageStore

    store = ProjectStageStore.from_home()
    store.set_current_stage(PROJECT_ROOT, "requirements", reason="init", source="user")
    store.suggest_stage(
        PROJECT_ROOT,
        "design",
        reason="Requirements complete",
        thread_id="test-thread",
    )

    resp = client.post(f"/api/coding/stage/suggestion/accept{ROOT_QUERY}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_stage"] == "design"
    assert data["pending_suggestion"] is None


def test_dismiss_suggestion_after_agent_suggests(client: TestClient) -> None:
    """Simulate agent suggestion then user dismissal."""
    from kkoclaw.coding_core.stage_state import ProjectStageStore

    store = ProjectStageStore.from_home()
    store.set_current_stage(PROJECT_ROOT, "design", reason="init", source="user")
    store.suggest_stage(
        PROJECT_ROOT,
        "implementation",
        reason="Design done",
        thread_id="test-thread",
    )

    resp = client.post(f"/api/coding/stage/suggestion/dismiss{ROOT_QUERY}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_stage"] == "design"  # unchanged
    assert data["pending_suggestion"] is None


def test_manual_set_clears_pending_suggestion(client: TestClient) -> None:
    """When user manually pushes stage, any pending suggestion is dismissed."""
    from kkoclaw.coding_core.stage_state import ProjectStageStore

    store = ProjectStageStore.from_home()
    store.suggest_stage(
        PROJECT_ROOT,
        "design",
        reason="Agent suggestion",
        thread_id="t1",
    )

    resp = client.post(
        f"/api/coding/stage{ROOT_QUERY}",
        json={"stage_id": "implementation", "reason": "user override"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_stage"] == "implementation"
    assert data["pending_suggestion"] is None  # cleared

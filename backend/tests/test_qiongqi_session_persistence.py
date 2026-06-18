from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_qiongqi_session_store_persists_session_snapshot_and_events(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "review",
                "name": "Review",
                "description": "Review code changes.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["review"]},
                "tools": ["read_file_lines"],
                "permissions": {"write": False},
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\nCheck behavior.\n", encoding="utf-8")

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-persist")
    active_skills = engine.activate_skills_for_task("please review this change")
    policy = engine.active_skill_policy_for_task("please review this change")
    roi = engine.build_roi_report(
        stable_prompt=engine.build_stable_system_prompt(),
        tools=[{"name": "read_file_lines"}, {"name": "apply_patch"}],
        visible_tools=[{"name": "read_file_lines"}],
    )

    store = QiongqiSessionStore.from_home()
    snapshot = store.persist_session(
        engine.session,
        active_skills=active_skills,
        tool_policy=policy,
        roi=engine.roi_metadata(roi),
        change_summary={"changed_files": 0},
    )
    store.append_event(snapshot.thread_id, "session_started", {"project_root": str(project)})
    store.append_event(snapshot.thread_id, "roi_reported", {"hidden_tool_count": 1})

    session_dir = home / ".oclaw-coding" / "thread-persist"
    assert snapshot.session_dir == session_dir
    assert snapshot.scratch_root == str(session_dir / "workspace")
    assert (session_dir / "session.json").is_file()
    assert (session_dir / "events.jsonl").is_file()

    payload = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    assert payload["thread_id"] == "thread-persist"
    assert payload["project_root"] == str(project)
    assert payload["scratch_root"] == str(session_dir / "workspace")
    assert payload["skills"] == [{"id": "review", "name": "Review", "scope": "project"}]
    assert payload["active_coding_skills"] == [
        {"id": "review", "name": "Review", "scope": "project", "instruction_chars": 24}
    ]
    assert payload["tool_policy"] == [
        {"id": "review", "allowed_tools": ["read_file_lines"], "permissions": {"write": False}}
    ]
    assert payload["roi"]["hidden_tool_count"] == 1
    assert payload["change_summary"] == {"changed_files": 0}

    events = [json.loads(line) for line in (session_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [event["seq"] for event in events] == [1, 2]
    assert [event["event_type"] for event in events] == ["session_started", "roi_reported"]
    assert all(event["thread_id"] == "thread-persist" for event in events)


@pytest.mark.parametrize("thread_id", [None, "", "../escape", "nested/path", ".hidden"])
def test_qiongqi_session_store_rejects_missing_or_unsafe_thread_ids(tmp_path, monkeypatch, thread_id):
    from kkoclaw.coding_core.context import CodingRuntimeContext
    from kkoclaw.coding_core.qiongqi import QiongqiSession
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    session = QiongqiSession(
        context=CodingRuntimeContext.from_runtime(project_root=None, thread_id=thread_id),
        skills=[],
    )

    with pytest.raises(ValueError, match="thread_id"):
        QiongqiSessionStore.from_home().persist_session(session)


def test_qiongqi_engine_can_persist_runtime_session(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-engine")
    snapshot = engine.persist_task_session(
        store=QiongqiSessionStore.from_home(),
        task_text="inspect code",
        roi={"stable_prompt_fingerprint": "abc"},
        change_summary={"changed_files": 0},
    )

    assert snapshot.thread_id == "thread-engine"
    payload = json.loads((home / ".oclaw-coding" / "thread-engine" / "session.json").read_text(encoding="utf-8"))
    assert payload["project_root"] == str(project)
    assert payload["active_coding_skills"] == []
    assert payload["roi"] == {"stable_prompt_fingerprint": "abc"}
    events = [
        json.loads(line)
        for line in (home / ".oclaw-coding" / "thread-engine" / "events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [event["event_type"] for event in events] == ["session_started"]


def test_qiongqi_session_gateway_service_and_router_expose_session_snapshot(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.coding_session_services import CodingSessionService
    from app.gateway.routers import coding_sessions
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-session")
    engine.persist_task_session(
        store=QiongqiSessionStore.from_home(),
        task_text="inspect code",
        roi={"stable_prompt_fingerprint": "abc"},
        change_summary={"changed_files": 2, "additions": 4, "deletions": 1},
    )

    service_response = CodingSessionService.get_session("thread-session")
    assert service_response["thread_id"] == "thread-session"
    assert service_response["session"]["project_root"] == str(project)
    assert service_response["session"]["scratch_root"].endswith(".oclaw-coding/thread-session/workspace")
    assert service_response["session"]["change_summary"]["changed_files"] == 2

    app = FastAPI()
    app.include_router(coding_sessions.router)

    with TestClient(app) as client:
        response = client.get("/api/coding/sessions/thread-session")

    assert response.status_code == 200
    assert response.json()["session"]["thread_id"] == "thread-session"

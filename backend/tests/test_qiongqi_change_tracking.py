from __future__ import annotations

import json


def test_qiongqi_change_tracker_records_file_changes_under_session_root(tmp_path, monkeypatch):
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())
    record = tracker.record_file_change(
        "thread-change",
        task_id="task-1",
        project_root="/repo",
        path="src/app.py",
        status="modified",
        additions=2,
        deletions=1,
        diff="diff --git a/src/app.py b/src/app.py\n+print('hi')\n",
    )

    assert record["thread_id"] == "thread-change"
    assert record["task_id"] == "task-1"
    assert record["project_root"] == "/repo"
    assert record["path"] == "src/app.py"
    assert record["status"] == "modified"
    assert record["additions"] == 2
    assert record["deletions"] == 1
    assert record["diff"].startswith("diff --git")

    changes_path = home / ".oclaw-coding" / "thread-change" / "changes.jsonl"
    assert changes_path.is_file()
    persisted = [json.loads(line) for line in changes_path.read_text(encoding="utf-8").splitlines()]
    assert persisted == [record]

    events = QiongqiSessionStore.from_home().list_events("thread-change")
    assert [event["event_type"] for event in events] == ["file_changed"]
    assert events[0]["payload"]["path"] == "src/app.py"


def test_qiongqi_change_tracker_records_diff_summary_event_and_session_summary(tmp_path, monkeypatch):
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())
    tracker.record_file_change(
        "thread-change",
        task_id="task-1",
        project_root="/repo",
        path="src/app.py",
        status="modified",
        additions=2,
        deletions=1,
        diff="diff --git a/src/app.py b/src/app.py\n+print('hi')\n",
    )
    tracker.record_file_change(
        "thread-change",
        task_id="task-1",
        project_root="/repo",
        path="src/new.py",
        status="added",
        additions=3,
        deletions=0,
        diff="diff --git a/src/new.py b/src/new.py\n+value = 1\n",
    )
    summary = tracker.record_diff_summary("thread-change", task_id="task-1")

    assert summary == {
        "thread_id": "thread-change",
        "task_id": "task-1",
        "changed_files": 2,
        "additions": 5,
        "deletions": 1,
        "paths": ["src/app.py", "src/new.py"],
    }

    session_payload = json.loads((home / ".oclaw-coding" / "thread-change" / "session.json").read_text(encoding="utf-8"))
    assert session_payload["change_summary"] == summary

    events = QiongqiSessionStore.from_home().list_events("thread-change", event_types=["diff_summarized"])
    assert len(events) == 1
    assert events[0]["payload"] == summary


def test_qiongqi_change_tracker_lists_changes_by_task_and_path(tmp_path, monkeypatch):
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())
    tracker.record_file_change(
        "thread-change",
        task_id="task-1",
        project_root="/repo",
        path="src/app.py",
        status="modified",
        additions=2,
        deletions=1,
        diff="diff app",
    )
    tracker.record_file_change(
        "thread-change",
        task_id="task-2",
        project_root="/repo",
        path="src/app.py",
        status="modified",
        additions=4,
        deletions=0,
        diff="diff task2",
    )

    task_changes = tracker.list_changes("thread-change", task_id="task-1")
    assert [item["task_id"] for item in task_changes] == ["task-1"]

    file_change = tracker.get_change("thread-change", task_id="task-2", path="src/app.py")
    assert file_change["diff"] == "diff task2"


def test_qiongqi_change_tracker_rejects_unsafe_paths(tmp_path, monkeypatch):
    import pytest

    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())

    with pytest.raises(ValueError, match="relative project path"):
        tracker.record_file_change(
            "thread-change",
            task_id="task-1",
            project_root="/repo",
            path="../escape.py",
            status="modified",
            additions=1,
            deletions=0,
            diff="diff",
        )


def test_coding_change_gateway_service_and_router_expose_task_changes(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.coding_change_services import CodingChangeService
    from app.gateway.routers import coding_changes
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())
    tracker.record_file_change(
        "thread-change",
        task_id="task-1",
        project_root="/repo",
        path="src/app.py",
        status="modified",
        additions=2,
        deletions=1,
        diff="diff app",
    )

    service_response = CodingChangeService.list_changes("thread-change", task_id="task-1")
    assert service_response["thread_id"] == "thread-change"
    assert service_response["changes"][0]["path"] == "src/app.py"

    app = FastAPI()
    app.include_router(coding_changes.router)

    with TestClient(app) as client:
        list_response = client.get("/api/coding/sessions/thread-change/changes", params={"task_id": "task-1"})
        detail_response = client.get(
            "/api/coding/sessions/thread-change/changes/src/app.py",
            params={"task_id": "task-1"},
        )

    assert list_response.status_code == 200
    assert list_response.json()["changes"][0]["diff"] == "diff app"
    assert detail_response.status_code == 200
    assert detail_response.json()["change"]["path"] == "src/app.py"


def test_qiongqi_change_tracker_records_tool_write_relative_to_project_root(tmp_path, monkeypatch):
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    target = project / "src" / "app.py"
    target.parent.mkdir(parents=True)
    target.write_text("print('old')\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))

    tracker = QiongqiChangeTracker(QiongqiSessionStore.from_home())
    record = tracker.record_tool_file_change(
        "thread-change",
        task_id="task-1",
        project_root=str(project),
        file_path=str(target),
        before="print('old')\n",
        after="print('new')\n",
    )

    assert record is not None
    assert record["path"] == "src/app.py"
    assert record["status"] == "modified"
    assert record["additions"] == 1
    assert record["deletions"] == 1
    assert "-print('old')" in record["diff"]
    assert "+print('new')" in record["diff"]

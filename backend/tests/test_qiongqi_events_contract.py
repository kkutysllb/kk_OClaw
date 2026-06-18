from __future__ import annotations

import json

import pytest


def test_qiongqi_event_contract_builds_records_and_langgraph_custom_payload():
    from kkoclaw.coding_core.events import (
        QIONGQI_EVENT_TYPES,
        build_qiongqi_event_record,
        qiongqi_event_to_langgraph_custom,
    )

    assert {
        "session_started",
        "task_started",
        "plan_updated",
        "tool_policy_decided",
        "file_changed",
        "diff_summarized",
        "roi_reported",
        "task_completed",
    }.issubset(set(QIONGQI_EVENT_TYPES))

    record = build_qiongqi_event_record(
        seq=7,
        thread_id="thread-events",
        event_type="plan_updated",
        payload={"items": [{"text": "Inspect code", "status": "in_progress"}]},
        created_at="2026-06-18T00:00:00+00:00",
    )

    assert record == {
        "schema_version": 1,
        "source": "qiongqi",
        "seq": 7,
        "thread_id": "thread-events",
        "event_type": "plan_updated",
        "payload": {"items": [{"text": "Inspect code", "status": "in_progress"}]},
        "created_at": "2026-06-18T00:00:00+00:00",
    }
    assert qiongqi_event_to_langgraph_custom(record) == {
        "type": "qiongqi_event",
        "event": record,
    }


def test_qiongqi_event_contract_rejects_unknown_event_types():
    from kkoclaw.coding_core.events import build_qiongqi_event_record

    with pytest.raises(ValueError, match="Unsupported Qiongqi event_type"):
        build_qiongqi_event_record(
            seq=1,
            thread_id="thread-events",
            event_type="unknown",
            payload={},
            created_at="2026-06-18T00:00:00+00:00",
        )


def test_qiongqi_session_store_lists_events_with_filters(tmp_path, monkeypatch):
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    store = QiongqiSessionStore.from_home()

    store.append_event("thread-events", "task_started", {"task_id": "task-1"})
    store.append_event("thread-events", "plan_updated", {"items": []})
    store.append_event("thread-events", "roi_reported", {"hidden_tool_count": 2})

    events = store.list_events("thread-events")
    assert [event["seq"] for event in events] == [1, 2, 3]
    assert [event["event_type"] for event in events] == ["task_started", "plan_updated", "roi_reported"]
    assert all(event["source"] == "qiongqi" for event in events)
    assert all(event["schema_version"] == 1 for event in events)

    filtered = store.list_events("thread-events", event_types=["roi_reported"])
    assert [event["event_type"] for event in filtered] == ["roi_reported"]

    limited = store.list_events("thread-events", after_seq=1, limit=1)
    assert [(event["seq"], event["event_type"]) for event in limited] == [(2, "plan_updated")]


def test_coding_events_gateway_service_reads_session_events(tmp_path, monkeypatch):
    from app.gateway.coding_event_services import CodingEventService
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    store = QiongqiSessionStore.from_home()
    store.append_event("thread-events", "task_started", {"task_id": "task-1"})

    response = CodingEventService.list_events("thread-events")

    assert response["thread_id"] == "thread-events"
    assert response["events"][0]["event_type"] == "task_started"
    assert response["events"][0]["payload"] == {"task_id": "task-1"}


def test_coding_events_router_exposes_session_events(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.routers import coding_events
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    store = QiongqiSessionStore.from_home()
    store.append_event("thread-events", "task_started", {"task_id": "task-1"})
    store.append_event("thread-events", "roi_reported", {"hidden_tool_count": 2})

    app = FastAPI()
    app.include_router(coding_events.router)

    with TestClient(app) as client:
        response = client.get(
            "/api/coding/sessions/thread-events/events",
            params={"event_type": ["roi_reported"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["thread_id"] == "thread-events"
    assert [event["event_type"] for event in body["events"]] == ["roi_reported"]
    assert body["events"][0]["payload"] == {"hidden_tool_count": 2}


def test_qiongqi_session_store_reads_legacy_phase11_events(tmp_path, monkeypatch):
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    events_path = home / ".oclaw-coding" / "thread-events" / "events.jsonl"
    events_path.parent.mkdir(parents=True)
    events_path.write_text(
        json.dumps(
            {
                "seq": 1,
                "thread_id": "thread-events",
                "event_type": "session_started",
                "payload": {},
                "created_at": "2026-06-18T00:00:00+00:00",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    events = QiongqiSessionStore.from_home().list_events("thread-events")

    assert events == [
        {
            "schema_version": 1,
            "source": "qiongqi",
            "seq": 1,
            "thread_id": "thread-events",
            "event_type": "session_started",
            "payload": {},
            "created_at": "2026-06-18T00:00:00+00:00",
        }
    ]

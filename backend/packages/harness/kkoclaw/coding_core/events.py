"""Qiongqi Coding event stream contract."""

from __future__ import annotations

from typing import Any, Literal

QiongqiEventType = Literal[
    "session_started",
    "task_started",
    "plan_updated",
    "tool_policy_decided",
    "file_changed",
    "diff_summarized",
    "roi_reported",
    "task_completed",
]

QIONGQI_EVENT_TYPES: tuple[str, ...] = (
    "session_started",
    "task_started",
    "plan_updated",
    "tool_policy_decided",
    "file_changed",
    "diff_summarized",
    "roi_reported",
    "task_completed",
)

QIONGQI_EVENT_SCHEMA_VERSION = 1


def build_qiongqi_event_record(
    *,
    seq: int,
    thread_id: str,
    event_type: str,
    payload: dict[str, Any] | None,
    created_at: str,
) -> dict[str, Any]:
    if event_type not in QIONGQI_EVENT_TYPES:
        raise ValueError(f"Unsupported Qiongqi event_type: {event_type}")
    return {
        "schema_version": QIONGQI_EVENT_SCHEMA_VERSION,
        "source": "qiongqi",
        "seq": seq,
        "thread_id": thread_id,
        "event_type": event_type,
        "payload": payload or {},
        "created_at": created_at,
    }


def normalize_qiongqi_event_record(raw: dict[str, Any]) -> dict[str, Any] | None:
    event_type = raw.get("event_type")
    if not isinstance(event_type, str) or event_type not in QIONGQI_EVENT_TYPES:
        return None
    seq = raw.get("seq")
    thread_id = raw.get("thread_id")
    created_at = raw.get("created_at")
    if not isinstance(seq, int) or not isinstance(thread_id, str) or not isinstance(created_at, str):
        return None
    payload = raw.get("payload")
    return build_qiongqi_event_record(
        seq=seq,
        thread_id=thread_id,
        event_type=event_type,
        payload=payload if isinstance(payload, dict) else {},
        created_at=created_at,
    )


def qiongqi_event_to_langgraph_custom(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "qiongqi_event",
        "event": event,
    }

"""Gateway service helpers for Qiongqi Coding events."""

from __future__ import annotations

from typing import Any

from kkoclaw.coding_core.session_store import QiongqiSessionStore


class CodingEventService:
    """Read-only gateway boundary for Coding Agent event streams."""

    @classmethod
    def list_events(
        cls,
        thread_id: str,
        *,
        event_types: list[str] | None = None,
        after_seq: int | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        events = QiongqiSessionStore.from_home().list_events(
            thread_id,
            event_types=event_types,
            after_seq=after_seq,
            limit=limit,
        )
        return {
            "thread_id": thread_id,
            "events": events,
        }

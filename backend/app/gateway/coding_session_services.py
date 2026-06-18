"""Gateway service helpers for Qiongqi Coding session snapshots."""

from __future__ import annotations

from typing import Any

from kkoclaw.coding_core.session_store import QiongqiSessionStore


class CodingSessionService:
    """Read-only gateway boundary for Qiongqi Coding session state."""

    @classmethod
    def get_session(cls, thread_id: str) -> dict[str, Any]:
        session = QiongqiSessionStore.from_home().get_session_payload(thread_id)
        return {
            "thread_id": thread_id,
            "session": session,
        }

"""Gateway service helpers for Qiongqi Coding task changes."""

from __future__ import annotations

from typing import Any

from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
from kkoclaw.coding_core.session_store import QiongqiSessionStore


class CodingChangeService:
    """Read-only gateway boundary for Qiongqi task-linked file changes."""

    @classmethod
    def list_changes(cls, thread_id: str, *, task_id: str | None = None) -> dict[str, Any]:
        changes = QiongqiChangeTracker(QiongqiSessionStore.from_home()).list_changes(thread_id, task_id=task_id)
        return {
            "thread_id": thread_id,
            "task_id": task_id,
            "changes": changes,
        }

    @classmethod
    def get_change(cls, thread_id: str, *, task_id: str | None = None, path: str) -> dict[str, Any] | None:
        change = QiongqiChangeTracker(QiongqiSessionStore.from_home()).get_change(thread_id, task_id=task_id, path=path)
        if change is None:
            return None
        return {
            "thread_id": thread_id,
            "task_id": task_id,
            "change": change,
        }

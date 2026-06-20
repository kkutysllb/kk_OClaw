"""Per-thread edit snapshot store for transactional rollback.

Every successful file mutation made by a Coding Agent tool (apply_diff,
multi_edit, str_replace, write_file, insert_at_line) pushes a snapshot
of the *before* content here. The agent can then call ``undo_last_edit``
to restore the most recent snapshot, or ``list_edit_snapshots`` to
inspect what is restorable.

Storage layout::

    {coding_home()}/{thread_id}/edit-snapshots.jsonl

Each line is a JSON record::

    {
      "seq": 1,
      "thread_id": "...",
      "file_path": "/abs/path/to/file",
      "before": "<full content before edit>",
      "tool": "apply_diff",
      "created_at": "2024-..."
    }

The store is append-only. Undo pops the latest record for the given
file (or the globally-latest record if no file is specified) and
restores the ``before`` content to disk.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from kkoclaw.coding_core.paths import coding_home

_MAX_SNAPSHOTS_PER_THREAD = 100  # cap to avoid unbounded growth


@dataclass(frozen=True)
class EditSnapshot:
    seq: int
    thread_id: str
    file_path: str
    before: str
    tool: str
    created_at: str


class EditSnapshotStore:
    """Append-only edit-snapshot store rooted at the Coding home."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or coding_home()

    @classmethod
    def from_home(cls) -> EditSnapshotStore:
        return cls(coding_home())

    def _snapshot_file(self, thread_id: str) -> Path:
        return self.root / thread_id / "edit-snapshots.jsonl"

    def record(
        self,
        *,
        thread_id: str,
        file_path: str,
        before: str | None,
        tool: str,
    ) -> EditSnapshot | None:
        """Append a snapshot. Returns the recorded snapshot or None on failure."""
        if not thread_id or not file_path:
            return None
        path = self._snapshot_file(thread_id)
        path.parent.mkdir(parents=True, exist_ok=True)

        records = self._read_all(thread_id)
        seq = (records[-1].seq + 1) if records else 1

        snapshot = EditSnapshot(
            seq=seq,
            thread_id=thread_id,
            file_path=str(file_path),
            before=before or "",
            tool=str(tool),
            created_at=_now_iso(),
        )

        payload = {
            "seq": snapshot.seq,
            "thread_id": snapshot.thread_id,
            "file_path": snapshot.file_path,
            "before": snapshot.before,
            "tool": snapshot.tool,
            "created_at": snapshot.created_at,
        }
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        return snapshot

    def list_latest(self, thread_id: str, *, limit: int = 20) -> list[EditSnapshot]:
        """Return the most recent ``limit`` snapshots (newest first)."""
        records = self._read_all(thread_id)
        return list(reversed(records[-limit:]))

    def latest_for_file(self, thread_id: str, file_path: str | None = None) -> EditSnapshot | None:
        """Return the latest snapshot, optionally filtered by file_path."""
        records = self._read_all(thread_id)
        if file_path is None:
            return records[-1] if records else None
        for snap in reversed(records):
            if snap.file_path == file_path:
                return snap
        return None

    def pop_and_restore(self, thread_id: str, file_path: str | None = None) -> dict[str, Any] | None:
        """Remove the latest snapshot and restore its ``before`` content to disk.

        Returns a dict describing the restore operation, or None if there
        was nothing to restore.
        """
        records = self._read_all(thread_id)
        if not records:
            return None

        # Find target index
        if file_path is None:
            target_idx = len(records) - 1
        else:
            target_idx = None
            for i in range(len(records) - 1, -1, -1):
                if records[i].file_path == file_path:
                    target_idx = i
                    break
            if target_idx is None:
                return None

        snapshot = records[target_idx]

        # Restore content
        try:
            p = Path(snapshot.file_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(snapshot.before, encoding="utf-8")
        except Exception as exc:
            return {
                "status": "error",
                "message": f"Failed to restore {snapshot.file_path}: {exc}",
                "snapshot": _snapshot_to_dict(snapshot),
            }

        # Rewrite the file without the popped record
        remaining = records[:target_idx] + records[target_idx + 1:]
        self._write_all(thread_id, remaining)

        return {
            "status": "ok",
            "message": f"Restored {snapshot.file_path} to its state before the {snapshot.tool} edit (seq={snapshot.seq}).",
            "snapshot": _snapshot_to_dict(snapshot),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _read_all(self, thread_id: str) -> list[EditSnapshot]:
        path = self._snapshot_file(thread_id)
        if not path.is_file():
            return []
        records: list[EditSnapshot] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            snap = _dict_to_snapshot(raw)
            if snap is not None:
                records.append(snap)
        # Enforce cap: keep only the most recent N
        if len(records) > _MAX_SNAPSHOTS_PER_THREAD:
            records = records[-_MAX_SNAPSHOTS_PER_THREAD:]
        return records

    def _write_all(self, thread_id: str, records: list[EditSnapshot]) -> None:
        path = self._snapshot_file(thread_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            for snap in records:
                payload = {
                    "seq": snap.seq,
                    "thread_id": snap.thread_id,
                    "file_path": snap.file_path,
                    "before": snap.before,
                    "tool": snap.tool,
                    "created_at": snap.created_at,
                }
                fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------
# Convenience: thread-aware record helper used by edit tools
# ----------------------------------------------------------------------


def record_edit_snapshot(
    runtime: Any,
    *,
    file_path: str,
    before: str | None,
    tool: str,
) -> None:
    """Best-effort snapshot record invoked by coding edit tools.

    Pulls thread_id from the runtime context/config, matching the same
    extraction logic as ``record_runtime_file_change``.
    """
    context = getattr(runtime, "context", None) or {}
    config = getattr(runtime, "config", None) or {}
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    if not isinstance(configurable, dict):
        configurable = {}
    thread_id = context.get("thread_id") or configurable.get("thread_id")
    if not isinstance(thread_id, str) or not thread_id:
        return
    try:
        EditSnapshotStore.from_home().record(
            thread_id=thread_id,
            file_path=file_path,
            before=before,
            tool=tool,
        )
    except Exception:
        # Snapshots are best-effort; never fail the edit because of them.
        pass


# ----------------------------------------------------------------------
# (De)serialisation
# ----------------------------------------------------------------------


def _snapshot_to_dict(snap: EditSnapshot) -> dict[str, Any]:
    return {
        "seq": snap.seq,
        "file_path": snap.file_path,
        "tool": snap.tool,
        "created_at": snap.created_at,
        "before_length": len(snap.before),
    }


def _dict_to_snapshot(raw: dict[str, Any]) -> EditSnapshot | None:
    try:
        return EditSnapshot(
            seq=int(raw.get("seq") or 0),
            thread_id=str(raw.get("thread_id") or ""),
            file_path=str(raw.get("file_path") or ""),
            before=str(raw.get("before") or ""),
            tool=str(raw.get("tool") or ""),
            created_at=str(raw.get("created_at") or ""),
        )
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


__all__ = [
    "EditSnapshot",
    "EditSnapshotStore",
    "record_edit_snapshot",
]

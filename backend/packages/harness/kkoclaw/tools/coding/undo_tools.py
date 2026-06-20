"""Undo and snapshot-inspection tools for the Coding Agent.

Provides:
- ``undo_last_edit``: Restore the most recent file edit (transactional rollback)
- ``list_edit_snapshots``: Show recent restorable edits

These complement the change-tracking in change_tracking.py: the change
tracker records *what* changed for audit/diff purposes, while the
snapshot store keeps the full *before* content so edits can be reversed
without a git round-trip.
"""

from __future__ import annotations

import json

from langchain.tools import tool

from kkoclaw.coding_core.edit_snapshots import EditSnapshotStore
from kkoclaw.sandbox.tools import (
    _sanitize_error,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
)
from kkoclaw.tools.types import Runtime


def _resolve_thread_id(runtime: Runtime) -> str | None:
    thread_data = get_thread_data(runtime)
    if thread_data:
        tid = thread_data.get("thread_id")
        if isinstance(tid, str) and tid:
            return tid
    context = getattr(runtime, "context", None) or {}
    return context.get("thread_id") if isinstance(context, dict) else None


@tool("undo_last_edit", parse_docstring=True)
def undo_last_edit_tool(
    runtime: Runtime,
    file_path: str | None = None,
) -> str:
    """Undo the most recent file edit and restore the previous content.

    Every successful edit (apply_diff, multi_edit, str_replace, write_file,
    insert_at_line) records a snapshot of the file's *before* content.
    This tool pops the latest snapshot and writes it back to disk,
    effectively rolling back one edit.

    Args:
        file_path: Optional path filter. If provided, only the latest edit
            to this exact file is undone. If None (default), the globally
            latest edit across all files is undone.

    Returns:
        A JSON result describing what was restored, or an error if there
        was nothing to undo.
    """
    try:
        # Ensure sandbox exists so the runtime is initialized
        ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)

        thread_id = _resolve_thread_id(runtime)
        if not thread_id:
            return "Error: Cannot undo — no active thread context."

        store = EditSnapshotStore.from_home()
        result = store.pop_and_restore(thread_id, file_path=file_path)
        if result is None:
            return json.dumps(
                {
                    "status": "noop",
                    "message": "No edit snapshots to undo for this thread.",
                },
                indent=2,
                ensure_ascii=False,
            )
        return json.dumps(result, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"Error: Failed to undo edit: {_sanitize_error(e, runtime)}"


@tool("list_edit_snapshots", parse_docstring=True)
def list_edit_snapshots_tool(
    runtime: Runtime,
    limit: int = 10,
) -> str:
    """List recent file edits that can be undone.

    Returns the most recent edit snapshots (newest first), each with the
    file path, the tool that made the edit, and the timestamp. Use this
    to decide which edit to undo with ``undo_last_edit``.

    Args:
        limit: Maximum number of snapshots to return. Default 10.
    """
    try:
        ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)

        thread_id = _resolve_thread_id(runtime)
        if not thread_id:
            return "Error: No active thread context."

        store = EditSnapshotStore.from_home()
        snapshots = store.list_latest(thread_id, limit=max(1, min(limit, 50)))
        if not snapshots:
            return json.dumps(
                {
                    "status": "empty",
                    "message": "No edit snapshots recorded for this thread yet.",
                },
                indent=2,
                ensure_ascii=False,
            )

        items = [
            {
                "seq": s.seq,
                "file_path": s.file_path,
                "tool": s.tool,
                "created_at": s.created_at,
            }
            for s in snapshots
        ]
        return json.dumps(
            {
                "status": "ok",
                "count": len(items),
                "snapshots": items,
            },
            indent=2,
            ensure_ascii=False,
        )
    except Exception as e:
        return f"Error: Failed to list edit snapshots: {_sanitize_error(e, runtime)}"


__all__ = ["undo_last_edit_tool", "list_edit_snapshots_tool"]

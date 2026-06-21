"""Qiongqi per-task change tracking.

This module records Coding Agent file changes under the isolated Qiongqi
session directory. It does not write tracking metadata into the user's project
root.
"""

from __future__ import annotations

import difflib
import json
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from kkoclaw.coding_core.session_store import QiongqiSessionStore


class QiongqiChangeTracker:
    def __init__(self, store: QiongqiSessionStore | None = None):
        self.store = store or QiongqiSessionStore.from_home()

    def record_file_change(
        self,
        thread_id: str,
        *,
        task_id: str,
        project_root: str | None,
        path: str,
        status: str,
        additions: int = 0,
        deletions: int = 0,
        diff: str = "",
    ) -> dict[str, Any]:
        safe_path = _validate_project_relative_path(path)
        session_dir = self.store.session_dir(thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "thread_id": thread_id,
            "task_id": task_id,
            "project_root": project_root,
            "path": safe_path,
            "status": status,
            "additions": max(0, int(additions)),
            "deletions": max(0, int(deletions)),
            "diff": diff,
            "created_at": _now_iso(),
        }
        with (session_dir / "changes.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        self.store.append_event(
            thread_id,
            "file_changed",
            {
                "task_id": task_id,
                "project_root": project_root,
                "path": safe_path,
                "status": status,
                "additions": record["additions"],
                "deletions": record["deletions"],
            },
        )
        return record

    def record_tool_file_change(
        self,
        thread_id: str,
        *,
        task_id: str | None = None,
        project_root: str | None,
        file_path: str,
        before: str | None,
        after: str | None,
    ) -> dict[str, Any] | None:
        """Record a successful project file mutation made by a Coding tool."""
        if not thread_id or not project_root:
            return None
        try:
            relative_path = _project_relative_path(project_root, file_path)
        except ValueError:
            return None
        before_text = before or ""
        after_text = after or ""
        if before_text == after_text:
            return None
        status = "added" if before in (None, "") and after_text else "modified"
        diff = _unified_diff(relative_path, before_text, after_text)
        additions, deletions = _count_diff_changes(diff)
        return self.record_file_change(
            thread_id,
            task_id=task_id or "unassigned",
            project_root=project_root,
            path=relative_path,
            status=status,
            additions=additions,
            deletions=deletions,
            diff=diff,
        )

    def record_diff_summary(self, thread_id: str, *, task_id: str | None = None) -> dict[str, Any]:
        changes = self.list_changes(thread_id, task_id=task_id)
        summary = {
            "thread_id": thread_id,
            "task_id": task_id,
            "changed_files": len(changes),
            "additions": sum(int(change.get("additions", 0)) for change in changes),
            "deletions": sum(int(change.get("deletions", 0)) for change in changes),
            "paths": sorted({str(change["path"]) for change in changes}),
        }
        self.store.update_change_summary(thread_id, summary)
        self.store.append_event(thread_id, "diff_summarized", summary)
        return summary

    def list_changes(self, thread_id: str, *, task_id: str | None = None) -> list[dict[str, Any]]:
        changes_path = self.store.session_dir(thread_id) / "changes.jsonl"
        if not changes_path.is_file():
            return []
        changes: list[dict[str, Any]] = []
        for line in changes_path.read_text(encoding="utf-8").splitlines():
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            if task_id is not None and raw.get("task_id") != task_id:
                continue
            changes.append(raw)
        changes.sort(key=lambda item: (str(item.get("path", "")), str(item.get("created_at", ""))))
        return changes

    def get_change(self, thread_id: str, *, task_id: str | None, path: str) -> dict[str, Any] | None:
        safe_path = _validate_project_relative_path(path)
        for change in self.list_changes(thread_id, task_id=task_id):
            if change.get("path") == safe_path:
                return change
        return None


def _validate_project_relative_path(path: str) -> str:
    if not isinstance(path, str) or not path.strip():
        raise ValueError("path must be a relative project path")
    normalized = path.replace("\\", "/").strip()
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError("path must be a relative project path")
    return str(pure)


def _project_relative_path(project_root: str, file_path: str) -> str:
    root = Path(project_root).resolve()
    target = Path(file_path).resolve()
    try:
        return _validate_project_relative_path(target.relative_to(root).as_posix())
    except ValueError as exc:
        raise ValueError("file_path must be inside project_root") from exc


def _unified_diff(path: str, before: str, after: str) -> str:
    lines = list(
        difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
        )
    )
    return "\n".join(lines) + ("\n" if lines else "")


def _count_diff_changes(diff: str) -> tuple[int, int]:
    additions = 0
    deletions = 0
    for line in diff.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            additions += 1
        elif line.startswith("-"):
            deletions += 1
    return additions, deletions


def record_runtime_file_change(
    runtime: Any,
    *,
    file_path: str,
    before: str | None,
    after: str | None,
) -> dict[str, Any] | None:
    """Best-effort Qiongqi change capture for Coding Agent tool mutations."""
    context = getattr(runtime, "context", None) or {}
    config = getattr(runtime, "config", None) or {}
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    if not isinstance(configurable, dict):
        configurable = {}
    thread_id = context.get("thread_id") or configurable.get("thread_id")
    project_root = context.get("project_root") or configurable.get("project_root")
    task_id = context.get("task_id") or context.get("run_id") or configurable.get("task_id") or configurable.get("run_id")
    if not isinstance(thread_id, str) or not isinstance(project_root, str):
        return None
    if task_id is not None and not isinstance(task_id, str):
        task_id = str(task_id)
    try:
        return QiongqiChangeTracker().record_tool_file_change(
            thread_id,
            task_id=task_id,
            project_root=project_root,
            file_path=file_path,
            before=before,
            after=after,
        )
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ---------------------------------------------------------------------------
# Graph-state helpers: build FileDiff entries so edit tools can return
# ``Command(update={"diff": [...]})`` and the worker's ``_StateDiffTracker``
# can detect incremental changes and emit ``file_changed`` SSE events.
# ---------------------------------------------------------------------------


def build_file_diff_entry(
    runtime: Any,
    *,
    file_path: str,
    before: str | None,
    after: str | None,
) -> dict[str, Any] | None:
    """Build a single ``FileDiff`` dict for ``Command(update={"diff": ...})``.

    Returns ``None`` when there is no change (``before == after``) or when
    the project context is unavailable. In the latter case the caller should
    fall back to a plain ``str`` return.

    The ``file_path`` in the returned dict is **project-relative** so that
    the frontend can reconstruct the absolute path from its own
    ``project_root`` context.
    """
    context = getattr(runtime, "context", None) or {}
    config = getattr(runtime, "config", None) or {}
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    if not isinstance(configurable, dict):
        configurable = {}
    project_root = context.get("project_root") or configurable.get("project_root")

    before_text = before or ""
    after_text = after or ""
    if before_text == after_text:
        return None

    if before in (None, "") and after_text:
        status = "added"
    elif after_text == "":
        status = "deleted"
    else:
        status = "modified"

    rel_path = file_path
    if project_root:
        try:
            rel_path = _project_relative_path(project_root, file_path)
        except ValueError:
            rel_path = file_path

    diff_text = _unified_diff(rel_path, before_text, after_text)
    additions, deletions = _count_diff_changes(diff_text)

    return {
        "file_path": rel_path,
        "status": status,
        "additions": additions,
        "deletions": deletions,
    }


def commit_edit_to_state(
    runtime: Any,
    *,
    result_message: str,
    file_path: str,
    before: str | None,
    after: str | None,
) -> Any:
    """Return a ``Command(update={"diff": [...], "messages": [...]})`` or plain ``str``.

    Designed to be called by edit tools **after** ``write_file`` and
    ``record_runtime_file_change``.  When a diff entry can be built, the
    returned ``Command`` writes it to the ``diff`` state field (merged via
    ``merge_diffs`` reducer) and wraps ``result_message`` as a
    ``ToolMessage``.  When no diff can be built (no project context), the
    plain ``str`` is returned so LangGraph wraps it automatically.
    """
    diff_entry = build_file_diff_entry(
        runtime,
        file_path=file_path,
        before=before,
        after=after,
    )
    if diff_entry is None:
        return result_message

    tool_call_id = getattr(runtime, "tool_call_id", None)
    if not tool_call_id:
        return result_message

    from langchain_core.messages import ToolMessage
    from langgraph.types import Command

    return Command(
        update={
            "diff": [diff_entry],
            "messages": [
                ToolMessage(
                    content=result_message,
                    tool_call_id=tool_call_id,
                ),
            ],
        },
    )

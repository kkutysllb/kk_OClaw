"""Persistent Qiongqi Coding session state.

This store is intentionally separate from OClaw's global thread memory. It
keeps Coding task/session metadata under the Coding Agent home
(``~/.oclaw-coding/{thread_id}`` on web, ``~/.oclaw-coding-desktop/{thread_id}``
on desktop) so the Coding Agent can recover its own runtime state without
polluting project roots or non-coding task memory.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from kkoclaw.coding_core.events import build_qiongqi_event_record, normalize_qiongqi_event_record
from kkoclaw.coding_core.paths import coding_home
from kkoclaw.coding_core.qiongqi import QiongqiRoiReport, QiongqiSession
from kkoclaw.coding_core.skills import ActiveCodingSkill, CodingSkill
from kkoclaw.coding_core.stage_state import ProjectStageStore, StageSuggestion

_SAFE_THREAD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class QiongqiTaskSessionSnapshot:
    thread_id: str
    session_dir: Path
    project_root: str | None
    scratch_root: str | None
    payload: dict[str, Any]


@dataclass(frozen=True)
class QiongqiEngineEvent:
    seq: int
    thread_id: str
    event_type: str
    payload: dict[str, Any]
    created_at: str


@dataclass(frozen=True)
class QiongqiSessionStore:
    root: Path

    @classmethod
    def from_home(cls) -> QiongqiSessionStore:
        return cls(coding_home())

    def persist_session(
        self,
        session: QiongqiSession,
        *,
        active_skills: list[ActiveCodingSkill] | None = None,
        tool_policy: list[dict] | None = None,
        roi: dict[str, Any] | QiongqiRoiReport | None = None,
        change_summary: dict[str, Any] | None = None,
    ) -> QiongqiTaskSessionSnapshot:
        thread_id = _validate_thread_id(session.context.thread_id)
        session_dir = self.session_dir(thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        if session.context.scratch_root:
            Path(session.context.scratch_root).mkdir(parents=True, exist_ok=True)
        previous_payload = _read_session_payload(session_dir / "session.json", thread_id)

        payload: dict[str, Any] = {
            "thread_id": thread_id,
            "project_root": session.context.project_root,
            "scratch_root": session.context.scratch_root,
            "skills": [_skill_summary(skill) for skill in session.skills],
            "active_coding_skills": [_active_skill_summary(item) for item in active_skills or []],
            "tool_policy": tool_policy or [],
            "roi": _roi_payload(roi) if roi is not None else previous_payload.get("roi", {}),
            "change_summary": change_summary if change_summary is not None else previous_payload.get("change_summary", {}),
            "updated_at": _now_iso(),
        }
        _write_json(session_dir / "session.json", payload)
        return QiongqiTaskSessionSnapshot(
            thread_id=thread_id,
            session_dir=session_dir,
            project_root=session.context.project_root,
            scratch_root=session.context.scratch_root,
            payload=payload,
        )

    def append_event(self, thread_id: str | None, event_type: str, payload: dict[str, Any] | None = None) -> QiongqiEngineEvent:
        safe_thread_id = _validate_thread_id(thread_id)
        session_dir = self.session_dir(safe_thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        events_path = session_dir / "events.jsonl"
        event = QiongqiEngineEvent(
            seq=_next_event_seq(events_path),
            thread_id=safe_thread_id,
            event_type=event_type,
            payload=payload or {},
            created_at=_now_iso(),
        )
        record = build_qiongqi_event_record(
            seq=event.seq,
            thread_id=event.thread_id,
            event_type=event.event_type,
            payload=event.payload,
            created_at=event.created_at,
        )
        with events_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        return event

    def list_events(
        self,
        thread_id: str | None,
        *,
        event_types: list[str] | None = None,
        after_seq: int | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        safe_thread_id = _validate_thread_id(thread_id)
        events_path = self.session_dir(safe_thread_id) / "events.jsonl"
        if not events_path.is_file():
            return []

        allowed_types = set(event_types or [])
        events: list[dict[str, Any]] = []
        for line in events_path.read_text(encoding="utf-8").splitlines():
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            event = normalize_qiongqi_event_record(raw)
            if event is None:
                continue
            if allowed_types and event["event_type"] not in allowed_types:
                continue
            if after_seq is not None and event["seq"] <= after_seq:
                continue
            events.append(event)

        events.sort(key=lambda item: item["seq"])
        if limit is not None:
            return events[: max(0, limit)]
        return events

    def update_change_summary(self, thread_id: str | None, change_summary: dict[str, Any]) -> dict[str, Any]:
        session_dir = self.session_dir(thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        session_path = session_dir / "session.json"
        payload = _read_session_payload(session_path, thread_id)
        payload["change_summary"] = change_summary
        payload["updated_at"] = _now_iso()
        _write_json(session_path, payload)
        return payload

    def update_roi_summary(self, thread_id: str | None, roi: dict[str, Any]) -> dict[str, Any]:
        session_dir = self.session_dir(thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        session_path = session_dir / "session.json"
        payload = _read_session_payload(session_path, thread_id)
        payload["roi"] = roi
        payload["updated_at"] = _now_iso()
        _write_json(session_path, payload)
        return payload

    def get_session_payload(self, thread_id: str | None) -> dict[str, Any]:
        safe_thread_id = _validate_thread_id(thread_id)
        session_path = self.session_dir(safe_thread_id) / "session.json"
        payload = _read_session_payload(session_path, safe_thread_id)
        payload.setdefault("thread_id", safe_thread_id)
        payload.setdefault("project_root", None)
        payload.setdefault("scratch_root", None)
        payload.setdefault("skills", [])
        payload.setdefault("active_coding_skills", [])
        payload.setdefault("tool_policy", [])
        payload.setdefault("roi", {})
        payload.setdefault("change_summary", {})
        payload.setdefault("updated_at", None)

        # Inject project-level delivery stage state so the frontend's existing
        # useCodingSession(threadId) hook automatically carries the current
        # stage and any pending agent suggestion — no extra query needed.
        project_root = payload.get("project_root")
        if isinstance(project_root, str) and project_root:
            try:
                stage_state = ProjectStageStore.from_home().get_state(project_root)
                payload["delivery_stage"] = stage_state.current_stage
                payload["delivery_stage_suggestion"] = _suggestion_payload(
                    stage_state.pending_suggestion
                )
                payload["delivery_stage_history"] = [
                    _history_payload(entry) for entry in stage_state.stage_history
                ]
            except Exception:  # noqa: BLE001 — never break session reads
                payload.setdefault("delivery_stage", None)
                payload.setdefault("delivery_stage_suggestion", None)
                payload.setdefault("delivery_stage_history", [])
        else:
            payload.setdefault("delivery_stage", None)
            payload.setdefault("delivery_stage_suggestion", None)
            payload.setdefault("delivery_stage_history", [])
        return payload

    def session_dir(self, thread_id: str | None) -> Path:
        return self.root / _validate_thread_id(thread_id)


def _validate_thread_id(thread_id: str | None) -> str:
    if not isinstance(thread_id, str) or not _SAFE_THREAD_ID.match(thread_id):
        raise ValueError("Qiongqi Coding session requires a safe thread_id")
    return thread_id


def _skill_summary(skill: CodingSkill) -> dict[str, str]:
    return {"id": skill.id, "name": skill.name, "scope": skill.scope}


def _active_skill_summary(active_skill: ActiveCodingSkill) -> dict[str, Any]:
    skill = active_skill.skill
    return {
        "id": skill.id,
        "name": skill.name,
        "scope": skill.scope,
        "instruction_chars": len(active_skill.instructions),
    }


def _roi_payload(roi: dict[str, Any] | QiongqiRoiReport | None) -> dict[str, Any]:
    if roi is None:
        return {}
    if isinstance(roi, QiongqiRoiReport):
        return {
            "stable_prompt_fingerprint": roi.stable_prompt_fingerprint,
            "tool_catalog_fingerprint": roi.tool_catalog_fingerprint,
            "immutable_prefix_fingerprint": roi.immutable_prefix_fingerprint,
            "full_tool_count": roi.full_tool_count,
            "visible_tool_count": roi.visible_tool_count,
            "hidden_tool_count": roi.hidden_tool_count,
        }
    return dict(roi)


def _next_event_seq(events_path: Path) -> int:
    if not events_path.is_file():
        return 1
    last_seq = 0
    for line in events_path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        raw_seq = event.get("seq")
        if isinstance(raw_seq, int) and raw_seq > last_seq:
            last_seq = raw_seq
    return last_seq + 1


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _read_session_payload(path: Path, thread_id: str | None) -> dict[str, Any]:
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            return payload
    return {"thread_id": _validate_thread_id(thread_id)}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _suggestion_payload(suggestion: StageSuggestion | None) -> dict[str, Any] | None:
    if suggestion is None:
        return None
    return {
        "stage_id": suggestion.stage_id,
        "reason": suggestion.reason,
        "suggested_by_thread_id": suggestion.suggested_by_thread_id,
        "timestamp": suggestion.timestamp,
    }


def _history_payload(entry: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "from_stage_id": entry.from_stage_id,
        "to_stage_id": entry.to_stage_id,
        "reason": entry.reason,
        "source": entry.source,
        "timestamp": entry.timestamp,
    }
    # G1/G2 traceability fields — optional, may be absent on older entries.
    thread_id = getattr(entry, "thread_id", None)
    if thread_id:
        payload["thread_id"] = thread_id
    run_outcome = getattr(entry, "run_outcome", None)
    if run_outcome:
        payload["run_outcome"] = run_outcome
    return payload

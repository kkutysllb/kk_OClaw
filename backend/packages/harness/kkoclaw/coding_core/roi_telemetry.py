"""Qiongqi ROI telemetry persistence."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from kkoclaw.coding_core.qiongqi import QiongqiRoiReport
from kkoclaw.coding_core.session_store import QiongqiSessionStore

CHARS_PER_TOKEN_ESTIMATE = 4
TOOL_SCHEMA_TOKEN_ESTIMATE = 250


class QiongqiRoiTelemetryStore:
    def __init__(self, store: QiongqiSessionStore | None = None):
        self.store = store or QiongqiSessionStore.from_home()

    @classmethod
    def from_home(cls) -> "QiongqiRoiTelemetryStore":
        return cls(QiongqiSessionStore.from_home())

    def record_report(
        self,
        thread_id: str,
        *,
        report: QiongqiRoiReport | dict[str, Any],
        provider_usage: dict[str, Any] | None = None,
        tool_output: dict[str, Any] | None = None,
        token_economy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        session_dir = self.store.session_dir(thread_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        telemetry_path = session_dir / "roi_telemetry.jsonl"
        payload = _report_payload(report)
        record = {
            "seq": _next_seq(telemetry_path),
            "thread_id": thread_id,
            **payload,
            "provider_usage": _clean_counter_map(provider_usage),
            "tool_output": _clean_counter_map(tool_output),
            "token_economy": _clean_counter_map(token_economy),
            "created_at": _now_iso(),
        }
        with telemetry_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        self.store.update_roi_summary(thread_id, record)
        self.store.append_event(
            thread_id,
            "roi_reported",
            {
                "stable_prompt_fingerprint": record["stable_prompt_fingerprint"],
                "tool_catalog_fingerprint": record["tool_catalog_fingerprint"],
                "immutable_prefix_fingerprint": record["immutable_prefix_fingerprint"],
                "full_tool_count": record["full_tool_count"],
                "visible_tool_count": record["visible_tool_count"],
                "hidden_tool_count": record["hidden_tool_count"],
                "provider_usage": record["provider_usage"],
                "tool_output": record["tool_output"],
                "token_economy": record["token_economy"],
            },
        )
        return record

    def list_reports(self, thread_id: str) -> list[dict[str, Any]]:
        telemetry_path = self.store.session_dir(thread_id) / "roi_telemetry.jsonl"
        if not telemetry_path.is_file():
            return []
        records: list[dict[str, Any]] = []
        for line in telemetry_path.read_text(encoding="utf-8").splitlines():
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(raw, dict):
                records.append(raw)
        records.sort(key=lambda item: int(item.get("seq", 0)))
        return records

    def latest_report(self, thread_id: str) -> dict[str, Any] | None:
        records = self.list_reports(thread_id)
        return records[-1] if records else None

    def summary(self, thread_id: str) -> dict[str, Any]:
        records = self.list_reports(thread_id)
        provider_usage = _sum_counter_maps(record.get("provider_usage") for record in records)
        tool_output = _sum_counter_maps(record.get("tool_output") for record in records)
        token_economy = _sum_counter_maps(record.get("token_economy") for record in records)
        return {
            "thread_id": thread_id,
            "report_count": len(records),
            "latest": records[-1] if records else None,
            "provider_usage": provider_usage,
            "tool_output": tool_output,
            "token_economy": token_economy,
            "derived": _derive_roi_metrics(
                records,
                provider_usage=provider_usage,
                tool_output=tool_output,
                token_economy=token_economy,
            ),
        }


def _report_payload(report: QiongqiRoiReport | dict[str, Any]) -> dict[str, Any]:
    if isinstance(report, QiongqiRoiReport):
        return {
            "stable_prompt_fingerprint": report.stable_prompt_fingerprint,
            "tool_catalog_fingerprint": report.tool_catalog_fingerprint,
            "immutable_prefix_fingerprint": report.immutable_prefix_fingerprint,
            "full_tool_count": report.full_tool_count,
            "visible_tool_count": report.visible_tool_count,
            "hidden_tool_count": report.hidden_tool_count,
        }
    return {
        "stable_prompt_fingerprint": str(report.get("stable_prompt_fingerprint", "")),
        "tool_catalog_fingerprint": str(report.get("tool_catalog_fingerprint", "")),
        "immutable_prefix_fingerprint": str(report.get("immutable_prefix_fingerprint", "")),
        "full_tool_count": int(report.get("full_tool_count", 0) or 0),
        "visible_tool_count": int(report.get("visible_tool_count", 0) or 0),
        "hidden_tool_count": int(report.get("hidden_tool_count", 0) or 0),
    }


def _clean_counter_map(values: dict[str, Any] | None) -> dict[str, int]:
    if not values:
        return {}
    cleaned: dict[str, int] = {}
    for key, value in values.items():
        if isinstance(key, str) and isinstance(value, int | float):
            cleaned[key] = int(value)
    return cleaned


def _sum_counter_maps(values: Any) -> dict[str, int]:
    total: dict[str, int] = {}
    for item in values:
        if not isinstance(item, dict):
            continue
        for key, value in item.items():
            if isinstance(key, str) and isinstance(value, int | float):
                total[key] = total.get(key, 0) + int(value)
    return total


def _derive_roi_metrics(
    records: list[dict[str, Any]],
    *,
    provider_usage: dict[str, int],
    tool_output: dict[str, int],
    token_economy: dict[str, int],
) -> dict[str, int | float]:
    actual_tokens = int(provider_usage.get("total_tokens", 0) or 0)
    full_tool_count = sum(_positive_int(record.get("full_tool_count")) for record in records)
    hidden_tool_count = sum(_positive_int(record.get("hidden_tool_count")) for record in records)
    tool_catalog_saved_tokens = hidden_tool_count * TOOL_SCHEMA_TOKEN_ESTIMATE
    tool_output_saved_tokens = _chars_to_tokens(tool_output.get("externalized_chars", 0))
    token_economy_saved_tokens = _chars_to_tokens(token_economy.get("compressed_chars_saved", 0))
    estimated_saved_tokens = (
        tool_catalog_saved_tokens
        + tool_output_saved_tokens
        + token_economy_saved_tokens
    )
    estimated_baseline_tokens = actual_tokens + estimated_saved_tokens
    saving_ratio = (
        estimated_saved_tokens / estimated_baseline_tokens
        if estimated_baseline_tokens > 0
        else 0.0
    )
    tool_hidden_ratio = (
        hidden_tool_count / full_tool_count if full_tool_count > 0 else 0.0
    )
    return {
        "actual_tokens": actual_tokens,
        "estimated_saved_tokens": estimated_saved_tokens,
        "estimated_baseline_tokens": estimated_baseline_tokens,
        "saving_ratio": saving_ratio,
        "tool_hidden_ratio": tool_hidden_ratio,
        "tool_catalog_saved_tokens": tool_catalog_saved_tokens,
        "tool_output_saved_tokens": tool_output_saved_tokens,
        "token_economy_saved_tokens": token_economy_saved_tokens,
    }


def _positive_int(value: Any) -> int:
    return int(value) if isinstance(value, int | float) and value > 0 else 0


def _chars_to_tokens(value: Any) -> int:
    chars = _positive_int(value)
    return chars // CHARS_PER_TOKEN_ESTIMATE


def _next_seq(path: Path) -> int:
    if not path.is_file():
        return 1
    last_seq = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        raw_seq = record.get("seq") if isinstance(record, dict) else None
        if isinstance(raw_seq, int) and raw_seq > last_seq:
            last_seq = raw_seq
    return last_seq + 1


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()

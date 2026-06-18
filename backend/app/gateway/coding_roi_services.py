"""Gateway service helpers for Qiongqi ROI telemetry."""

from __future__ import annotations

from typing import Any

from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore


class CodingRoiService:
    """Read-only gateway boundary for Qiongqi ROI telemetry."""

    @classmethod
    def list_reports(cls, thread_id: str) -> dict[str, Any]:
        reports = QiongqiRoiTelemetryStore.from_home().list_reports(thread_id)
        return {
            "thread_id": thread_id,
            "reports": reports,
        }

    @classmethod
    def get_summary(cls, thread_id: str) -> dict[str, Any]:
        summary = QiongqiRoiTelemetryStore.from_home().summary(thread_id)
        return {
            "thread_id": thread_id,
            "summary": summary,
        }

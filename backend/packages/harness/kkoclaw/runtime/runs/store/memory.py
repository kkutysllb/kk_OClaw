"""In-memory RunStore. Used when database.backend=memory (default) and in tests.

Equivalent to the original RunManager._runs dict behavior.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from kkoclaw.runtime.runs.store.base import RunStore


class MemoryRunStore(RunStore):
    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}

    async def put(
        self,
        run_id,
        *,
        thread_id,
        assistant_id=None,
        user_id=None,
        model_name=None,
        status="pending",
        multitask_strategy="reject",
        metadata=None,
        kwargs=None,
        error=None,
        created_at=None,
    ):
        now = datetime.now(UTC).isoformat()
        self._runs[run_id] = {
            "run_id": run_id,
            "thread_id": thread_id,
            "assistant_id": assistant_id,
            "user_id": user_id,
            "model_name": model_name,
            "status": status,
            "multitask_strategy": multitask_strategy,
            "metadata": metadata or {},
            "kwargs": kwargs or {},
            "error": error,
            "created_at": created_at or now,
            "updated_at": now,
        }

    async def get(self, run_id):
        return self._runs.get(run_id)

    async def list_by_thread(self, thread_id, *, user_id=None, limit=100):
        results = [r for r in self._runs.values() if r["thread_id"] == thread_id and (user_id is None or r.get("user_id") == user_id)]
        results.sort(key=lambda r: r["created_at"], reverse=True)
        return results[:limit]

    async def update_status(self, run_id, status, *, error=None):
        if run_id in self._runs:
            self._runs[run_id]["status"] = status
            if error is not None:
                self._runs[run_id]["error"] = error
            self._runs[run_id]["updated_at"] = datetime.now(UTC).isoformat()

    async def delete(self, run_id):
        self._runs.pop(run_id, None)

    async def update_run_completion(self, run_id, *, status, **kwargs):
        if run_id in self._runs:
            self._runs[run_id]["status"] = status
            for key, value in kwargs.items():
                if value is not None:
                    self._runs[run_id][key] = value
            self._runs[run_id]["updated_at"] = datetime.now(UTC).isoformat()

    async def list_pending(self, *, before=None):
        now = before or datetime.now(UTC).isoformat()
        results = [r for r in self._runs.values() if r["status"] == "pending" and r["created_at"] <= now]
        results.sort(key=lambda r: r["created_at"])
        return results

    async def aggregate_tokens_by_thread(self, thread_id: str) -> dict[str, Any]:
        completed = [r for r in self._runs.values() if r["thread_id"] == thread_id and r.get("status") in ("success", "error")]
        by_model: dict[str, dict] = {}
        for r in completed:
            model = r.get("model_name") or "unknown"
            entry = by_model.setdefault(model, {"tokens": 0, "runs": 0})
            entry["tokens"] += r.get("total_tokens", 0)
            entry["runs"] += 1
        return {
            "total_tokens": sum(r.get("total_tokens", 0) for r in completed),
            "total_input_tokens": sum(r.get("total_input_tokens", 0) for r in completed),
            "total_output_tokens": sum(r.get("total_output_tokens", 0) for r in completed),
            "total_runs": len(completed),
            "by_model": by_model,
            "by_caller": {
                "lead_agent": sum(r.get("lead_agent_tokens", 0) for r in completed),
                "subagent": sum(r.get("subagent_tokens", 0) for r in completed),
                "middleware": sum(r.get("middleware_tokens", 0) for r in completed),
            },
        }

    async def aggregate_tokens_global(
        self,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        completed = [
            r for r in self._runs.values()
            if r.get("status") in ("success", "error")
            and (user_id is None or r.get("user_id") == user_id)
        ]
        by_model: dict[str, dict] = {}
        for r in completed:
            model = r.get("model_name") or "unknown"
            entry = by_model.setdefault(model, {"tokens": 0, "runs": 0, "input_tokens": 0, "output_tokens": 0})
            entry["tokens"] += r.get("total_tokens", 0)
            entry["input_tokens"] += r.get("total_input_tokens", 0)
            entry["output_tokens"] += r.get("total_output_tokens", 0)
            entry["runs"] += 1
        return {
            "total_tokens": sum(r.get("total_tokens", 0) for r in completed),
            "total_input_tokens": sum(r.get("total_input_tokens", 0) for r in completed),
            "total_output_tokens": sum(r.get("total_output_tokens", 0) for r in completed),
            "total_runs": len(completed),
            "by_model": by_model,
            "by_caller": {
                "lead_agent": sum(r.get("lead_agent_tokens", 0) for r in completed),
                "subagent": sum(r.get("subagent_tokens", 0) for r in completed),
                "middleware": sum(r.get("middleware_tokens", 0) for r in completed),
            },
        }

    async def aggregate_tokens_timeseries(
        self,
        *,
        user_id: str | None = None,
        days: int = 30,
    ) -> list[dict[str, Any]]:
        """Return daily token usage breakdown grouped by date and model."""
        from datetime import timedelta

        cutoff = datetime.now(UTC) - timedelta(days=days)
        completed = [
            r for r in self._runs.values()
            if r.get("status") in ("success", "error")
            and (user_id is None or r.get("user_id") == user_id)
        ]

        groups: dict[str, dict[str, Any]] = {}
        for r in completed:
            created = r.get("created_at", "")
            date_key = created[:10] if created else "unknown"
            model = r.get("model_name") or "unknown"
            key = f"{date_key}|{model}"
            if key not in groups:
                groups[key] = {"date": date_key, "model_name": model, "run_count": 0, "total_tokens": 0}
            groups[key]["run_count"] += 1
            groups[key]["total_tokens"] += r.get("total_tokens", 0)

        result = sorted(groups.values(), key=lambda x: x["date"])
        cutoff_str = cutoff.strftime("%Y-%m-%d")
        return [g for g in result if g["date"] >= cutoff_str]

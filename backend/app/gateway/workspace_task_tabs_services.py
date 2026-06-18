"""Per-user persistence for workspace task tabs."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from kkoclaw.config.paths import get_paths

logger = logging.getLogger(__name__)

_TASK_TABS_FILE = "workspace_task_tabs.json"


class WorkspaceTaskTabsService:
    """Persist workspace task tabs as lightweight per-user JSON state."""

    @classmethod
    def _tabs_file(cls, user_id: str) -> Path:
        return get_paths().user_dir(user_id) / _TASK_TABS_FILE

    @classmethod
    def load_tabs(cls, user_id: str) -> list[dict[str, Any]]:
        path = cls._tabs_file(user_id)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to read workspace task tabs from %s: %s", path, exc)
            return []
        tabs = payload.get("tabs") if isinstance(payload, dict) else payload
        if not isinstance(tabs, list):
            return []
        return [tab for tab in tabs if isinstance(tab, dict)]

    @classmethod
    def save_tabs(cls, user_id: str, tabs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        path = cls._tabs_file(user_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps({"tabs": tabs}, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        tmp.replace(path)
        return tabs

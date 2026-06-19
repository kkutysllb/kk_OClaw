"""User-granted external path registry for the desktop authorization flow.

When a Coding Agent or lead agent tries to access a real absolute path outside
the default allowed roots (app home, coding home, project root, system temp),
the desktop shows a system dialog. Accepted paths are persisted here so
subsequent access is silent. The store uses prefix matching: granting
``/Users/x/Documents/myproject`` also covers ``/Users/x/Documents/myproject/...``.

The JSON file lives at ``<KKOCLAW_HOME>/granted_paths.json`` and is created with
mode 0600 so only the current user can read/modify the grant list.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

from kkoclaw.config.runtime_paths import runtime_home

logger = logging.getLogger(__name__)

_LOCK = Lock()
_CACHE: dict[str, Any] | None = None


def _granted_paths_file() -> Path:
    """Return the path to ``granted_paths.json`` under the runtime home."""
    return runtime_home() / "granted_paths.json"


def _load() -> dict[str, Any]:
    """Load the grant store, with an in-process cache for hot-path reads."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    path = _granted_paths_file()
    try:
        raw = path.read_text(encoding="utf-8")
        _CACHE = json.loads(raw) if raw.strip() else {"granted_paths": []}
    except FileNotFoundError:
        _CACHE = {"granted_paths": []}
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s — treating as empty", path, exc)
        _CACHE = {"granted_paths": []}

    if "granted_paths" not in _CACHE or not isinstance(_CACHE["granted_paths"], list):
        _CACHE["granted_paths"] = []
    return _CACHE


def _flush(data: dict[str, Any]) -> None:
    """Atomically write the grant store with mode 0600."""
    global _CACHE
    _CACHE = data
    path = _granted_paths_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write via temp file in the same directory.
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".granted_paths.", suffix=".tmp")
    try:
        os.write(fd, json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"))
        os.close(fd)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _normalise(path: str) -> str:
    """Resolve and normalise a path for reliable prefix matching."""
    try:
        return str(Path(path).expanduser().resolve())
    except (OSError, ValueError):
        return str(Path(path).expanduser())


def is_path_granted(path: str) -> bool:
    """Return True if *path* (or a parent) is in the grant list.

    Prefix matching: granting ``/a/b`` covers ``/a/b``, ``/a/b/c``, etc.
    The check is read-only and never mutates the store.

    .. note:: This function always reads from disk (bypassing the in-process
       ``_CACHE``) because the Electron main process may update the file at
       any time while the Python gateway is running. Using a stale cache would
       cause false rejections after the user authorizes a path via the system
       dialog.
    """
    normalised = _normalise(path)
    # Always read from disk — the file may have been updated by the Electron
    # main process since the last cached read.
    try:
        raw = _granted_paths_file().read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else {"granted_paths": []}
    except FileNotFoundError:
        return False
    except (json.JSONDecodeError, OSError):
        return False
    for entry in data.get("granted_paths", []):
        granted = entry.get("path", "")
        if not granted:
            continue
        granted_resolved = _normalise(granted)
        # Exact match or prefix match (ensure boundary with trailing separator).
        if normalised == granted_resolved or normalised.startswith(granted_resolved + "/"):
            return True
    return False


def grant_path(
    path: str,
    *,
    scope: str = "general",
    thread_id: str | None = None,
    granted_via: str = "system_dialog",
) -> None:
    """Append *path* to the grant list (idempotent — duplicates are skipped)."""
    normalised = _normalise(path)
    with _LOCK:
        data = _load()
        entries = data.get("granted_paths", [])
        # Skip if already granted (prefix check on existing entries).
        for entry in entries:
            existing = _normalise(entry.get("path", ""))
            if existing == normalised or normalised.startswith(existing + "/"):
                return  # already covered by an existing grant
        entries.append(
            {
                "path": normalised,
                "granted_at": datetime.now(UTC).isoformat(),
                "scope": scope,
                "thread_id": thread_id,
                "granted_via": granted_via,
            }
        )
        data["granted_paths"] = entries
        _flush(data)
    logger.info("Granted path access: %s (scope=%s)", normalised, scope)


def list_grants() -> list[dict[str, Any]]:
    """Return a copy of all granted path entries."""
    with _LOCK:
        data = _load()
    return list(data.get("granted_paths", []))


def revoke_path(path: str) -> bool:
    """Remove *path* from the grant list. Returns True if an entry was removed."""
    normalised = _normalise(path)
    with _LOCK:
        data = _load()
        entries = data.get("granted_paths", [])
        before = len(entries)
        entries = [e for e in entries if _normalise(e.get("path", "")) != normalised]
        if len(entries) == before:
            return False
        data["granted_paths"] = entries
        _flush(data)
    logger.info("Revoked path access: %s", normalised)
    return True


def reset_cache() -> None:
    """Clear the in-process cache. Used by tests after mutating the file directly."""
    global _CACHE
    _CACHE = None

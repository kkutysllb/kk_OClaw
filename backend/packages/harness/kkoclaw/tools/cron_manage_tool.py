"""Tool for managing cron jobs through agent conversation.

Cron jobs are stored in an independent ``cron_config.json`` file (not inside
``extensions_config.json``) so that they can be managed independently.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any
from weakref import WeakValueDictionary

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from kkoclaw.agents.thread_state import ThreadState
from kkoclaw.mcp.tools import _make_sync_tool_wrapper

logger = logging.getLogger(__name__)

CRON_CONFIG_FILENAME = "cron_config.json"

# Basic 6-field cron validation: sec min hour day month weekday
_CRON_RE = re.compile(
    r"^\s*"
    r"(\?|\*|(?:[0-5]?\d)(?:-[0-5]?\d)?(?:/[0-5]?\d)?(?:,[0-5]?\d(?:-[0-5]?\d)?(?:/[0-5]?\d)?)*)\s+"
    r"(\?|\*|(?:[0-5]?\d)(?:-[0-5]?\d)?(?:/\d+)?(?:,\d+(?:-\d+)?(?:/\d+)?)*)\s+"
    r"(\?|\*|(?:2[0-3]|1?\d)(?:-(?:2[0-3]|1?\d))?(?:/\d+)?(?:,(?:2[0-3]|1?\d)(?:-(?:2[0-3]|1?\d))?(?:/\d+)?)*)\s+"
    r"(\?|\*|(?:3[01]|[12]?\d)(?:-(?:3[01]|[12]?\d))?(?:/\d+)?(?:,(?:3[01]|[12]?\d)(?:-(?:3[01]|[12]?\d))?(?:/\d+)?)*)\s+"
    r"(\?|\*|(?:1[0-2]|[1-9])(?:-(?:1[0-2]|[1-9]))?(?:/\d+)?(?:,(?:1[0-2]|[1-9])(?:-(?:1[0-2]|[1-9]))?(?:/\d+)?)*)\s+"
    r"(\?|\*|[0-6](?:-[0-6])?(?:/[0-6])?(?:,[0-6](?:-[0-6])?(?:/[0-6])?)*)\s*"
    r"$"
)

_cron_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()
_global_lock = asyncio.Lock()


def _get_lock(name: str) -> asyncio.Lock:
    lock = _cron_locks.get(name)
    if lock is None:
        lock = asyncio.Lock()
        _cron_locks[name] = lock
    return lock


def _resolve_cron_config_path() -> Path:
    """Locate the cron config file next to config.yaml."""
    from kkoclaw.config.app_config import AppConfig

    config_path = AppConfig.resolve_config_path()
    if config_path is not None:
        return config_path.parent / CRON_CONFIG_FILENAME
    return Path.cwd().parent / CRON_CONFIG_FILENAME


def _load_cron_config() -> dict[str, Any]:
    """Load cron_config.json. Returns default structure if missing."""
    path = _resolve_cron_config_path()
    if not path.exists():
        return {"cronJobs": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f) or {"cronJobs": {}}


def _save_cron_config(data: dict[str, Any]) -> None:
    """Write data to cron_config.json."""
    path = _resolve_cron_config_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info("cron_config.json written to %s", path)


def _validate_cron_expression(expr: str) -> None:
    """Validate a 6-field cron expression."""
    parts = expr.strip().split()
    if len(parts) != 6:
        raise ValueError(
            f"Invalid cron expression '{expr}': expected 6 fields (sec min hour day month weekday), got {len(parts)}."
        )
    # Allow common shorthand patterns that the strict regex may not cover
    for part in parts:
        if not re.match(r"^[\d\*\?\-/LW#]+$", part):
            raise ValueError(f"Invalid cron field '{part}' in expression '{expr}'.")


def _validate_job_name(name: str) -> str:
    """Validate and normalise a cron job name."""
    name = name.strip()
    if not name:
        raise ValueError("Cron job name cannot be empty.")
    if not re.match(r"^[a-zA-Z0-9_-]+$", name):
        raise ValueError(
            f"Invalid cron job name '{name}': only letters, digits, hyphens and underscores are allowed."
        )
    return name


async def _to_thread(func, /, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


async def _cron_manage_impl(
    runtime: ToolRuntime[ContextT, ThreadState],
    action: str,
    name: str | None = None,
    cron: str | None = None,
    description: str | None = None,
    agent: str | None = None,
    model: str | None = None,
    prompt: str | None = None,
    enabled: bool | None = None,
) -> str:
    """Manage cron jobs stored in cron_config.json.

    Args:
        action: One of list, create, update, delete, toggle.
        name: Cron job name (required for create, update, delete, toggle).
        cron: 6-field cron expression (required for create, optional for update).
        description: Human-readable description of the task.
        agent: Agent name to use (default: lead_agent).
        model: Model ID to use (optional, uses default if empty).
        prompt: The prompt/message to send to the agent (required for create, optional for update).
        enabled: Whether the job is enabled (default: True for create).
    """
    # --- list ---
    if action == "list":
        config = await _to_thread(_load_cron_config)
        jobs = config.get("cronJobs", {})
        if not jobs:
            return "No cron jobs configured."
        lines = []
        for job_name, job_data in jobs.items():
            status = "enabled" if job_data.get("enabled", True) else "disabled"
            lines.append(
                f"  - {job_name}: cron=\"{job_data.get('cron', '')}\" agent=\"{job_data.get('agent', 'lead_agent')}\" model=\"{job_data.get('model') or 'default'}\" enabled={status} description=\"{job_data.get('description', '')}\""
            )
        return "Cron jobs:\n" + "\n".join(lines)

    # All other actions require a name
    if not name:
        raise ValueError("name is required for action '{action}'.".format(action=action))
    name = _validate_job_name(name)
    lock = _get_lock(name)

    async with lock:
        # --- create ---
        if action == "create":
            if cron is None:
                raise ValueError("cron is required for create.")
            _validate_cron_expression(cron)
            if prompt is None:
                raise ValueError("prompt is required for create.")

            config = await _to_thread(_load_cron_config)
            jobs = config.setdefault("cronJobs", {})

            async with _global_lock:
                if name in jobs:
                    raise ValueError(f"Cron job '{name}' already exists.")

                # Capture the current thread_id so the scheduler reuses
                # this thread's workspace (/mnt/user-data) when executing
                # the job.  This ensures scripts and files created in the
                # current conversation are accessible to the cron run.
                current_thread_id = None
                try:
                    ctx = runtime.context or {}
                    current_thread_id = ctx.get("thread_id")
                except Exception:
                    pass

                job_data = {
                    "enabled": enabled if enabled is not None else True,
                    "cron": cron.strip(),
                    "description": (description or "").strip(),
                    "agent": (agent or "lead_agent").strip(),
                    "model": model.strip() if model else None,
                    "prompt": prompt.strip(),
                }
                if current_thread_id:
                    job_data["thread_id"] = current_thread_id
                jobs[name] = job_data
                await _to_thread(_save_cron_config, config)
                logger.info("Cron job '%s' created via agent tool (thread_id=%s)", name, current_thread_id)
            return f"Created cron job '{name}' with schedule '{cron}'."

        # --- update ---
        if action == "update":
            config = await _to_thread(_load_cron_config)
            jobs = config.get("cronJobs", {})

            if name not in jobs:
                raise ValueError(f"Cron job '{name}' not found.")

            existing = jobs[name]
            if cron is not None:
                _validate_cron_expression(cron)
                existing["cron"] = cron.strip()
            if description is not None:
                existing["description"] = description.strip()
            if agent is not None:
                existing["agent"] = agent.strip()
            if model is not None:
                existing["model"] = model.strip() or None
            if prompt is not None:
                existing["prompt"] = prompt.strip()
            if enabled is not None:
                existing["enabled"] = enabled

            await _to_thread(_save_cron_config, config)
            logger.info("Cron job '%s' updated via agent tool", name)
            return f"Updated cron job '{name}'."

        # --- delete ---
        if action == "delete":
            config = await _to_thread(_load_cron_config)
            jobs = config.get("cronJobs", {})

            if name not in jobs:
                raise ValueError(f"Cron job '{name}' not found.")

            del jobs[name]
            await _to_thread(_save_cron_config, config)
            logger.info("Cron job '%s' deleted via agent tool", name)
            return f"Deleted cron job '{name}'."

        # --- toggle ---
        if action == "toggle":
            if enabled is None:
                raise ValueError("enabled is required for toggle (True or False).")

            config = await _to_thread(_load_cron_config)
            jobs = config.get("cronJobs", {})

            if name not in jobs:
                raise ValueError(f"Cron job '{name}' not found.")

            jobs[name]["enabled"] = enabled
            await _to_thread(_save_cron_config, config)
            status = "enabled" if enabled else "disabled"
            logger.info("Cron job '%s' toggled to %s via agent tool", name, status)
            return f"Cron job '{name}' is now {status}."

        raise ValueError(
            f"Unsupported action '{action}'. Use one of: list, create, update, delete, toggle."
        )


@tool("cron_manage", parse_docstring=True)
async def cron_manage_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    action: str,
    name: str | None = None,
    cron: str | None = None,
    description: str | None = None,
    agent: str | None = None,
    model: str | None = None,
    prompt: str | None = None,
    enabled: bool | None = None,
) -> str:
    """Manage cron jobs stored in cron_config.json.

    Args:
        action: One of list, create, update, delete, toggle.
        name: Cron job name (required for create, update, delete, toggle).
        cron: 6-field cron expression (required for create, optional for update).
        description: Human-readable description of the task.
        agent: Agent name to use (default: lead_agent).
        model: Model ID to use (optional, uses default if empty).
        prompt: The prompt/message to send to the agent (required for create, optional for update).
        enabled: Whether the job is enabled (default: True for create).
    """
    return await _cron_manage_impl(
        runtime=runtime,
        action=action,
        name=name,
        cron=cron,
        description=description,
        agent=agent,
        model=model,
        prompt=prompt,
        enabled=enabled,
    )


cron_manage_tool.func = _make_sync_tool_wrapper(_cron_manage_impl, "cron_manage")

"""Generic configuration read/write API.

Provides endpoints to read and write arbitrary top-level sections of
config.yaml, complementing the dedicated /api/models CRUD endpoints.
"""
import logging
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/config", tags=["config"])

# ---------------------------------------------------------------------------
# Allowed top-level config sections (whitelist)
# ---------------------------------------------------------------------------
ALLOWED_SECTIONS: set[str] = {
    "log_level",
    "token_usage",
    "token_economy",
    "sandbox",
    "title",
    "summarization",
    "memory",
    "database",
    "run_events",
    "cron_management",
    "uploads",
    "subagents",
    "skills",
    "tool_search",
    "agents_api",
    "coding_agent",
    "skill_evolution",
    "channels",
    "guardrails",
    "circuit_breaker",
    "acp_agents",
    "tool_groups",
    "tools",
    "checkpointer",
}

# Sections that contain sensitive values needing masking on read
SENSITIVE_KEYS = {"api_key", "secret", "token", "password", "bot_token", "app_secret", "client_secret"}

# Pattern to detect environment variable references ($VAR or ${VAR})
_ENV_VAR_PATTERN = re.compile(r"^\$\{?[A-Z_][A-Z0-9_]*\}?$")


# ---------------------------------------------------------------------------
# Config YAML helpers (mirrors models.py pattern)
# ---------------------------------------------------------------------------

def _load_config_yaml() -> dict:
    """Load the full config.yaml as a raw dict."""
    config_path = AppConfig.resolve_config_path()
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _save_config_yaml(config_data: dict) -> Path:
    """Write the raw dict back to config.yaml."""
    config_path = AppConfig.resolve_config_path()
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    logger.info(f"config.yaml written to {config_path}")
    return config_path


def _mask_sensitive(obj: Any) -> Any:
    """Recursively mask sensitive values for safe display.

    Values that are environment variable references ($VAR) are NOT masked,
    because they don't contain the actual secret.
    """
    if isinstance(obj, dict):
        return {
            k: (
                "***" if (
                    k.lower() in SENSITIVE_KEYS
                    and isinstance(v, str)
                    and v
                    and not _ENV_VAR_PATTERN.match(v)
                ) else _mask_sensitive(v)
            )
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_mask_sensitive(item) for item in obj]
    return obj


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ConfigSectionResponse(BaseModel):
    section: str = Field(..., description="The top-level config section name")
    data: Any = Field(..., description="Configuration data for this section (may be null if absent)")


class FullConfigResponse(BaseModel):
    config: dict = Field(..., description="Full config.yaml contents with sensitive values masked")


class ConfigSectionUpdate(BaseModel):
    data: Any = Field(..., description="New value for this section")


class FullConfigUpdate(BaseModel):
    config: dict = Field(..., description="Full config.yaml contents to replace")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=FullConfigResponse,
    summary="Get Full Configuration",
    description="Retrieve the entire config.yaml with sensitive values masked.",
)
async def get_full_config() -> FullConfigResponse:
    config_data = _load_config_yaml()
    masked = _mask_sensitive(config_data)
    return FullConfigResponse(config=masked if isinstance(masked, dict) else {})


@router.put(
    "",
    response_model=FullConfigResponse,
    summary="Replace Full Configuration",
    description="Replace the entire config.yaml with the provided data.",
)
async def replace_full_config(body: FullConfigUpdate) -> FullConfigResponse:
    try:
        _save_config_yaml(body.config)
        saved = _load_config_yaml()
        masked = _mask_sensitive(saved)
        return FullConfigResponse(config=masked if isinstance(masked, dict) else {})
    except Exception as e:
        logger.error(f"Failed to replace full config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update config: {e}")


@router.post(
    "/restart",
    summary="Restart Gateway",
    description="Restart the gateway process so config changes take effect. "
    "Spawns a delayed child process, then exits the current process.",
)
async def restart_gateway() -> dict:
    """Trigger a graceful self-restart.

    In packaged desktop mode, Electron's BackendManager detects the exit and
    respawns. In desktop dev mode, desktop-electron/scripts/dev.mjs owns the
    gateway and respawns it. In web/server mode, a detached watcher process
    re-execs uvicorn after a short delay (allowing the port to be released).
    """
    logger.info("Gateway restart requested")

    def _do_restart() -> None:
        """Spawn watcher, then self-exit after response is flushed."""
        # Give FastAPI time to flush the HTTP response
        time.sleep(0.8)

        try:
            _spawn_watcher_process()
        except Exception:
            logger.exception("Failed to spawn restart watcher")

        # Exit current process; port is released on exit
        logger.info("Gateway exiting for restart")
        os._exit(0)

    threading.Thread(target=_do_restart, daemon=True).start()
    return {"status": "restarting", "message": "Gateway is restarting"}


@router.get(
    "/{section}",
    response_model=ConfigSectionResponse,
    summary="Get Config Section",
    description="Retrieve a single top-level section from config.yaml.",
)
async def get_config_section(section: str) -> ConfigSectionResponse:
    if section not in ALLOWED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown config section '{section}'. Allowed: {sorted(ALLOWED_SECTIONS)}",
        )
    config_data = _load_config_yaml()
    raw = config_data.get(section)
    return ConfigSectionResponse(
        section=section,
        data=_mask_sensitive(raw),
    )


@router.put(
    "/{section}",
    response_model=ConfigSectionResponse,
    summary="Update Config Section",
    description="Update a single top-level section in config.yaml and persist.",
)
async def update_config_section(section: str, body: ConfigSectionUpdate) -> ConfigSectionResponse:
    if section not in ALLOWED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown config section '{section}'. Allowed: {sorted(ALLOWED_SECTIONS)}",
        )

    try:
        config_data = _load_config_yaml()

        # For 'models' we don't allow full replacement here (use /api/models CRUD).
        # But we allow it for completeness — models list is a list of dicts.
        config_data[section] = body.data
        _save_config_yaml(config_data)

        # Re-read to confirm what was saved
        saved = _load_config_yaml().get(section)
        return ConfigSectionResponse(
            section=section,
            data=_mask_sensitive(saved),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update config section '{section}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update config: {e}")


# ---------------------------------------------------------------------------
# Self-restart helper
# ---------------------------------------------------------------------------

def _spawn_watcher_process() -> None:
    """Spawn a detached child process that re-execs the gateway after a delay.

    The watcher sleeps ~2 seconds (allowing the current process to exit and
    release the port), then launches a fresh uvicorn instance with the same
    host/port configuration.

    In PyInstaller frozen mode (packaged desktop), this is a no-op because
    Electron's BackendManager detects the exit and respawns automatically.
    In desktop dev mode, the Electron dev launcher owns and respawns the
    gateway process, so no detached watcher is needed.
    """
    is_frozen = getattr(sys, "frozen", False)

    if is_frozen:
        logger.info("Frozen mode: skipping watcher (Electron will respawn)")
        return

    if os.environ.get("KKOCLAW_DESKTOP_DEV") == "1":
        logger.info("Desktop dev mode: skipping watcher (dev launcher will respawn)")
        return

    host = os.environ.get("GATEWAY_HOST", "0.0.0.0")
    port = os.environ.get("GATEWAY_PORT", "9987")
    python = sys.executable

    # Spawn a watcher that sleeps, then launches a fresh uvicorn instance.
    watcher_script = (
        "import time, subprocess; "
        f"time.sleep(2); "
        f"subprocess.Popen(["
        f"r'{python}', '-m', 'uvicorn', 'app.gateway.app:app', "
        f"'--host', r'{host}', '--port', r'{port}'"
        f"])"
    )
    launcher = [python, "-c", watcher_script]

    # start_new_session=True detaches the watcher so it survives parent exit
    subprocess.Popen(
        launcher,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        close_fds=True,
    )
    logger.info(f"Restart watcher spawned (host={host}, port={port})")

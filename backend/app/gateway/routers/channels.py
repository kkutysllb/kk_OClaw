"""Gateway router for IM channel management."""

from __future__ import annotations

import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["channels"])

# Channel name -> display info (kept in sync with service._CHANNEL_REGISTRY)
_CHANNEL_META: dict[str, dict] = {
    "dingtalk": {"display_name": "DingTalk", "display_name_zh": "\u9489\u9489", "credential_keys": ["client_id", "client_secret"], "supports_streaming": False},
    "discord": {"display_name": "Discord", "display_name_zh": "Discord", "credential_keys": ["bot_token"], "supports_streaming": False},
    "feishu": {"display_name": "Feishu", "display_name_zh": "\u98de\u4e66", "credential_keys": ["app_id", "app_secret"], "supports_streaming": True},
    "slack": {"display_name": "Slack", "display_name_zh": "Slack", "credential_keys": ["bot_token", "app_token"], "supports_streaming": False},
    "telegram": {"display_name": "Telegram", "display_name_zh": "Telegram", "credential_keys": ["bot_token"], "supports_streaming": False},
    "wechat": {"display_name": "WeChat", "display_name_zh": "\u5fae\u4fe1", "credential_keys": ["bot_token"], "supports_streaming": False},
    "wecom": {"display_name": "WeCom", "display_name_zh": "\u4f01\u4e1a\u5fae\u4fe1", "credential_keys": ["bot_id", "bot_secret"], "supports_streaming": True},
}


# ---------------------------------------------------------------------------
# Config YAML read / write helpers
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


class ChannelStatusResponse(BaseModel):
    service_running: bool
    channels: dict[str, dict]


class ChannelRestartResponse(BaseModel):
    success: bool
    message: str


class ChannelConfigItem(BaseModel):
    """Per-channel config summary (credential values are masked)."""
    enabled: bool
    credential_keys: list[str]
    configured: bool
    display_name: str
    display_name_zh: str
    supports_streaming: bool


class ChannelsConfigResponse(BaseModel):
    """Full channels config response."""
    channels: dict[str, ChannelConfigItem]


class ChannelConfigUpdateRequest(BaseModel):
    """Request to update a single channel's config."""
    name: str
    enabled: bool
    config: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=ChannelStatusResponse)
async def get_channels_status() -> ChannelStatusResponse:
    """Get the status of all IM channels."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        return ChannelStatusResponse(service_running=False, channels={})
    status = service.get_status()
    return ChannelStatusResponse(**status)


@router.post("/{name}/restart", response_model=ChannelRestartResponse)
async def restart_channel(name: str) -> ChannelRestartResponse:
    """Restart a specific IM channel."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    success = await service.restart_channel(name)
    if success:
        logger.info("Channel %s restarted successfully", name)
        return ChannelRestartResponse(success=True, message=f"Channel {name} restarted successfully")
    else:
        logger.warning("Failed to restart channel %s", name)
        return ChannelRestartResponse(success=False, message=f"Failed to restart channel {name}")


def _mask_credential(value: object, key: str) -> str:
    """Return a masked summary of a credential value."""
    if isinstance(value, str) and value.startswith("$"):
        return value  # env-var reference, show as-is
    if isinstance(value, str) and len(value) > 0:
        return value[:4] + "***"
    return "" if not value else "***"


@router.get("/config", response_model=ChannelsConfigResponse)
async def get_channels_config() -> ChannelsConfigResponse:
    """Get the channels configuration from config.yaml."""
    raw = _load_config_yaml()
    channels_raw = raw.get("channels", {}) or {}

    result: dict[str, ChannelConfigItem] = {}
    for name, meta in _CHANNEL_META.items():
        ch_cfg = channels_raw.get(name, {})
        if not isinstance(ch_cfg, dict):
            ch_cfg = {}
        enabled = ch_cfg.get("enabled", False) is True
        credential_keys = meta["credential_keys"]
        configured = any(
            isinstance(ch_cfg.get(k), str) and ch_cfg[k].strip()
            for k in credential_keys
        )
        result[name] = ChannelConfigItem(
            enabled=enabled,
            credential_keys=credential_keys,
            configured=configured,
            display_name=meta["display_name"],
            display_name_zh=meta["display_name_zh"],
            supports_streaming=meta["supports_streaming"],
        )
    return ChannelsConfigResponse(channels=result)


@router.put("/config", response_model=ChannelsConfigResponse)
async def update_channel_config(req: ChannelConfigUpdateRequest) -> ChannelsConfigResponse:
    """Update a single channel's config in config.yaml."""
    if req.name not in _CHANNEL_META:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {req.name}")

    raw = _load_config_yaml()
    channels_raw = raw.setdefault("channels", {})
    existing = channels_raw.get(req.name, {})
    if not isinstance(existing, dict):
        existing = {}

    updated = dict(existing)
    updated["enabled"] = req.enabled
    if req.config:
        for k, v in req.config.items():
            if v:
                updated[k] = v
            elif k in updated:
                del updated[k]

    channels_raw[req.name] = updated
    raw["channels"] = channels_raw
    _save_config_yaml(raw)

    logger.info("Channel %s config updated: enabled=%s", req.name, req.enabled)
    return await get_channels_config()

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from kkoclaw.config.extensions_config import ExtensionsConfig, get_extensions_config, reload_extensions_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mcp"])


# ---------------------------------------------------------------------------
# Helpers — credential masking
# ---------------------------------------------------------------------------


def _mask_secret(value: str) -> str:
    """Mask a sensitive credential value for safe frontend exposure.

    - ``$ENV_VAR`` references are shown as-is (they reference the real env).
    - Plaintext secrets are truncated: first 4 chars + ``***``.
    - Empty strings stay empty.
    """
    if not value:
        return ""
    if value.startswith("$"):
        return value  # env-var reference, safe to show
    if len(value) <= 8:
        return "***"
    return value[:4] + "***"


def _mask_env(env: dict[str, str]) -> dict[str, str]:
    """Mask all environment variable values."""
    return {k: _mask_secret(v) for k, v in env.items()}


def _mask_headers(headers: dict[str, str]) -> dict[str, str]:
    """Mask header values that look like credentials.

    Headers like ``Content-Type: application/json`` are harmless and shown
    as-is. Headers like ``Authorization: Bearer xxx`` are masked.
    """
    SENSITIVE_HEADER_KEYS = {"authorization", "x-api-key", "api-key", "token", "x-auth-token"}
    masked: dict[str, str] = {}
    for k, v in headers.items():
        if k.lower() in SENSITIVE_HEADER_KEYS:
            masked[k] = _mask_secret(v)
        else:
            masked[k] = v
    return masked


def _mask_oauth(oauth) -> McpOAuthConfigResponse | None:
    """Mask OAuth secrets in the response."""
    if oauth is None:
        return None
    data = oauth.model_dump() if hasattr(oauth, "model_dump") else dict(oauth)
    if data.get("client_secret"):
        data["client_secret"] = _mask_secret(data["client_secret"])
    if data.get("refresh_token"):
        data["refresh_token"] = _mask_secret(data["refresh_token"])
    return McpOAuthConfigResponse(**data)


def _is_masked(value: str | None) -> bool:
    """Check if a value was masked (contains ``***``) or is empty."""
    if value is None:
        return True
    if value == "":
        return True
    if "***" in value:
        return True
    return False


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class McpOAuthConfigResponse(BaseModel):
    """OAuth configuration for an MCP server."""

    enabled: bool = Field(default=True, description="Whether OAuth token injection is enabled")
    token_url: str = Field(default="", description="OAuth token endpoint URL")
    grant_type: Literal["client_credentials", "refresh_token"] = Field(default="client_credentials", description="OAuth grant type")
    client_id: str | None = Field(default=None, description="OAuth client ID")
    client_secret: str | None = Field(default=None, description="OAuth client secret")
    refresh_token: str | None = Field(default=None, description="OAuth refresh token")
    scope: str | None = Field(default=None, description="OAuth scope")
    audience: str | None = Field(default=None, description="OAuth audience")
    token_field: str = Field(default="access_token", description="Token response field containing access token")
    token_type_field: str = Field(default="token_type", description="Token response field containing token type")
    expires_in_field: str = Field(default="expires_in", description="Token response field containing expires-in seconds")
    default_token_type: str = Field(default="Bearer", description="Default token type when response omits token_type")
    refresh_skew_seconds: int = Field(default=60, description="Refresh this many seconds before expiry")
    extra_token_params: dict[str, str] = Field(default_factory=dict, description="Additional form params sent to token endpoint")


class McpServerConfigResponse(BaseModel):
    """Response model for MCP server configuration."""

    enabled: bool = Field(default=True, description="Whether this MCP server is enabled")
    type: str = Field(default="stdio", description="Transport type: 'stdio', 'sse', or 'http'")
    command: str | None = Field(default=None, description="Command to execute to start the MCP server (for stdio type)")
    args: list[str] = Field(default_factory=list, description="Arguments to pass to the command (for stdio type)")
    env: dict[str, str] = Field(default_factory=dict, description="Environment variables for the MCP server")
    url: str | None = Field(default=None, description="URL of the MCP server (for sse or http type)")
    headers: dict[str, str] = Field(default_factory=dict, description="HTTP headers to send (for sse or http type)")
    oauth: McpOAuthConfigResponse | None = Field(default=None, description="OAuth configuration for MCP HTTP/SSE servers")
    description: str = Field(default="", description="Human-readable description of what this MCP server provides")


class McpConfigResponse(BaseModel):
    """Response model for MCP configuration."""

    mcp_servers: dict[str, McpServerConfigResponse] = Field(
        default_factory=dict,
        description="Map of MCP server name to configuration",
    )


class McpConfigUpdateRequest(BaseModel):
    """Request model for updating MCP configuration."""

    mcp_servers: dict[str, McpServerConfigResponse] = Field(
        ...,
        description="Map of MCP server name to configuration",
    )


@router.get(
    "/mcp/config",
    response_model=McpConfigResponse,
    summary="Get MCP Configuration",
    description="Retrieve the current Model Context Protocol (MCP) server configurations.",
)
async def get_mcp_configuration() -> McpConfigResponse:
    """Get the current MCP configuration.

    Returns:
        The current MCP configuration with all servers.

    Example:
        ```json
        {
            "mcp_servers": {
                "github": {
                    "enabled": true,
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"GITHUB_TOKEN": "ghp_xxx"},
                    "description": "GitHub MCP server for repository operations"
                }
            }
        }
        ```
    """
    config = get_extensions_config()

    result: dict[str, McpServerConfigResponse] = {}
    for name, server in config.mcp_servers.items():
        data = server.model_dump()
        # Mask sensitive fields before returning to frontend
        data["env"] = _mask_env(data.get("env") or {})
        data["headers"] = _mask_headers(data.get("headers") or {})
        data["oauth"] = _mask_oauth(server.oauth) if hasattr(server, "oauth") and server.oauth else None
        result[name] = McpServerConfigResponse(**data)
    return McpConfigResponse(mcp_servers=result)


@router.put(
    "/mcp/config",
    response_model=McpConfigResponse,
    summary="Update MCP Configuration",
    description="Update Model Context Protocol (MCP) server configurations and save to file.",
)
async def update_mcp_configuration(request: McpConfigUpdateRequest) -> McpConfigResponse:
    """Update the MCP configuration.

    This will:
    1. Save the new configuration to the mcp_config.json file
    2. Reload the configuration cache
    3. Reset MCP tools cache to trigger reinitialization

    Args:
        request: The new MCP configuration to save.

    Returns:
        The updated MCP configuration.

    Raises:
        HTTPException: 500 if the configuration file cannot be written.

    Example Request:
        ```json
        {
            "mcp_servers": {
                "github": {
                    "enabled": true,
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"},
                    "description": "GitHub MCP server for repository operations"
                }
            }
        }
        ```
    """
    try:
        # Get the current config path (or determine where to save it)
        config_path = ExtensionsConfig.resolve_config_path()

        # If no config file exists, create one in the parent directory (project root)
        if config_path is None:
            config_path = Path.cwd().parent / "extensions_config.json"
            logger.info(f"No existing extensions config found. Creating new config at: {config_path}")

        # Load current config to preserve skills configuration
        current_config = get_extensions_config()

        # Build the mcpServers dict with merge logic for masked credentials
        mcp_servers_out: dict[str, dict] = {}
        for name, server in request.mcp_servers.items():
            data = server.model_dump()
            existing = current_config.mcp_servers.get(name)

            # Merge env: keep existing values when incoming value is masked
            if existing and (incoming_env := data.get("env")):
                existing_env = existing.env if hasattr(existing, "env") else {}
                merged_env: dict[str, str] = {}
                for k, v in incoming_env.items():
                    if _is_masked(v) and k in existing_env:
                        merged_env[k] = existing_env[k]  # preserve
                    else:
                        merged_env[k] = v
                data["env"] = merged_env

            # Merge headers: keep existing sensitive header values when incoming is masked
            if existing and (incoming_headers := data.get("headers")):
                existing_headers = existing.headers if hasattr(existing, "headers") else {}
                merged_headers: dict[str, str] = {}
                for k, v in incoming_headers.items():
                    if _is_masked(v) and k in existing_headers:
                        merged_headers[k] = existing_headers[k]  # preserve
                    else:
                        merged_headers[k] = v
                data["headers"] = merged_headers

            # Merge OAuth: keep existing secrets when incoming is masked
            if existing and data.get("oauth"):
                existing_oauth = existing.oauth
                incoming_oauth = data["oauth"]
                if existing_oauth and hasattr(existing_oauth, "client_secret"):
                    if _is_masked(incoming_oauth.get("client_secret")):
                        incoming_oauth["client_secret"] = existing_oauth.client_secret
                if existing_oauth and hasattr(existing_oauth, "refresh_token"):
                    if _is_masked(incoming_oauth.get("refresh_token")):
                        incoming_oauth["refresh_token"] = existing_oauth.refresh_token

            mcp_servers_out[name] = data

        # Convert request to dict format for JSON serialization
        config_data = {
            "mcpServers": mcp_servers_out,
            "skills": {name: {"enabled": skill.enabled} for name, skill in current_config.skills.items()},
        }

        # Write the configuration to file
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)

        logger.info(f"MCP configuration updated and saved to: {config_path}")

        # NOTE: No need to reload/reset cache here - LangGraph Server (separate process)
        # will detect config file changes via mtime and reinitialize MCP tools automatically

        # Reload the configuration and update the global cache
        reloaded_config = reload_extensions_config()
        # Mask sensitive fields in the response
        result: dict[str, McpServerConfigResponse] = {}
        for name, server in reloaded_config.mcp_servers.items():
            data = server.model_dump()
            data["env"] = _mask_env(data.get("env") or {})
            data["headers"] = _mask_headers(data.get("headers") or {})
            data["oauth"] = _mask_oauth(server.oauth) if hasattr(server, "oauth") and server.oauth else None
            result[name] = McpServerConfigResponse(**data)
        return McpConfigResponse(mcp_servers=result)

    except Exception as e:
        logger.error(f"Failed to update MCP configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update MCP configuration: {str(e)}")

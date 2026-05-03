import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.gateway.deps import get_config
from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["models"])


# ---------------------------------------------------------------------------
# Config YAML read / write helpers
# ---------------------------------------------------------------------------


def _load_config_yaml() -> dict:
    """Load the full config.yaml as a raw dict."""
    config_path = AppConfig.resolve_config_path()
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _save_config_yaml(config_data: dict) -> Path:
    """Write the raw dict back to config.yaml.

    The AppConfig singleton detects the mtime change and automatically
    reloads when the next LangGraph run or gateway request arrives.
    """
    config_path = AppConfig.resolve_config_path()
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    logger.info(f"config.yaml written to {config_path}")
    return config_path


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ModelRequest(BaseModel):
    """Request model for creating or updating a model configuration."""

    name: str = Field(..., description="Unique identifier for the model")
    display_name: str | None = Field(None, description="Human-readable name")
    use: str = Field(..., description="Class path of the model provider, e.g. langchain_openai:ChatOpenAI")
    model: str = Field(..., description="Actual provider model identifier, e.g. gpt-4")
    api_key: str | None = Field(None, description="API key or $ENV_VAR reference")
    base_url: str | None = Field(None, description="Base URL for the provider API")
    max_tokens: int | None = Field(None, description="Maximum tokens for generation")
    temperature: float | None = Field(None, description="Sampling temperature (0-2)")
    request_timeout: float | None = Field(None, description="Request timeout in seconds")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    when_thinking_enabled: dict | None = Field(None, description="Extra settings passed to the model when thinking is enabled")
    when_thinking_disabled: dict | None = Field(None, description="Extra settings passed when thinking is disabled")


class ModelResponse(BaseModel):
    """Response model for model information (full detail)."""

    name: str = Field(..., description="Unique identifier for the model")
    display_name: str | None = Field(None, description="Human-readable name")
    use: str = Field(..., description="Class path of the model provider")
    model: str = Field(..., description="Actual provider model identifier")
    api_key: str | None = Field(None, description="API key reference")
    base_url: str | None = Field(None, description="Base URL for the provider API")
    max_tokens: int | None = Field(None, description="Maximum tokens for generation")
    temperature: float | None = Field(None, description="Sampling temperature")
    request_timeout: float | None = Field(None, description="Request timeout in seconds")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    when_thinking_enabled: dict | None = Field(None, description="Extra settings when thinking enabled")
    when_thinking_disabled: dict | None = Field(None, description="Extra settings when thinking disabled")


class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _model_config_to_response(model) -> ModelResponse:
    """Convert a ModelConfig (Pydantic) instance to a ModelResponse."""
    # ModelConfig has extra="allow", so we collect known + extra fields
    extra = getattr(model, "model_extra", {}) or {}
    return ModelResponse(
        name=model.name,
        display_name=model.display_name,
        use=model.use,
        model=model.model,
        api_key=extra.get("api_key"),
        base_url=extra.get("base_url"),
        max_tokens=extra.get("max_tokens"),
        temperature=extra.get("temperature"),
        request_timeout=extra.get("request_timeout"),
        description=model.description,
        supports_thinking=model.supports_thinking,
        supports_vision=model.supports_vision,
        supports_reasoning_effort=model.supports_reasoning_effort,
        when_thinking_enabled=model.when_thinking_enabled,
        when_thinking_disabled=model.when_thinking_disabled,
    )


def _request_to_config_dict(req: ModelRequest) -> dict:
    """Convert a ModelRequest to a dict suitable for the config.yaml models list."""
    d: dict = {
        "name": req.name,
        "use": req.use,
        "model": req.model,
    }
    if req.display_name is not None:
        d["display_name"] = req.display_name
    if req.description is not None:
        d["description"] = req.description
    if req.api_key is not None:
        d["api_key"] = req.api_key
    if req.base_url is not None:
        d["base_url"] = req.base_url
    if req.max_tokens is not None:
        d["max_tokens"] = req.max_tokens
    if req.temperature is not None:
        d["temperature"] = req.temperature
    if req.request_timeout is not None:
        d["request_timeout"] = req.request_timeout
    if req.supports_thinking:
        d["supports_thinking"] = True
    if req.supports_vision:
        d["supports_vision"] = True
    if req.supports_reasoning_effort:
        d["supports_reasoning_effort"] = True
    if req.when_thinking_enabled is not None:
        d["when_thinking_enabled"] = req.when_thinking_enabled
    if req.when_thinking_disabled is not None:
        d["when_thinking_disabled"] = req.when_thinking_disabled
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models(config: AppConfig = Depends(get_config)) -> ModelsListResponse:
    """List all available models from configuration."""
    models = [_model_config_to_response(model) for model in config.models]
    return ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
    )


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(model_name: str, config: AppConfig = Depends(get_config)) -> ModelResponse:
    """Get a specific model by name."""
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")
    return _model_config_to_response(model)


@router.post(
    "/models",
    response_model=ModelResponse,
    status_code=201,
    summary="Create Model",
    description="Add a new model configuration and persist it to config.yaml.",
)
async def create_model(req: ModelRequest, config: AppConfig = Depends(get_config)) -> ModelResponse:
    """Create a new model configuration.

    The model is appended to the models list in config.yaml. The AppConfig
    cache picks up the change automatically on the next read.
    """
    # Validate uniqueness
    if config.get_model_config(req.name) is not None:
        raise HTTPException(status_code=409, detail=f"Model '{req.name}' already exists")

    try:
        config_data = _load_config_yaml()
        models_list: list[dict] = config_data.setdefault("models", [])
        model_dict = _request_to_config_dict(req)
        models_list.append(model_dict)
        config_data["models"] = models_list
        _save_config_yaml(config_data)
        return ModelResponse(**model_dict)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create model '{req.name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create model: {str(e)}")


@router.put(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Update Model",
    description="Update an existing model configuration and persist changes to config.yaml.",
)
async def update_model(model_name: str, req: ModelRequest, config: AppConfig = Depends(get_config)) -> ModelResponse:
    """Update an existing model configuration."""
    if config.get_model_config(model_name) is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    try:
        config_data = _load_config_yaml()
        models_list: list[dict] = config_data.get("models", [])

        target_idx = None
        for i, m in enumerate(models_list):
            if isinstance(m, dict) and m.get("name") == model_name:
                target_idx = i
                break

        if target_idx is None:
            raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found in config file")

        model_dict = _request_to_config_dict(req)
        # Preserve top-level keys that the request doesn't cover
        existing = models_list[target_idx]
        for k, v in existing.items():
            if k not in model_dict and k != "name":
                model_dict[k] = v
        models_list[target_idx] = model_dict
        _save_config_yaml(config_data)
        return ModelResponse(**model_dict)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update model '{model_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update model: {str(e)}")


@router.delete(
    "/models/{model_name}",
    status_code=204,
    summary="Delete Model",
    description="Remove a model configuration from config.yaml.",
)
async def delete_model(model_name: str, config: AppConfig = Depends(get_config)):
    """Delete a model configuration."""
    if config.get_model_config(model_name) is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    try:
        config_data = _load_config_yaml()
        models_list: list[dict] = config_data.get("models", [])
        original_len = len(models_list)
        models_list = [m for m in models_list if not (isinstance(m, dict) and m.get("name") == model_name)]
        if len(models_list) == original_len:
            raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found in config file")
        config_data["models"] = models_list
        _save_config_yaml(config_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete model '{model_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {str(e)}")

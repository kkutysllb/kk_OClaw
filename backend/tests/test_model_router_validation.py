from __future__ import annotations

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import models
from kkoclaw.config.app_config import AppConfig


def _write_config(path, models_list):
    path.write_text(
        yaml.safe_dump(
            {
                "sandbox": {"use": "kkoclaw.sandbox.local:LocalSandboxProvider"},
                "models": models_list,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def _make_client(config: AppConfig) -> TestClient:
    app = FastAPI()
    app.state.config = config
    app.include_router(models.router)
    return TestClient(app)


def test_create_openai_compatible_model_rejects_missing_api_key(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    _write_config(config_path, [])
    monkeypatch.setenv("KKOCLAW_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    app_config = AppConfig.from_file(str(config_path))

    with _make_client(app_config) as client:
        response = client.post(
            "/api/models",
            json={
                "name": "deepseek-v4-flash",
                "use": "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-v4-flash",
                "base_url": "https://api.vectorengine.ai/v1",
            },
        )

    assert response.status_code == 400
    assert "api_key" in response.json()["detail"]
    assert "DEEPSEEK_API_KEY" in response.json()["detail"]


def test_update_openai_compatible_model_can_preserve_existing_api_key(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    _write_config(
        config_path,
        [
            {
                "name": "deepseek-v4-flash",
                "use": "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-v4-flash",
                "api_key": "test-key",
                "base_url": "https://api.vectorengine.ai/v1",
            }
        ],
    )
    monkeypatch.setenv("KKOCLAW_CONFIG_PATH", str(config_path))
    app_config = AppConfig.from_file(str(config_path))

    with _make_client(app_config) as client:
        response = client.put(
            "/api/models/deepseek-v4-flash",
            json={
                "name": "deepseek-v4-flash",
                "use": "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-v4-flash",
                "api_key": None,
                "base_url": "https://api.vectorengine.ai/v1",
                "request_timeout": 600,
            },
        )

    assert response.status_code == 200
    saved = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert saved["models"][0]["api_key"] == "test-key"
    assert saved["models"][0]["request_timeout"] == 600


def test_update_openai_compatible_model_rejects_missing_api_key_when_none_exists(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    _write_config(
        config_path,
        [
            {
                "name": "deepseek-v4-flash",
                "use": "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-v4-flash",
                "base_url": "https://api.vectorengine.ai/v1",
            }
        ],
    )
    monkeypatch.setenv("KKOCLAW_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    app_config = AppConfig.from_file(str(config_path))

    with _make_client(app_config) as client:
        response = client.put(
            "/api/models/deepseek-v4-flash",
            json={
                "name": "deepseek-v4-flash",
                "use": "kkoclaw.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-v4-flash",
                "api_key": None,
                "base_url": "https://api.vectorengine.ai/v1",
            },
        )

    assert response.status_code == 400
    assert "api_key" in response.json()["detail"]


def test_create_codex_cli_model_does_not_require_api_key(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    _write_config(config_path, [])
    monkeypatch.setenv("KKOCLAW_CONFIG_PATH", str(config_path))
    app_config = AppConfig.from_file(str(config_path))

    with _make_client(app_config) as client:
        response = client.post(
            "/api/models",
            json={
                "name": "codex",
                "use": "kkoclaw.models.openai_codex_provider:CodexChatModel",
                "model": "gpt-5.4",
            },
        )

    assert response.status_code == 201

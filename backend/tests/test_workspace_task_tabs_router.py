from __future__ import annotations

from uuid import UUID

from fastapi.testclient import TestClient

from app.gateway.app import create_app
from app.gateway.auth.models import User
from app.gateway.routers import workspace_task_tabs
from _router_auth_helpers import make_authed_test_app


def _user(user_id: str) -> User:
    return User(
        id=UUID(user_id),
        email=f"{user_id}@example.com",
        password_hash="x",
        system_role="user",
    )


def _client_for(user_id: str, tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("KKOCLAW_HOME", str(tmp_path))
    app = make_authed_test_app(user_factory=lambda: _user(user_id))
    app.include_router(workspace_task_tabs.router)
    return TestClient(app)


def _tab(**overrides):
    data = {
        "id": "chat:thread-123",
        "href": "/workspace/chats/thread-123",
        "kind": "chat",
        "title": "修复登录跳转",
        "subtitle": "Chat",
        "threadId": "thread-123",
        "lastActiveAt": 1710000000000,
    }
    data.update(overrides)
    return data


def test_put_then_get_workspace_task_tabs(tmp_path, monkeypatch):
    client = _client_for("11111111-1111-1111-1111-111111111111", tmp_path, monkeypatch)

    response = client.put("/api/workspace/task-tabs", json={"tabs": [_tab()]})

    assert response.status_code == 200
    assert response.json()["tabs"] == [_tab()]

    response = client.get("/api/workspace/task-tabs")

    assert response.status_code == 200
    assert response.json()["tabs"] == [_tab()]


def test_workspace_task_tabs_are_isolated_by_user(tmp_path, monkeypatch):
    user_a = _client_for("11111111-1111-1111-1111-111111111111", tmp_path, monkeypatch)
    user_b = _client_for("22222222-2222-2222-2222-222222222222", tmp_path, monkeypatch)

    response = user_a.put("/api/workspace/task-tabs", json={"tabs": [_tab()]})
    assert response.status_code == 200

    response = user_b.get("/api/workspace/task-tabs")

    assert response.status_code == 200
    assert response.json() == {"tabs": []}


def test_put_replaces_workspace_task_tabs(tmp_path, monkeypatch):
    client = _client_for("11111111-1111-1111-1111-111111111111", tmp_path, monkeypatch)
    first = _tab(id="chat:first", href="/workspace/chats/first", title="first", threadId="first")
    second = _tab(id="coding:second", href="/workspace/coding/second", kind="coding", title="second", threadId="second")

    assert client.put("/api/workspace/task-tabs", json={"tabs": [first]}).status_code == 200
    response = client.put("/api/workspace/task-tabs", json={"tabs": [second]})

    assert response.status_code == 200
    assert response.json()["tabs"] == [second]


def test_rejects_invalid_workspace_task_tab_href(tmp_path, monkeypatch):
    client = _client_for("11111111-1111-1111-1111-111111111111", tmp_path, monkeypatch)

    response = client.put("/api/workspace/task-tabs", json={"tabs": [_tab(href="https://evil.example")]})

    assert response.status_code == 422


def test_rejects_too_many_workspace_task_tabs(tmp_path, monkeypatch):
    client = _client_for("11111111-1111-1111-1111-111111111111", tmp_path, monkeypatch)
    tabs = [
        _tab(id=f"chat:{idx}", href=f"/workspace/chats/{idx}", title=f"tab {idx}", threadId=str(idx))
        for idx in range(13)
    ]

    response = client.put("/api/workspace/task-tabs", json={"tabs": tabs})

    assert response.status_code == 422


def test_workspace_task_tabs_router_is_registered_on_gateway_app():
    app = create_app()
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/workspace/task-tabs" in paths

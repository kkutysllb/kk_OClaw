from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "packages" / "harness"))


def _make_test_app() -> FastAPI:
    from app.gateway.routers import projects

    app = FastAPI()
    app.include_router(projects.router)
    return app


def test_get_project_environment_returns_git_summary(tmp_path, monkeypatch) -> None:
    from app.gateway.coding_services import ProjectService

    # ProjectService writes projects.json under ``get_paths().base_dir`` which
    # reads the KKOCLAW_HOME env var (NOT KKOCLAW_CODING_HOME). Setting both
    # keeps the coding scratch dir isolated too in case future code reads it.
    monkeypatch.setenv("KKOCLAW_HOME", str(tmp_path / "kkoclaw-state"))
    monkeypatch.setenv("KKOCLAW_CODING_HOME", str(tmp_path / "oclaw-coding"))

    project_root = tmp_path / "demo-project"
    project_root.mkdir()

    app_file = project_root / "app.py"
    app_file.write_text("print('hello')\n", encoding="utf-8")

    import subprocess

    subprocess.run(["git", "init", "-b", "main"], cwd=project_root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=project_root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=project_root, check=True, capture_output=True)
    subprocess.run(["git", "add", "app.py"], cwd=project_root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=project_root, check=True, capture_output=True)
    subprocess.run(["git", "remote", "add", "origin", "git@github.com:test/demo-project.git"], cwd=project_root, check=True, capture_output=True)

    app_file.write_text("print('hello world')\n", encoding="utf-8")

    project = ProjectService.create_project(name="Demo", path=str(project_root))

    with TestClient(_make_test_app()) as client:
      response = client.get(f"/api/projects/{project['id']}/environment")

    assert response.status_code == 200
    body = response.json()
    assert body["is_git_repo"] is True
    assert body["branch"] == "main"
    assert body["changed_files"] == 1
    assert body["additions"] >= 1
    assert body["source"]["label"] == "GitHub"
    assert body["source"]["remote"] == "git@github.com:test/demo-project.git"
    assert body["github_cli"]["available"] in {True, False}


def test_commit_and_push_endpoints_delegate_to_project_environment_service(tmp_path, monkeypatch) -> None:
    from app.gateway.coding_services import ProjectService

    monkeypatch.setenv("KKOCLAW_HOME", str(tmp_path / "kkoclaw-state"))
    monkeypatch.setenv("KKOCLAW_CODING_HOME", str(tmp_path / "oclaw-coding"))

    project_root = tmp_path / "demo-project"
    project_root.mkdir()
    project = ProjectService.create_project(name="Demo", path=str(project_root))

    called: dict[str, object] = {}

    def fake_commit(_project_path: str, message: str) -> dict[str, str]:
        called["commit"] = message
        return {
            "head": "abc12345",
            "summary": "[main abc12345] test commit",
            "message": message,
        }

    def fake_push(_project_path: str) -> dict[str, str]:
        called["push"] = True
        return {
            "branch": "main",
            "upstream": "origin/main",
            "summary": "Everything up-to-date",
        }

    monkeypatch.setattr(
        "app.gateway.routers.projects.ProjectEnvironmentService.commit_changes",
        fake_commit,
    )
    monkeypatch.setattr(
        "app.gateway.routers.projects.ProjectEnvironmentService.push_branch",
        fake_push,
    )

    with TestClient(_make_test_app()) as client:
        commit_response = client.post(
            f"/api/projects/{project['id']}/git/commit",
            json={"message": "test commit"},
        )
        push_response = client.post(f"/api/projects/{project['id']}/git/push")

    assert commit_response.status_code == 200
    assert commit_response.json()["message"] == "test commit"
    assert push_response.status_code == 200
    assert push_response.json()["upstream"] == "origin/main"
    assert called == {"commit": "test commit", "push": True}

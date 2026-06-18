from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _make_test_app() -> FastAPI:
    from app.gateway.routers import coding_skills

    app = FastAPI()
    app.include_router(coding_skills.router)
    return app


def test_list_coding_skills_returns_project_and_global_skills(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    project_skill = project / ".oclaw-coding" / "skills" / "review"
    project_skill.mkdir(parents=True)
    (project_skill / "skill.json").write_text(
        json.dumps(
            {
                "id": "review",
                "name": "Review",
                "description": "Review code changes.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["review"]},
                "tools": ["read_file_lines"],
                "permissions": {"write": False},
            }
        ),
        encoding="utf-8",
    )
    (project_skill / "SKILL.md").write_text("# Review\nCheck behavior.\n", encoding="utf-8")

    global_skill = home / ".oclaw-coding" / "skills" / "tdd"
    global_skill.mkdir(parents=True)
    (global_skill / "SKILL.md").write_text(
        "---\n"
        "name: TDD\n"
        "description: Write tests first.\n"
        "keywords:\n"
        "  - test\n"
        "---\n"
        "# TDD\n",
        encoding="utf-8",
    )

    with TestClient(_make_test_app()) as client:
        response = client.get("/api/coding/skills", params={"project_root": str(project)})

    assert response.status_code == 200
    assert response.json()["skills"] == [
        {
            "id": "review",
            "name": "Review",
            "description": "Review code changes.",
            "scope": "project",
            "legacy": False,
            "activation_keywords": ["review"],
            "always_activate": False,
            "allowed_tools": ["read_file_lines"],
            "permissions": {"write": False},
            "skill_file": str(project_skill / "SKILL.md"),
            "enabled": True,
            "manifest_errors": [],
            "commands": [],
            "ui": None,
        },
        {
            "id": "tdd",
            "name": "TDD",
            "description": "Write tests first.",
            "scope": "global",
            "legacy": True,
            "activation_keywords": ["test"],
            "always_activate": False,
            "allowed_tools": [],
            "permissions": None,
            "skill_file": str(global_skill / "SKILL.md"),
            "enabled": True,
            "manifest_errors": [],
            "commands": [],
            "ui": None,
        },
    ]


def test_get_coding_skill_detail_returns_instruction_content(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: Review\n"
        "description: Review code changes.\n"
        "---\n"
        "# Review\n"
        "Check behavior and tests.\n",
        encoding="utf-8",
    )

    with TestClient(_make_test_app()) as client:
        response = client.get("/api/coding/skills/review", params={"project_root": str(project)})

    assert response.status_code == 200
    body = response.json()
    assert body["skill"]["id"] == "review"
    assert body["instructions"] == "# Review\nCheck behavior and tests."


def test_get_coding_skill_detail_returns_404_for_missing_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.get("/api/coding/skills/missing", params={"project_root": str(project)})

    assert response.status_code == 404


def test_coding_skill_service_does_not_use_global_skill_storage(tmp_path, monkeypatch):
    from app.gateway.coding_skill_services import CodingSkillService

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: Review\n"
        "description: Review code changes.\n"
        "---\n",
        encoding="utf-8",
    )

    def fail_if_global_storage_is_used(*args, **kwargs):
        raise AssertionError("Coding skills API must not use global skills storage")

    monkeypatch.setattr(
        "kkoclaw.skills.storage.get_or_new_skill_storage",
        fail_if_global_storage_is_used,
    )

    skills = CodingSkillService.list_skills(project_root=str(project))

    assert [skill["id"] for skill in skills] == ["review"]


def test_create_project_coding_skill_writes_manifest_and_instructions(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.post(
            "/api/coding/skills",
            json={
                "project_root": str(project),
                "id": "review-helper",
                "name": "Review Helper",
                "description": "Review code changes.",
                "instructions": "# Review Helper\nCheck behavior and tests.\n",
                "activation_keywords": ["review"],
                "allowed_tools": ["read_file_lines"],
                "permissions": {"write": False},
            },
        )

    assert response.status_code == 201
    body = response.json()
    assert body["skill"]["id"] == "review-helper"
    assert body["instructions"] == "# Review Helper\nCheck behavior and tests."

    skill_dir = project / ".oclaw-coding" / "skills" / "review-helper"
    manifest = json.loads((skill_dir / "skill.json").read_text(encoding="utf-8"))
    assert manifest == {
        "id": "review-helper",
        "name": "Review Helper",
        "description": "Review code changes.",
        "entry": "SKILL.md",
        "activation": {"keywords": ["review"], "always": False},
        "tools": ["read_file_lines"],
        "permissions": {"write": False},
    }
    assert (skill_dir / "SKILL.md").read_text(encoding="utf-8") == "# Review Helper\nCheck behavior and tests.\n"


def test_update_project_coding_skill_overwrites_existing_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    skill_dir = project / ".oclaw-coding" / "skills" / "review-helper"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "review-helper",
                "name": "Old",
                "description": "Old description.",
                "entry": "SKILL.md",
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Old\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.put(
            "/api/coding/skills/review-helper",
            json={
                "project_root": str(project),
                "name": "Review Helper",
                "description": "Review code changes.",
                "instructions": "# Updated\n",
                "activation_keywords": ["review", "diff"],
                "always_activate": True,
                "allowed_tools": ["read_file_lines", "search_code"],
                "permissions": {"network": False, "write": False},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["skill"]["name"] == "Review Helper"
    assert body["skill"]["activation_keywords"] == ["review", "diff"]
    assert body["skill"]["always_activate"] is True
    assert body["instructions"] == "# Updated"
    assert (skill_dir / "SKILL.md").read_text(encoding="utf-8") == "# Updated\n"


def test_update_project_coding_skill_does_not_modify_global_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    global_skill_dir = home / ".oclaw-coding" / "skills" / "review-helper"
    global_skill_dir.mkdir(parents=True)
    (global_skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: Global Review\n"
        "description: Global skill.\n"
        "---\n"
        "# Global\n",
        encoding="utf-8",
    )
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.put(
            "/api/coding/skills/review-helper",
            json={
                "project_root": str(project),
                "name": "Project Review",
                "description": "Project skill.",
                "instructions": "# Project\n",
            },
        )

    assert response.status_code == 200
    assert (global_skill_dir / "SKILL.md").read_text(encoding="utf-8").endswith("# Global\n")
    assert (project / ".oclaw-coding" / "skills" / "review-helper" / "SKILL.md").read_text(encoding="utf-8") == "# Project\n"


def test_create_project_coding_skill_rejects_invalid_id(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.post(
            "/api/coding/skills",
            json={
                "project_root": str(project),
                "id": "../escape",
                "name": "Bad",
                "description": "Bad skill.",
                "instructions": "# Bad\n",
            },
        )

    assert response.status_code == 400


def test_create_project_coding_skill_requires_project_root(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.post(
            "/api/coding/skills",
            json={
                "id": "review",
                "name": "Review",
                "description": "Review code.",
                "instructions": "# Review\n",
            },
        )

    assert response.status_code == 400


def test_delete_project_coding_skill_removes_project_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    skill_dir = project / ".oclaw-coding" / "skills" / "review-helper"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "review-helper",
                "name": "Review Helper",
                "description": "Review code changes.",
                "entry": "SKILL.md",
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.delete("/api/coding/skills/review-helper", params={"project_root": str(project)})

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "skill_id": "review-helper"}
    assert not skill_dir.exists()


def test_delete_project_coding_skill_does_not_delete_global_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    global_skill_dir = home / ".oclaw-coding" / "skills" / "review-helper"
    global_skill_dir.mkdir(parents=True)
    (global_skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: Global Review\n"
        "description: Global skill.\n"
        "---\n"
        "# Global\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.delete("/api/coding/skills/review-helper", params={"project_root": str(project)})

    assert response.status_code == 404
    assert global_skill_dir.exists()


def test_delete_project_coding_skill_requires_project_root(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    with TestClient(_make_test_app()) as client:
        response = client.delete("/api/coding/skills/review-helper")

    assert response.status_code == 400

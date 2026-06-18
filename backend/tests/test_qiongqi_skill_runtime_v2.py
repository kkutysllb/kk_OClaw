from __future__ import annotations

import json


def test_coding_skill_manifest_v2_parses_safe_runtime_metadata(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "review",
                "name": "Review",
                "description": "Review code changes.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["review"]},
                "tools": ["read_file_lines"],
                "permissions": {"write": False},
                "commands": [
                    {"id": "check", "title": "Check", "description": "Run review checks."},
                    {"id": "../bad", "title": "Bad"},
                ],
                "ui": {
                    "views": [{"id": "panel", "title": "Review Panel", "type": "panel"}],
                    "unsafe": {"html": "<script>bad()</script>"},
                },
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\n", encoding="utf-8")

    [skill] = CodingSkillRegistry.discover(project_root=str(project))

    assert skill.enabled is True
    assert skill.manifest_errors == ()
    assert skill.commands == ({"id": "check", "title": "Check", "description": "Run review checks."},)
    assert skill.ui == {"views": [{"id": "panel", "title": "Review Panel", "type": "panel"}]}
    assert skill.allowed_tools == ("read_file_lines",)


def test_coding_skill_registry_reports_invalid_manifest_without_loading_runtime(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "bad"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "../bad",
                "name": "",
                "description": "",
                "entry": "../SKILL.md",
                "tools": ["read_file_lines", 42],
                "permissions": {"network": "no"},
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Bad\n", encoding="utf-8")

    [skill] = CodingSkillRegistry.discover(project_root=str(project))

    assert skill.id == "bad"
    assert skill.enabled is False
    assert skill.allowed_tools == ()
    assert skill.permissions == {}
    assert any("description is required" in error for error in skill.manifest_errors)
    assert any("entry must stay inside the skill directory" in error for error in skill.manifest_errors)
    assert any("tools must be strings" in error for error in skill.manifest_errors)
    assert any("permissions values must be booleans" in error for error in skill.manifest_errors)


def test_coding_skill_enable_disable_state_is_scoped_by_project_and_global_roots(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry, CodingSkillStateStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    project_skill = project / ".oclaw-coding" / "skills" / "review"
    project_skill.mkdir(parents=True)
    (project_skill / "SKILL.md").write_text(
        "---\nname: Review\ndescription: Project review.\n---\n",
        encoding="utf-8",
    )
    global_skill = home / ".oclaw-coding" / "skills" / "tdd"
    global_skill.mkdir(parents=True)
    (global_skill / "SKILL.md").write_text(
        "---\nname: TDD\ndescription: Global TDD.\n---\n",
        encoding="utf-8",
    )

    state = CodingSkillStateStore()
    state.set_enabled("review", scope="project", enabled=False, project_root=str(project))
    state.set_enabled("tdd", scope="global", enabled=False)

    skills = CodingSkillRegistry.discover(project_root=str(project))
    by_id = {skill.id: skill for skill in skills}

    assert by_id["review"].enabled is False
    assert by_id["tdd"].enabled is False
    assert json.loads((project / ".oclaw-coding" / "skill-state.json").read_text(encoding="utf-8")) == {
        "skills": {"review": {"enabled": False}}
    }
    assert json.loads((home / ".oclaw-coding" / "skill-state.json").read_text(encoding="utf-8")) == {
        "skills": {"tdd": {"enabled": False}}
    }


def test_qiongqi_engine_does_not_activate_disabled_or_invalid_skills(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.skills import CodingSkillStateStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    disabled = project / ".oclaw-coding" / "skills" / "disabled"
    disabled.mkdir(parents=True)
    (disabled / "skill.json").write_text(
        json.dumps(
            {
                "id": "disabled",
                "name": "Disabled",
                "description": "Disabled skill.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["review"]},
            }
        ),
        encoding="utf-8",
    )
    (disabled / "SKILL.md").write_text("# Disabled\n", encoding="utf-8")

    invalid = project / ".oclaw-coding" / "skills" / "invalid"
    invalid.mkdir(parents=True)
    (invalid / "skill.json").write_text(
        json.dumps({"id": "../invalid", "name": "", "description": "", "entry": "../SKILL.md"}),
        encoding="utf-8",
    )
    (invalid / "SKILL.md").write_text("# Invalid\n", encoding="utf-8")

    enabled = project / ".oclaw-coding" / "skills" / "enabled"
    enabled.mkdir(parents=True)
    (enabled / "skill.json").write_text(
        json.dumps(
            {
                "id": "enabled",
                "name": "Enabled",
                "description": "Enabled skill.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["review"]},
            }
        ),
        encoding="utf-8",
    )
    (enabled / "SKILL.md").write_text("# Enabled\n", encoding="utf-8")

    CodingSkillStateStore().set_enabled("disabled", scope="project", enabled=False, project_root=str(project))

    engine = QiongqiEngine.from_runtime(project_root=str(project))

    assert [skill.id for skill in engine.skills] == ["disabled", "enabled", "invalid"]
    assert [active.skill.id for active in engine.activate_skills_for_task("please review")] == ["enabled"]


def test_coding_skill_service_updates_enable_state_and_exposes_v2_metadata(tmp_path, monkeypatch):
    from app.gateway.coding_skill_services import CodingSkillService

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "review",
                "name": "Review",
                "description": "Review code.",
                "entry": "SKILL.md",
                "commands": [{"id": "check", "title": "Check"}],
                "ui": {"views": [{"id": "panel", "title": "Panel"}]},
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\n", encoding="utf-8")

    detail = CodingSkillService.get_skill("review", project_root=str(project))
    assert detail is not None
    assert detail["skill"]["enabled"] is True
    assert detail["skill"]["commands"] == [{"id": "check", "title": "Check"}]
    assert detail["skill"]["ui"] == {"views": [{"id": "panel", "title": "Panel"}]}

    updated = CodingSkillService.set_skill_enabled(project_root=str(project), skill_id="review", scope="project", enabled=False)
    assert updated["skill"]["enabled"] is False

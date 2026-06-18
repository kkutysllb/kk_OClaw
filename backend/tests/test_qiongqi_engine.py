from __future__ import annotations

import json


def test_qiongqi_engine_builds_session_prompt_and_middlewares(tmp_path, monkeypatch):
    from kkoclaw.agents.coding_agent.skills_middleware import CodingSkillsMiddleware
    from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

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
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\nCheck behavior.\n", encoding="utf-8")

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-1")
    session = engine.session

    assert session.context.project_root == str(project)
    assert session.context.scratch_root == str(home / ".oclaw-coding" / "thread-1" / "workspace")
    assert [skill.id for skill in session.skills] == ["review"]

    prompt = engine.build_system_prompt(
        model_display_name="Test Model",
        is_plan_mode=True,
        subagent_enabled=True,
        max_concurrent_subagents=2,
    )
    assert "Test Model" in prompt
    assert "## Coding Skills" in prompt
    assert "Review code changes." in prompt

    active = engine.activate_skills_for_task("please review this diff")
    assert [item.skill.id for item in active] == ["review"]
    assert engine.active_skill_policy_for_task("please review this diff") == [
        {
            "id": "review",
            "allowed_tools": ["read_file_lines"],
            "permissions": {"write": False},
        }
    ]

    middlewares = engine.build_agent_middlewares()
    assert any(isinstance(middleware, CodingSkillsMiddleware) for middleware in middlewares)
    assert any(isinstance(middleware, CodingToolPolicyMiddleware) for middleware in middlewares)


def test_qiongqi_engine_replaces_legacy_coding_engine_alias(tmp_path, monkeypatch):
    from kkoclaw.coding_core.engine import CodingEngine
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = CodingEngine.from_runtime(project_root=str(project), thread_id="thread-2")

    assert isinstance(engine, QiongqiEngine)


def test_qiongqi_roi_separates_stable_prompt_from_dynamic_context(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

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
        "# Review\n",
        encoding="utf-8",
    )

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")

    stable_prompt = engine.build_stable_system_prompt(model_display_name="Test Model")
    dynamic_context = engine.build_dynamic_context()

    assert str(project) not in stable_prompt
    assert "Review code changes." not in stable_prompt
    assert str(project) in dynamic_context
    assert "Review code changes." in dynamic_context
    assert "isolated scratch workspace" in dynamic_context


def test_qiongqi_roi_fingerprints_are_stable_for_tool_order(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))
    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")

    prompt_fingerprint = engine.immutable_prefix_fingerprint(
        stable_prompt="stable",
        tools=[{"name": "b", "inputSchema": {"type": "object"}}, {"name": "a", "inputSchema": {"type": "object"}}],
    )
    reordered_fingerprint = engine.immutable_prefix_fingerprint(
        stable_prompt="stable",
        tools=[{"name": "a", "inputSchema": {"type": "object"}}, {"name": "b", "inputSchema": {"type": "object"}}],
    )
    changed_fingerprint = engine.immutable_prefix_fingerprint(
        stable_prompt="changed",
        tools=[{"name": "a", "inputSchema": {"type": "object"}}, {"name": "b", "inputSchema": {"type": "object"}}],
    )

    assert prompt_fingerprint == reordered_fingerprint
    assert prompt_fingerprint != changed_fingerprint
    assert len(prompt_fingerprint) == 64


def test_qiongqi_roi_report_records_prompt_and_tool_fingerprints(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))
    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")

    report = engine.build_roi_report(
        stable_prompt="stable",
        tools=[{"name": "read_file_lines"}, {"name": "bash"}],
        visible_tools=[{"name": "read_file_lines"}],
    )

    assert report.stable_prompt_fingerprint
    assert report.tool_catalog_fingerprint
    assert report.full_tool_count == 2
    assert report.visible_tool_count == 1
    assert report.hidden_tool_count == 1


def test_qiongqi_roi_report_can_be_serialized_to_run_metadata(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))
    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")

    report = engine.build_roi_report(
        stable_prompt=engine.build_stable_system_prompt(),
        tools=[{"name": "read_file_lines"}],
    )

    metadata = engine.roi_metadata(report)

    assert metadata == {
        "stable_prompt_fingerprint": report.stable_prompt_fingerprint,
        "tool_catalog_fingerprint": report.tool_catalog_fingerprint,
        "immutable_prefix_fingerprint": report.immutable_prefix_fingerprint,
        "full_tool_count": 1,
        "visible_tool_count": 1,
        "hidden_tool_count": 0,
    }

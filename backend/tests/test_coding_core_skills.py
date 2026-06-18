from __future__ import annotations

import json
from types import SimpleNamespace

from kkoclaw.agents.coding_agent.prompt import apply_coding_prompt_template


def test_coding_engine_builds_isolated_runtime_context(tmp_path, monkeypatch):
    from kkoclaw.coding_core.engine import CodingEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "project-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: Project Skill\n"
        "description: Project-local coding behavior.\n"
        "---\n",
        encoding="utf-8",
    )

    engine = CodingEngine.from_runtime(project_root=str(project), thread_id="thread-123")

    assert engine.context.project_root == str(project)
    assert engine.context.thread_id == "thread-123"
    assert engine.context.scratch_root == str(home / ".oclaw-coding" / "thread-123" / "workspace")
    assert [skill.id for skill in engine.skills] == ["project-skill"]


def test_coding_skill_registry_loads_project_and_home_roots(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    project_skill = project / ".oclaw-coding" / "skills" / "debugging"
    project_skill.mkdir(parents=True)
    (project_skill / "SKILL.md").write_text(
        "---\n"
        "name: Debugging\n"
        "description: Isolate failures in coding tasks.\n"
        "---\n"
        "# Debugging\n",
        encoding="utf-8",
    )

    global_skill = home / ".oclaw-coding" / "skills" / "tdd"
    global_skill.mkdir(parents=True)
    (global_skill / "skill.json").write_text(
        json.dumps(
            {
                "id": "tdd",
                "name": "TDD",
                "description": "Write a failing test before implementation.",
                "entry": "SKILL.md",
            }
        ),
        encoding="utf-8",
    )
    (global_skill / "SKILL.md").write_text("# TDD\n", encoding="utf-8")

    global_duplicate = home / ".oclaw-coding" / "skills" / "debugging"
    global_duplicate.mkdir(parents=True)
    (global_duplicate / "SKILL.md").write_text(
        "---\n"
        "name: Global Debugging\n"
        "description: This should be shadowed by the project skill.\n"
        "---\n",
        encoding="utf-8",
    )

    skills = CodingSkillRegistry.discover(project_root=str(project))

    assert [skill.id for skill in skills] == ["debugging", "tdd"]
    assert [skill.scope for skill in skills] == ["project", "global"]
    assert skills[0].name == "Debugging"
    assert skills[0].skill_file == project_skill / "SKILL.md"
    assert skills[1].skill_file == global_skill / "SKILL.md"


def test_coding_skill_registry_loads_builtin_public_coding_skills(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry

    home = tmp_path / "home"
    skills_root = tmp_path / "skills"
    builtin_skill = skills_root / "public" / "coding" / "implement"
    builtin_skill.mkdir(parents=True)
    (builtin_skill / "SKILL.md").write_text(
        "---\n"
        "name: Implement\n"
        "description: Implement focused coding changes.\n"
        "---\n"
        "# Implement\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("KKOCLAW_SKILLS_PATH", str(skills_root))

    skills = CodingSkillRegistry.discover(project_root=None)

    assert [skill.id for skill in skills] == ["implement"]
    assert skills[0].scope == "global"
    assert skills[0].skill_file == builtin_skill / "SKILL.md"


def test_coding_builtin_public_skills_include_core_and_meta_engineering_skills(monkeypatch):
    from pathlib import Path

    from kkoclaw.coding_core.skills import CodingSkillRegistry

    repo_root = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("KKOCLAW_SKILLS_PATH", str(repo_root / "skills"))

    skills = CodingSkillRegistry.discover(project_root=None)
    builtin_ids = [skill.id for skill in skills if "/skills/public/coding/" in str(skill.skill_file)]

    assert len(builtin_ids) >= 59
    assert {
        "acceptance-criteria",
        "api-design",
        "architecture",
        "build-system",
        "ci-cd",
        "code-review",
        "context-management",
        "database",
        "debug",
        "deployment",
        "dependency-upgrade",
        "diff-analysis",
        "docs",
        "environment-setup",
        "fastapi-backend",
        "frontend-engineering",
        "handoff-docs",
        "implement",
        "observability",
        "operations-runbook",
        "patch-authoring",
        "performance",
        "playwright-verification",
        "product-spec",
        "project-delivery-workflow",
        "project-scaffolding",
        "pr-review-advanced",
        "qa-test-plan",
        "qiongqi-roi",
        "refactor",
        "release-engineering",
        "requirements-analysis",
        "rollback-recovery",
        "security-hardening",
        "security-review",
        "scratch-workspace",
        "state-management",
        "task-decomposition",
        "technical-design",
        "test-writer",
        "typescript",
        "ui-polish",
        "using-superpowers",
        "verification-before-completion",
        "vertical-slice-development",
        "web-accessibility",
        "webapp-testing",
        "workflow-automation",
    }.issubset(set(builtin_ids))


def test_coding_skill_registry_parses_manifest_activation_metadata(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkillRegistry

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    skill_dir = project / ".oclaw-coding" / "skills" / "test-writer"
    skill_dir.mkdir(parents=True)
    (skill_dir / "skill.json").write_text(
        json.dumps(
            {
                "id": "test-writer",
                "name": "Test Writer",
                "description": "Write focused regression tests.",
                "entry": "SKILL.md",
                "activation": {
                    "keywords": ["test", "pytest", "regression"],
                    "always": False,
                },
                "tools": ["read_file_range", "apply_diff"],
                "permissions": {"network": False},
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Test Writer\n", encoding="utf-8")

    [skill] = CodingSkillRegistry.discover(project_root=str(project))

    assert skill.activation_keywords == ("test", "pytest", "regression")
    assert skill.always_activate is False
    assert skill.allowed_tools == ("read_file_range", "apply_diff")
    assert skill.permissions == {"network": False}


def test_coding_engine_activates_matching_skills_and_loads_instructions(tmp_path, monkeypatch):
    from kkoclaw.agents.coding_agent.prompt import apply_coding_prompt_template
    from kkoclaw.coding_core.engine import CodingEngine

    home = tmp_path / "home"
    project = tmp_path / "project"
    monkeypatch.setenv("HOME", str(home))

    test_skill = project / ".oclaw-coding" / "skills" / "test-writer"
    test_skill.mkdir(parents=True)
    (test_skill / "skill.json").write_text(
        json.dumps(
            {
                "id": "test-writer",
                "name": "Test Writer",
                "description": "Write focused regression tests.",
                "entry": "SKILL.md",
                "activation": {"keywords": ["pytest", "regression"]},
            }
        ),
        encoding="utf-8",
    )
    (test_skill / "SKILL.md").write_text(
        "---\n"
        "name: Test Writer\n"
        "description: Write focused regression tests.\n"
        "---\n"
        "# Test Writer\n"
        "Always write the failing test first.\n",
        encoding="utf-8",
    )

    inactive_skill = project / ".oclaw-coding" / "skills" / "docs"
    inactive_skill.mkdir(parents=True)
    (inactive_skill / "SKILL.md").write_text(
        "---\n"
        "name: Docs\n"
        "description: Write documentation.\n"
        "---\n"
        "# Docs\n"
        "Only documentation guidance.\n",
        encoding="utf-8",
    )

    engine = CodingEngine.from_runtime(project_root=str(project))
    active = engine.activate_skills("Please add a pytest regression for this bug")
    prompt = apply_coding_prompt_template(
        coding_skills=engine.skills,
        active_skill_instructions=active,
    )

    assert [item.skill.id for item in active] == ["test-writer"]
    assert "## Active Coding Skill Instructions" in prompt
    assert "Always write the failing test first." in prompt
    assert "Only documentation guidance." not in prompt


def test_coding_skills_middleware_injects_active_skill_reminder(tmp_path, monkeypatch):
    from langchain_core.messages import HumanMessage

    from kkoclaw.agents.coding_agent.skills_middleware import CodingSkillsMiddleware
    from kkoclaw.coding_core.engine import CodingEngine

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
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\nCheck behavior and tests first.\n", encoding="utf-8")

    middleware = CodingSkillsMiddleware(CodingEngine.from_runtime(project_root=str(project)))
    update = middleware.before_model({"messages": [HumanMessage(content="please review this diff")]}, runtime=None)

    assert update is not None
    [reminder] = update["messages"]
    assert reminder.additional_kwargs["hide_from_ui"] is True
    assert reminder.additional_kwargs["coding_skills_reminder"] is True
    assert "Check behavior and tests first." in reminder.content


def test_coding_skills_middleware_persists_qiongqi_session_boundary(tmp_path, monkeypatch):
    from langchain_core.messages import HumanMessage

    from kkoclaw.agents.coding_agent.skills_middleware import CodingSkillsMiddleware
    from kkoclaw.coding_core.engine import CodingEngine

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
    (skill_dir / "SKILL.md").write_text("# Review\nCheck behavior and tests first.\n", encoding="utf-8")

    middleware = CodingSkillsMiddleware(
        CodingEngine.from_runtime(project_root=str(project), thread_id="thread-skills")
    )
    update = middleware.before_model({"messages": [HumanMessage(content="please review this diff")]}, runtime=None)

    assert update is not None
    payload = json.loads((home / ".oclaw-coding" / "thread-skills" / "session.json").read_text(encoding="utf-8"))
    assert payload["project_root"] == str(project)
    assert payload["scratch_root"] == str(home / ".oclaw-coding" / "thread-skills" / "workspace")
    assert payload["active_coding_skills"] == [
        {"id": "review", "name": "Review", "scope": "project", "instruction_chars": 40}
    ]
    assert payload["tool_policy"] == [
        {"id": "review", "allowed_tools": ["read_file_lines"], "permissions": {"write": False}}
    ]


def test_coding_skills_middleware_does_not_duplicate_current_reminder(tmp_path, monkeypatch):
    from langchain_core.messages import HumanMessage

    from kkoclaw.agents.coding_agent.skills_middleware import CodingSkillsMiddleware
    from kkoclaw.coding_core.engine import CodingEngine

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
            }
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Review\nCheck behavior and tests first.\n", encoding="utf-8")

    middleware = CodingSkillsMiddleware(CodingEngine.from_runtime(project_root=str(project)))
    user_message = HumanMessage(content="please review this diff")
    first_update = middleware.before_model({"messages": [user_message]}, runtime=None)
    assert first_update is not None

    second_update = middleware.before_model(
        {"messages": [user_message, first_update["messages"][0]]},
        runtime=None,
    )

    assert second_update is None


def test_coding_tool_policy_filters_model_tools_for_active_skill(tmp_path):
    from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware
    from kkoclaw.coding_core.skills import ActiveCodingSkill, CodingSkill

    skill_dir = tmp_path / "skills" / "reader"
    skill_dir.mkdir(parents=True)
    skill = CodingSkill(
        id="reader",
        name="Reader",
        description="Read only.",
        skill_dir=skill_dir,
        skill_file=skill_dir / "SKILL.md",
        scope="project",
        allowed_tools=("read_file_range",),
    )
    middleware = CodingToolPolicyMiddleware(lambda _state: [{"id": "reader", "allowed_tools": list(skill.allowed_tools)}])
    request = SimpleNamespace(
        state={"messages": []},
        tools=[SimpleNamespace(name="read_file_range"), SimpleNamespace(name="bash")],
        override=lambda **kwargs: SimpleNamespace(**kwargs),
    )

    filtered = middleware._filter_model_tools(request)

    assert [tool.name for tool in filtered.tools] == ["read_file_range"]


def test_coding_tool_policy_blocks_disallowed_tool_calls(tmp_path):
    from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware
    from kkoclaw.coding_core.skills import ActiveCodingSkill, CodingSkill

    skill_dir = tmp_path / "skills" / "reader"
    skill_dir.mkdir(parents=True)
    skill = CodingSkill(
        id="reader",
        name="Reader",
        description="Read only.",
        skill_dir=skill_dir,
        skill_file=skill_dir / "SKILL.md",
        scope="project",
        allowed_tools=("read_file_range",),
    )
    middleware = CodingToolPolicyMiddleware(lambda _state: [{"id": "reader", "allowed_tools": list(skill.allowed_tools)}])
    request = SimpleNamespace(
        state={"messages": []},
        tool_call={"name": "bash", "id": "call-1"},
    )

    blocked = middleware._blocked_tool_message(request)

    assert blocked is not None
    assert blocked.name == "bash"
    assert blocked.tool_call_id == "call-1"
    assert blocked.status == "error"
    assert "not allowed by active Coding skills" in blocked.content


def test_coding_tool_policy_filters_tools_by_permissions():
    from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware

    middleware = CodingToolPolicyMiddleware(
        lambda _state: [
            {
                "id": "offline-review",
                "permissions": {
                    "network": False,
                    "bash": False,
                    "write": False,
                },
            }
        ]
    )
    request = SimpleNamespace(
        state={"messages": []},
        tools=[
            SimpleNamespace(name="read_file_lines"),
            SimpleNamespace(name="web_search"),
            SimpleNamespace(name="bash"),
            SimpleNamespace(name="apply_diff"),
        ],
        override=lambda **kwargs: SimpleNamespace(**kwargs),
    )

    filtered = middleware._filter_model_tools(request)

    assert [tool.name for tool in filtered.tools] == ["read_file_lines"]


def test_coding_tool_policy_blocks_tool_calls_by_permissions():
    from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware

    middleware = CodingToolPolicyMiddleware(
        lambda _state: [
            {
                "id": "offline-review",
                "permissions": {
                    "network": False,
                    "bash": False,
                    "write": False,
                },
            }
        ]
    )

    for tool_name in ("web_search", "bash", "apply_diff"):
        blocked = middleware._blocked_tool_message(
            SimpleNamespace(
                state={"messages": []},
                tool_call={"name": tool_name, "id": f"call-{tool_name}"},
            )
        )
        assert blocked is not None
        assert blocked.status == "error"
        assert "blocked by active Coding skill permissions" in blocked.content


def test_coding_prompt_uses_coding_skills_not_global_skills(tmp_path, monkeypatch):
    from kkoclaw.coding_core.skills import CodingSkill

    def fail_if_global_skill_loader_is_called(*args, **kwargs):
        raise AssertionError("Coding Agent must not load lead/global skills")

    monkeypatch.setattr(
        "kkoclaw.agents.lead_agent.prompt.get_enabled_skills_for_config",
        fail_if_global_skill_loader_is_called,
    )

    skill_dir = tmp_path / "skills" / "review"
    skill_dir.mkdir(parents=True)
    skill = CodingSkill(
        id="review",
        name="Review",
        description="Review coding changes before completion.",
        skill_dir=skill_dir,
        skill_file=skill_dir / "SKILL.md",
        scope="project",
    )

    prompt = apply_coding_prompt_template(coding_skills=[skill])

    assert "## Coding Skills" in prompt
    assert "**Review**" in prompt
    assert "Review coding changes before completion." in prompt
    assert "lead/global" not in prompt

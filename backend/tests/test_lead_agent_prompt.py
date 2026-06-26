import threading
from types import SimpleNamespace

import anyio

from kkoclaw.agents.lead_agent import prompt as prompt_module
from kkoclaw.config.subagents_config import CustomSubagentConfig, SubagentsAppConfig
from kkoclaw.skills.types import Skill


def _set_skills_cache_state(*, skills=None, active=False, version=0):
    prompt_module._get_cached_skills_prompt_section.cache_clear()
    with prompt_module._enabled_skills_lock:
        prompt_module._enabled_skills_cache = skills
        prompt_module._enabled_skills_refresh_active = active
        prompt_module._enabled_skills_refresh_version = version
        prompt_module._enabled_skills_refresh_event.clear()


def test_build_custom_mounts_section_returns_empty_when_no_mounts(monkeypatch):
    config = SimpleNamespace(sandbox=SimpleNamespace(mounts=[]))
    monkeypatch.setattr("kkoclaw.config.get_app_config", lambda: config)

    assert prompt_module._build_custom_mounts_section() == ""


def test_build_custom_mounts_section_lists_configured_mounts(monkeypatch):
    mounts = [
        SimpleNamespace(container_path="/home/user/shared", read_only=False),
        SimpleNamespace(container_path="/mnt/reference", read_only=True),
    ]
    config = SimpleNamespace(sandbox=SimpleNamespace(mounts=mounts))
    monkeypatch.setattr("kkoclaw.config.get_app_config", lambda: config)

    section = prompt_module._build_custom_mounts_section()

    assert "**Custom Mounted Directories:**" in section
    assert "`/home/user/shared`" in section
    assert "read-write" in section
    assert "`/mnt/reference`" in section
    assert "read-only" in section


def test_build_custom_mounts_section_uses_explicit_app_config_without_global_read(monkeypatch):
    mounts = [SimpleNamespace(container_path="/home/user/shared", read_only=False)]
    config = SimpleNamespace(sandbox=SimpleNamespace(mounts=mounts))

    def fail_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when app_config is explicit")

    monkeypatch.setattr("kkoclaw.config.get_app_config", fail_get_app_config)

    section = prompt_module._build_custom_mounts_section(app_config=config)

    assert "`/home/user/shared`" in section
    assert "read-write" in section


def test_apply_prompt_template_includes_custom_mounts(monkeypatch):
    mounts = [SimpleNamespace(container_path="/home/user/shared", read_only=False)]
    config = SimpleNamespace(
        sandbox=SimpleNamespace(mounts=mounts),
        skills=SimpleNamespace(container_path="/mnt/skills"),
    )
    monkeypatch.setattr("kkoclaw.config.get_app_config", lambda: config)
    monkeypatch.setattr(prompt_module, "_get_enabled_skills", lambda: [])
    monkeypatch.setattr(prompt_module, "get_deferred_tools_prompt_section", lambda **kwargs: "")
    monkeypatch.setattr(prompt_module, "_build_acp_section", lambda **kwargs: "")
    monkeypatch.setattr(prompt_module, "_get_memory_context", lambda agent_name=None, **kwargs: "")
    monkeypatch.setattr(prompt_module, "get_agent_soul", lambda agent_name=None: "")

    prompt = prompt_module.apply_prompt_template()

    assert "`/home/user/shared`" in prompt
    assert "Custom Mounted Directories" in prompt


def test_apply_prompt_template_includes_relative_path_guidance(monkeypatch):
    config = SimpleNamespace(
        sandbox=SimpleNamespace(mounts=[]),
        skills=SimpleNamespace(container_path="/mnt/skills"),
    )
    monkeypatch.setattr("kkoclaw.config.get_app_config", lambda: config)
    monkeypatch.setattr(prompt_module, "_get_enabled_skills", lambda: [])
    monkeypatch.setattr(prompt_module, "get_deferred_tools_prompt_section", lambda **kwargs: "")
    monkeypatch.setattr(prompt_module, "_build_acp_section", lambda **kwargs: "")
    monkeypatch.setattr(prompt_module, "_get_memory_context", lambda agent_name=None, **kwargs: "")
    monkeypatch.setattr(prompt_module, "get_agent_soul", lambda agent_name=None: "")

    prompt = prompt_module.apply_prompt_template()

    assert "Treat `/mnt/user-data/workspace` as your default current working directory" in prompt
    assert "`hello.txt`, `../uploads/data.csv`, and `../outputs/report.md`" in prompt


def test_apply_prompt_template_threads_explicit_app_config_without_global_config(monkeypatch):
    mounts = [SimpleNamespace(container_path="/home/user/shared", read_only=False)]
    explicit_config = SimpleNamespace(
        sandbox=SimpleNamespace(mounts=mounts),
        skills=SimpleNamespace(container_path="/mnt/explicit-skills"),
        skill_evolution=SimpleNamespace(enabled=False),
        tool_search=SimpleNamespace(enabled=False),
        memory=SimpleNamespace(enabled=False, injection_enabled=True, max_injection_tokens=2000),
        acp_agents={},
    )

    def fail_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when app_config is explicit")

    def fail_get_memory_config():
        raise AssertionError("ambient get_memory_config() must not be used when app_config is explicit")

    monkeypatch.setattr("kkoclaw.config.get_app_config", fail_get_app_config)
    monkeypatch.setattr("kkoclaw.config.memory_config.get_memory_config", fail_get_memory_config)
    monkeypatch.setattr(prompt_module, "get_or_new_skill_storage", lambda app_config=None: SimpleNamespace(load_skills=lambda enabled_only=True: []))
    monkeypatch.setattr(prompt_module, "get_agent_soul", lambda agent_name=None: "")

    prompt = prompt_module.apply_prompt_template(app_config=explicit_config)

    assert "`/home/user/shared`" in prompt
    assert "Custom Mounted Directories" in prompt


def test_apply_prompt_template_threads_explicit_app_config_to_subagents_without_global_config(monkeypatch):
    explicit_config = SimpleNamespace(
        sandbox=SimpleNamespace(
            use="kkoclaw.sandbox.local:LocalSandboxProvider",
            allow_host_bash=False,
            mounts=[],
        ),
        subagents=SubagentsAppConfig(
            custom_agents={
                "researcher": CustomSubagentConfig(
                    description="Research agent\nwith details",
                    system_prompt="You research.",
                )
            }
        ),
        skills=SimpleNamespace(container_path="/mnt/skills"),
        skill_evolution=SimpleNamespace(enabled=False),
        tool_search=SimpleNamespace(enabled=False),
        memory=SimpleNamespace(enabled=False, injection_enabled=True, max_injection_tokens=2000),
        acp_agents={},
    )

    def fail_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when app_config is explicit")

    def fail_get_subagents_app_config():
        raise AssertionError("ambient get_subagents_app_config() must not be used when app_config is explicit")

    monkeypatch.setattr("kkoclaw.config.get_app_config", fail_get_app_config)
    monkeypatch.setattr("kkoclaw.config.subagents_config.get_subagents_app_config", fail_get_subagents_app_config)
    monkeypatch.setattr(prompt_module, "get_or_new_skill_storage", lambda app_config=None: SimpleNamespace(load_skills=lambda enabled_only=True: []))
    monkeypatch.setattr(prompt_module, "get_agent_soul", lambda agent_name=None: "")

    prompt = prompt_module.apply_prompt_template(subagent_enabled=True, app_config=explicit_config)

    assert "**researcher**: Research agent" in prompt
    assert "**bash**" not in prompt


def test_build_acp_section_uses_explicit_app_config_without_global_config(monkeypatch):
    explicit_config = SimpleNamespace(acp_agents={"codex": object()})

    def fail_get_acp_agents():
        raise AssertionError("ambient get_acp_agents() must not be used when app_config is explicit")

    monkeypatch.setattr("kkoclaw.config.acp_config.get_acp_agents", fail_get_acp_agents)

    section = prompt_module._build_acp_section(app_config=explicit_config)

    assert "ACP Agent Tasks" in section
    assert "/mnt/acp-workspace/" in section


def test_get_memory_context_uses_explicit_app_config_without_global_config(monkeypatch):
    explicit_config = SimpleNamespace(
        memory=SimpleNamespace(enabled=True, injection_enabled=True, max_injection_tokens=1234),
    )
    captured: dict[str, object] = {}

    def fail_get_memory_config():
        raise AssertionError("ambient get_memory_config() must not be used when app_config is explicit")

    def fake_get_memory_data(agent_name=None, *, user_id=None):
        captured["agent_name"] = agent_name
        captured["user_id"] = user_id
        return {"facts": []}

    def fake_format_memory_for_injection(memory_data, *, max_tokens, ranked_facts=None):
        captured["memory_data"] = memory_data
        captured["max_tokens"] = max_tokens
        captured["ranked_facts"] = ranked_facts
        return "remember this"

    monkeypatch.setattr("kkoclaw.config.memory_config.get_memory_config", fail_get_memory_config)
    monkeypatch.setattr("kkoclaw.runtime.user_context.get_effective_user_id", lambda: "user-1")
    monkeypatch.setattr("kkoclaw.agents.memory.get_memory_data", fake_get_memory_data)
    monkeypatch.setattr("kkoclaw.agents.memory.format_memory_for_injection", fake_format_memory_for_injection)

    context = prompt_module._get_memory_context("agent-a", app_config=explicit_config)

    assert "<memory>" in context
    assert "remember this" in context
    assert captured == {
        "agent_name": "agent-a",
        "user_id": "user-1",
        "memory_data": {"user": {}, "history": {}, "facts": []},
        "max_tokens": 1234,
        "ranked_facts": None,
    }


def test_get_memory_context_uses_ranked_facts_when_retrieval_enabled(monkeypatch):
    explicit_config = SimpleNamespace(
        memory=SimpleNamespace(
            enabled=True,
            injection_enabled=True,
            max_injection_tokens=1234,
            retrieval=SimpleNamespace(
                enabled=True,
                context_max_turns=4,
                context_max_chars=4000,
                similarity_weight=0.6,
                confidence_weight=0.4,
                min_similarity=0.0,
            ),
        ),
    )
    captured: dict[str, object] = {}

    def fake_get_memory_data(agent_name=None, *, user_id=None):
        captured["agent_name"] = agent_name
        captured["user_id"] = user_id
        return {"facts": [{"content": "raw", "category": "goal", "confidence": 0.3}]}

    def fake_extract_current_context(messages, *, max_turns, max_chars):
        captured["messages"] = messages
        captured["max_turns"] = max_turns
        captured["max_chars"] = max_chars
        return "current context"

    def fake_rank_memory_facts(facts, **kwargs):
        captured["facts"] = facts
        captured["rank_kwargs"] = kwargs
        return [{"content": "ranked", "category": "goal", "confidence": 0.3}]

    def fake_format_memory_for_injection(memory_data, *, max_tokens, ranked_facts=None):
        captured["memory_data"] = memory_data
        captured["max_tokens"] = max_tokens
        captured["ranked_facts"] = ranked_facts
        return "remember ranked"

    monkeypatch.setattr("kkoclaw.runtime.user_context.get_effective_user_id", lambda: "user-1")
    monkeypatch.setattr("kkoclaw.agents.memory.get_memory_data", fake_get_memory_data)
    monkeypatch.setattr("kkoclaw.agents.memory.extract_current_context", fake_extract_current_context)
    monkeypatch.setattr("kkoclaw.agents.memory.rank_memory_facts", fake_rank_memory_facts)
    monkeypatch.setattr("kkoclaw.agents.memory.format_memory_for_injection", fake_format_memory_for_injection)

    context = prompt_module._get_memory_context(
        "agent-a",
        app_config=explicit_config,
        messages=["message-1"],
    )

    assert "<memory>" in context
    assert "remember ranked" in context
    assert captured["ranked_facts"] == [{"content": "ranked", "category": "goal", "confidence": 0.3}]


def test_get_memory_context_applies_active_scope_before_formatting(monkeypatch):
    explicit_config = SimpleNamespace(
        memory=SimpleNamespace(
            enabled=True,
            injection_enabled=True,
            max_injection_tokens=1234,
            retrieval=SimpleNamespace(enabled=False),
        ),
    )
    active_scope = {"type": "coding_project", "id": "kk_OClaw"}
    captured: dict[str, object] = {}
    raw_memory = {
        "facts": [
            {"content": "Global preference", "scope": {"type": "global"}},
            {"content": "OClaw project fact", "scope": active_scope},
            {"content": "Other project fact", "scope": {"type": "coding_project", "id": "other"}},
        ],
        "scoped": [
            {
                "scope": active_scope,
                "user": {"topOfMind": {"summary": "OClaw scoped focus"}},
            }
        ],
    }

    def fake_build_memory_injection_view(memory_data, *, active_scope=None, include_legacy_unscoped_facts=True):
        captured["raw_memory_data"] = memory_data
        captured["active_scope"] = active_scope
        captured["include_legacy_unscoped_facts"] = include_legacy_unscoped_facts
        return {
            "user": {"topOfMind": {"summary": "OClaw scoped focus"}},
            "history": {},
            "facts": [
                {"content": "Global preference", "scope": {"type": "global"}},
                {"content": "OClaw project fact", "scope": active_scope},
            ],
        }

    def fake_format_memory_for_injection(memory_data, *, max_tokens, ranked_facts=None):
        captured["formatted_memory_data"] = memory_data
        return "scoped memory"

    monkeypatch.setattr("kkoclaw.runtime.user_context.get_effective_user_id", lambda: "user-1")
    monkeypatch.setattr("kkoclaw.agents.memory.get_memory_data", lambda agent_name=None, *, user_id=None: raw_memory)
    monkeypatch.setattr("kkoclaw.agents.memory.build_memory_injection_view", fake_build_memory_injection_view)
    monkeypatch.setattr("kkoclaw.agents.memory.format_memory_for_injection", fake_format_memory_for_injection)

    context = prompt_module._get_memory_context(
        "coding_agent",
        app_config=explicit_config,
        active_scope=active_scope,
    )

    assert "<memory>" in context
    assert captured["raw_memory_data"] is raw_memory
    assert captured["active_scope"] == active_scope
    assert captured["include_legacy_unscoped_facts"] is False
    assert captured["formatted_memory_data"]["user"]["topOfMind"]["summary"] == "OClaw scoped focus"
    assert [fact["content"] for fact in captured["formatted_memory_data"]["facts"]] == [
        "Global preference",
        "OClaw project fact",
    ]


def test_refresh_skills_system_prompt_cache_async_reloads_immediately(monkeypatch, tmp_path):
    def make_skill(name: str) -> Skill:
        skill_dir = tmp_path / name
        return Skill(
            name=name,
            description=f"Description for {name}",
            license="MIT",
            skill_dir=skill_dir,
            skill_file=skill_dir / "SKILL.md",
            relative_path=skill_dir.relative_to(tmp_path),
            category="custom",
            enabled=True,
        )

    state = {"skills": [make_skill("first-skill")]}
    monkeypatch.setattr(prompt_module, "get_or_new_skill_storage", lambda **kwargs: __import__("types").SimpleNamespace(load_skills=lambda *, enabled_only: list(state["skills"])))
    _set_skills_cache_state()

    try:
        prompt_module.warm_enabled_skills_cache()
        assert [skill.name for skill in prompt_module._get_enabled_skills()] == ["first-skill"]

        state["skills"] = [make_skill("second-skill")]
        anyio.run(prompt_module.refresh_skills_system_prompt_cache_async)

        assert [skill.name for skill in prompt_module._get_enabled_skills()] == ["second-skill"]
    finally:
        _set_skills_cache_state()


def test_clear_cache_does_not_spawn_parallel_refresh_workers(monkeypatch, tmp_path):
    started = threading.Event()
    release = threading.Event()
    active_loads = 0
    max_active_loads = 0
    call_count = 0
    lock = threading.Lock()

    def make_skill(name: str) -> Skill:
        skill_dir = tmp_path / name
        return Skill(
            name=name,
            description=f"Description for {name}",
            license="MIT",
            skill_dir=skill_dir,
            skill_file=skill_dir / "SKILL.md",
            relative_path=skill_dir.relative_to(tmp_path),
            category="custom",
            enabled=True,
        )

    def fake_load_skills(enabled_only=True):
        nonlocal active_loads, max_active_loads, call_count
        with lock:
            active_loads += 1
            max_active_loads = max(max_active_loads, active_loads)
            call_count += 1
            current_call = call_count

        started.set()
        if current_call == 1:
            release.wait(timeout=5)

        with lock:
            active_loads -= 1

        return [make_skill(f"skill-{current_call}")]

    monkeypatch.setattr(prompt_module, "get_or_new_skill_storage", lambda **kwargs: __import__("types").SimpleNamespace(load_skills=lambda *, enabled_only: fake_load_skills(enabled_only=enabled_only)))
    _set_skills_cache_state()

    try:
        prompt_module.clear_skills_system_prompt_cache()
        assert started.wait(timeout=5)

        prompt_module.clear_skills_system_prompt_cache()
        release.set()
        prompt_module.warm_enabled_skills_cache()

        assert max_active_loads == 1
        assert [skill.name for skill in prompt_module._get_enabled_skills()] == ["skill-2"]
    finally:
        release.set()
        _set_skills_cache_state()


def test_warm_enabled_skills_cache_logs_on_timeout(monkeypatch, caplog):
    event = threading.Event()
    monkeypatch.setattr(prompt_module, "_ensure_enabled_skills_cache", lambda: event)

    with caplog.at_level("WARNING"):
        warmed = prompt_module.warm_enabled_skills_cache(timeout_seconds=0.01)

    assert warmed is False
    assert "Timed out waiting" in caplog.text

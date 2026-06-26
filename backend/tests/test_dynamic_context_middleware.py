from types import SimpleNamespace

from langchain_core.messages import HumanMessage

from kkoclaw.agents.middlewares.dynamic_context_middleware import DynamicContextMiddleware


def test_dynamic_context_uses_runtime_scope_for_first_memory_injection(monkeypatch):
    captured: dict[str, object] = {}
    active_scope = {"type": "coding_project", "id": "kk_OClaw"}

    def fake_get_memory_context(agent_name=None, *, app_config=None, active_scope=None, user_id=None, **kwargs):
        captured["agent_name"] = agent_name
        captured["active_scope"] = active_scope
        captured["user_id"] = user_id
        return "<memory>\nscoped memory\n</memory>"

    monkeypatch.setattr(
        "kkoclaw.agents.lead_agent.prompt._get_memory_context",
        fake_get_memory_context,
    )

    middleware = DynamicContextMiddleware(
        agent_name="coding_agent",
        app_config=SimpleNamespace(memory=SimpleNamespace(injection_enabled=True)),
    )
    runtime = SimpleNamespace(context={"memory_scope": active_scope, "user_id": "runtime-user"})

    result = middleware.before_agent({"messages": [HumanMessage(content="继续修复记忆隔离")]}, runtime)

    assert result is not None
    assert captured == {
        "agent_name": "coding_agent",
        "active_scope": active_scope,
        "user_id": "runtime-user",
    }
    assert "scoped memory" in result["messages"][0].content

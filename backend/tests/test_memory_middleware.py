from unittest.mock import MagicMock

from langchain_core.messages import HumanMessage

from kkoclaw.agents.middlewares import memory_middleware as memory_middleware_module
from kkoclaw.agents.middlewares.memory_middleware import MemoryMiddleware
from kkoclaw.config.memory_config import MemoryConfig, MemoryRetrievalConfig


def _runtime() -> MagicMock:
    return MagicMock(context={"thread_id": "thread-1"})


def test_before_agent_injects_ranked_memory_when_retrieval_enabled(monkeypatch) -> None:
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)
    captured: dict[str, object] = {}

    monkeypatch.setattr(memory_middleware_module, "get_effective_user_id", lambda: "user-1")
    monkeypatch.setattr(
        memory_middleware_module,
        "get_memory_data",
        lambda agent_name=None, *, user_id=None: {
            "facts": [{"content": "raw fact", "category": "goal", "confidence": 0.3}]
        },
    )
    monkeypatch.setattr(
        memory_middleware_module,
        "extract_current_context",
        lambda messages, *, max_turns, max_chars: "current context",
    )
    monkeypatch.setattr(
        memory_middleware_module,
        "rank_memory_facts",
        lambda facts, **kwargs: [{"content": "ranked fact", "category": "goal", "confidence": 0.9}],
    )

    def fake_format_memory_for_injection(memory_data, *, max_tokens, ranked_facts=None):
        captured["memory_data"] = memory_data
        captured["max_tokens"] = max_tokens
        captured["ranked_facts"] = ranked_facts
        return "Facts:\n- ranked fact"

    monkeypatch.setattr(memory_middleware_module, "format_memory_for_injection", fake_format_memory_for_injection)

    result = middleware.before_agent({"messages": [HumanMessage(content="继续实现 TF-IDF 检索")]}, _runtime())

    assert result is not None
    injected = result["messages"][0]
    assert injected.name == "memory_context"
    assert "ranked fact" in injected.content
    assert injected.additional_kwargs["hide_from_ui"] is True
    assert captured["memory_data"] == {"facts": [{"content": "raw fact", "category": "goal", "confidence": 0.3}]}
    assert captured["ranked_facts"] == [{"content": "ranked fact", "category": "goal", "confidence": 0.9}]


def test_before_agent_returns_none_when_retrieval_disabled() -> None:
    config = MemoryConfig(enabled=True, injection_enabled=True, retrieval=MemoryRetrievalConfig(enabled=False))
    middleware = MemoryMiddleware(memory_config=config)

    result = middleware.before_agent({"messages": [HumanMessage(content="hi")]}, _runtime())

    assert result is None

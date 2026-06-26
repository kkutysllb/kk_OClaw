import asyncio
import logging
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage

from kkoclaw.agents.memory.retrieval import get_retrieval_stats, reset_retrieval_stats
from kkoclaw.agents.middlewares import memory_middleware as memory_middleware_module
from kkoclaw.agents.middlewares.memory_middleware import MemoryMiddleware
from kkoclaw.config.memory_config import MemoryConfig, MemoryRetrievalConfig


def _runtime() -> MagicMock:
    return MagicMock(context={"thread_id": "thread-1"})


def _runtime_with_user_context() -> MagicMock:
    return MagicMock(context={"thread_id": "thread-1", "user_id": "runtime-user"})


def _runtime_with_scope() -> MagicMock:
    return MagicMock(
        context={
            "thread_id": "thread-1",
            "memory_scope": {"type": "coding_project", "id": "kk_OClaw"},
        }
    )


def test_before_agent_injects_ranked_memory_when_retrieval_enabled(monkeypatch) -> None:
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)
    captured: dict[str, object] = {}

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: "user-1")
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


def test_before_agent_uses_runtime_user_id_for_memory_lookup(monkeypatch) -> None:
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)
    captured: dict[str, object] = {}

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: runtime.context.get("user_id", "ambient-user"))

    def fake_get_memory_data(agent_name=None, *, user_id=None):
        captured["agent_name"] = agent_name
        captured["user_id"] = user_id
        return {"facts": [{"content": "runtime user fact", "category": "goal", "confidence": 0.9}]}

    monkeypatch.setattr(memory_middleware_module, "get_memory_data", fake_get_memory_data)
    monkeypatch.setattr(memory_middleware_module, "extract_current_context", lambda messages, *, max_turns, max_chars: "current context")
    monkeypatch.setattr(memory_middleware_module, "rank_memory_facts", lambda facts, **kwargs: facts)
    monkeypatch.setattr(
        memory_middleware_module,
        "format_memory_for_injection",
        lambda memory_data, *, max_tokens, ranked_facts=None: "Facts:\n- runtime user fact",
    )

    result = middleware.before_agent({"messages": [HumanMessage(content="hi")]}, _runtime_with_user_context())

    assert result is not None
    assert captured == {"agent_name": "agent-a", "user_id": "runtime-user"}


def test_before_agent_returns_none_when_retrieval_disabled() -> None:
    config = MemoryConfig(enabled=True, injection_enabled=True, retrieval=MemoryRetrievalConfig(enabled=False))
    middleware = MemoryMiddleware(memory_config=config)

    result = middleware.before_agent({"messages": [HumanMessage(content="hi")]}, _runtime())

    assert result is None


def test_after_agent_uses_runtime_user_id_for_memory_queue(monkeypatch) -> None:
    config = MemoryConfig(enabled=True)
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)
    queue = MagicMock()

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: runtime.context.get("user_id", "ambient-user"))
    monkeypatch.setattr(memory_middleware_module, "get_memory_queue", lambda: queue)

    result = middleware.after_agent(
        {"messages": [HumanMessage(content="Question"), AIMessage(content="Answer")]},
        _runtime_with_user_context(),
    )

    assert result is None
    queue.add.assert_called_once()
    assert queue.add.call_args.kwargs["user_id"] == "runtime-user"


def test_before_agent_records_injection_stats(monkeypatch) -> None:
    reset_retrieval_stats()
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
        max_injection_tokens=2000,
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: "user-1")
    monkeypatch.setattr(
        memory_middleware_module,
        "get_memory_data",
        lambda agent_name=None, *, user_id=None: {
            "facts": [
                {"content": "raw fact 1", "category": "goal", "confidence": 0.3},
                {"content": "raw fact 2", "category": "goal", "confidence": 0.2},
            ]
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
        lambda facts, **kwargs: [
            {"content": "ranked fact 1", "category": "goal", "confidence": 0.9},
            {"content": "ranked fact 2", "category": "goal", "confidence": 0.8},
        ],
    )
    monkeypatch.setattr(
        memory_middleware_module,
        "format_memory_for_injection",
        lambda memory_data, *, max_tokens, ranked_facts=None: "Facts:\n- [goal | 0.90] ranked fact 1\n- [goal | 0.80] ranked fact 2",
    )

    result = middleware.before_agent({"messages": [HumanMessage(content="继续实现 TF-IDF 检索")]}, _runtime())

    assert result is not None
    stats = get_retrieval_stats()
    assert stats["last_injection_tokens_budget"] == 2000
    assert stats["last_injected_facts_count"] == 2


def test_before_agent_filters_facts_by_runtime_coding_scope(monkeypatch) -> None:
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)
    captured: dict[str, object] = {}
    facts = [
        {"content": "Global preference", "category": "preference", "confidence": 0.9, "scope": {"type": "global"}},
        {"content": "OClaw project fact", "category": "context", "confidence": 0.8, "scope": {"type": "coding_project", "id": "kk_OClaw"}},
        {"content": "Aoshu project fact", "category": "context", "confidence": 0.8, "scope": {"type": "coding_project", "id": "kk_aoshu"}},
    ]

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: "user-1")
    monkeypatch.setattr(memory_middleware_module, "get_memory_data", lambda agent_name=None, *, user_id=None: {"facts": facts})
    monkeypatch.setattr(memory_middleware_module, "extract_current_context", lambda messages, *, max_turns, max_chars: "current context")

    def fake_rank_memory_facts(scoped_facts, **kwargs):
        captured["ranked_input"] = scoped_facts
        return scoped_facts

    monkeypatch.setattr(memory_middleware_module, "rank_memory_facts", fake_rank_memory_facts)
    monkeypatch.setattr(
        memory_middleware_module,
        "format_memory_for_injection",
        lambda memory_data, *, max_tokens, ranked_facts=None: "Facts:\n- [context | 0.80] scoped fact",
    )

    result = middleware.before_agent({"messages": [HumanMessage(content="继续做 kk_OClaw")]}, _runtime_with_scope())

    assert result is not None
    assert [fact["content"] for fact in captured["ranked_input"]] == ["Global preference", "OClaw project fact"]


def test_before_agent_emits_debug_log_for_retrieval_injection(monkeypatch, caplog) -> None:
    reset_retrieval_stats()
    caplog.set_level(logging.DEBUG)
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
        max_injection_tokens=2000,
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: "user-1")
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

    def fake_rank_memory_facts(_facts, **_kwargs):
        return [{"content": "ranked fact", "category": "goal", "confidence": 0.9}]

    monkeypatch.setattr(memory_middleware_module, "rank_memory_facts", fake_rank_memory_facts)
    monkeypatch.setattr(
        memory_middleware_module,
        "format_memory_for_injection",
        lambda memory_data, *, max_tokens, ranked_facts=None: "Facts:\n- [goal | 0.90] ranked fact",
    )

    result = middleware.before_agent({"messages": [HumanMessage(content="继续实现 TF-IDF 检索")]}, _runtime())

    assert result is not None
    assert "memory.retrieval ranked" in caplog.text
    assert "budget=2000" in caplog.text


def test_abefore_agent_accepts_runtime_keyword_and_reuses_sync_logic(monkeypatch) -> None:
    config = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    middleware = MemoryMiddleware(agent_name="agent-a", memory_config=config)

    monkeypatch.setattr(memory_middleware_module, "resolve_runtime_user_id", lambda runtime: "user-1")
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
    monkeypatch.setattr(
        memory_middleware_module,
        "format_memory_for_injection",
        lambda memory_data, *, max_tokens, ranked_facts=None: "Facts:\n- ranked fact",
    )

    result = asyncio.run(
        middleware.abefore_agent(
            {"messages": [HumanMessage(content="继续实现 TF-IDF 检索")]},
            runtime=_runtime(),
        )
    )

    assert result is not None
    injected = result["messages"][0]
    assert injected.name == "memory_context"
    assert "ranked fact" in injected.content

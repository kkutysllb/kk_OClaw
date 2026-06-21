from kkoclaw.agents.memory import retrieval as retrieval_module
from kkoclaw.agents.memory.retrieval import (
    filter_memory_facts_for_scope,
    get_retrieval_stats,
    rank_memory_facts,
    reset_retrieval_stats,
    tokenize_text,
)
from kkoclaw.config.memory_config import MemoryConfig


def test_memory_config_defaults_retrieval_disabled() -> None:
    config = MemoryConfig()

    assert config.retrieval.enabled is False
    assert config.retrieval.strategy == "tfidf"
    assert config.retrieval.context_max_turns == 4
    assert config.retrieval.context_max_chars == 4000
    assert config.retrieval.similarity_weight == 0.6
    assert config.retrieval.confidence_weight == 0.4
    assert config.retrieval.min_similarity == 0.0


def test_rank_memory_facts_prefers_similarity_over_lower_relevance() -> None:
    facts = [
        {"content": "用户最近在实现 TF-IDF 检索和 current_context 打分。", "category": "goal", "confidence": 0.75},
        {"content": "用户喜欢 SQLAlchemy。", "category": "preference", "confidence": 0.95},
    ]

    ranked = rank_memory_facts(
        facts,
        current_context="继续实现 TF-IDF 检索和 current_context 排序逻辑",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert ranked[0]["content"].startswith("用户最近在实现 TF-IDF")


def test_rank_memory_facts_falls_back_to_confidence_without_context() -> None:
    facts = [
        {"content": "Low", "category": "context", "confidence": 0.2},
        {"content": "High", "category": "context", "confidence": 0.9},
    ]

    ranked = rank_memory_facts(
        facts,
        current_context=None,
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert [fact["content"] for fact in ranked] == ["High", "Low"]


def test_filter_memory_facts_for_coding_project_scope_keeps_global_and_matching_project() -> None:
    facts = [
        {"content": "Global preference", "scope": {"type": "global"}},
        {"content": "OClaw project fact", "scope": {"type": "coding_project", "id": "kk_OClaw"}},
        {"content": "Aoshu project fact", "scope": {"type": "coding_project", "id": "kk_aoshu"}},
        {"content": "Legacy fact without scope"},
    ]

    filtered = filter_memory_facts_for_scope(
        facts,
        active_scope={"type": "coding_project", "id": "kk_OClaw"},
    )

    assert [fact["content"] for fact in filtered] == [
        "Global preference",
        "OClaw project fact",
        "Legacy fact without scope",
    ]


def test_filter_memory_facts_without_active_scope_preserves_legacy_behavior() -> None:
    facts = [
        {"content": "Global preference", "scope": {"type": "global"}},
        {"content": "Project fact", "scope": {"type": "coding_project", "id": "kk_OClaw"}},
    ]

    filtered = filter_memory_facts_for_scope(facts, active_scope=None)

    assert filtered == facts


def test_rank_memory_facts_records_cache_hit_and_miss() -> None:
    retrieval_module._prepare_fact_corpus_cached.cache_clear()
    reset_retrieval_stats()

    facts = [
        {"content": "LangGraph memory retrieval cache", "confidence": 0.9},
        {"content": "Summarization middleware trigger", "confidence": 0.8},
    ]

    rank_memory_facts(
        facts,
        current_context="memory retrieval cache",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )
    first = get_retrieval_stats()
    assert first["cache_misses"] == 1
    assert first["cache_hits"] == 0

    rank_memory_facts(
        facts,
        current_context="memory retrieval cache",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )
    second = get_retrieval_stats()
    assert second["cache_misses"] == 1
    assert second["cache_hits"] == 1


def test_rank_memory_facts_records_fallback_stats_without_context() -> None:
    reset_retrieval_stats()

    facts = [
        {"content": "Memory facts ranking", "confidence": 0.75},
    ]

    ranked = rank_memory_facts(
        facts,
        current_context=None,
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    stats = get_retrieval_stats()
    assert ranked[0]["content"] == "Memory facts ranking"
    assert stats["calls_without_context"] == 1
    assert stats["fallback_confidence_only_calls"] == 1


def test_rank_memory_facts_reuses_prepared_corpus_for_same_facts(monkeypatch) -> None:
    retrieval_module._prepare_fact_corpus_cached.cache_clear()
    call_count = 0
    original = retrieval_module._prepare_fact_corpus

    def wrapped(facts_signature):
        nonlocal call_count
        call_count += 1
        return original(facts_signature)

    monkeypatch.setattr(retrieval_module, "_prepare_fact_corpus", wrapped)

    facts = [
        {"content": "用户最近在实现 retrieval 缓存。", "category": "goal", "confidence": 0.8},
        {"content": "用户喜欢 SQLAlchemy。", "category": "preference", "confidence": 0.9},
    ]

    rank_memory_facts(
        facts,
        current_context="继续优化 retrieval 缓存",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )
    rank_memory_facts(
        facts,
        current_context="继续优化 facts cache 命中率",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert call_count == 1


def test_rank_memory_facts_rebuilds_cache_when_facts_change(monkeypatch) -> None:
    retrieval_module._prepare_fact_corpus_cached.cache_clear()
    call_count = 0
    original = retrieval_module._prepare_fact_corpus

    def wrapped(facts_signature):
        nonlocal call_count
        call_count += 1
        return original(facts_signature)

    monkeypatch.setattr(retrieval_module, "_prepare_fact_corpus", wrapped)

    facts_a = [{"content": "A", "category": "goal", "confidence": 0.7}]
    facts_b = [{"content": "B", "category": "goal", "confidence": 0.7}]

    rank_memory_facts(
        facts_a,
        current_context="A",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )
    rank_memory_facts(
        facts_b,
        current_context="B",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert call_count == 2


def test_rank_memory_facts_cache_does_not_change_result_order() -> None:
    facts = [
        {"content": "实现 retrieval cache", "category": "goal", "confidence": 0.75},
        {"content": "喜欢 SQLAlchemy", "category": "preference", "confidence": 0.95},
    ]

    first = rank_memory_facts(
        facts,
        current_context="继续实现 retrieval cache",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )
    second = rank_memory_facts(
        facts,
        current_context="继续实现 retrieval cache",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert [fact["content"] for fact in first] == [fact["content"] for fact in second]


def test_tokenize_text_expands_chinese_phrases_into_ngrams() -> None:
    tokens = tokenize_text("上下文感知排序")

    assert "上下文感知排序" in tokens
    assert "感知" in tokens
    assert "排序" in tokens
    assert "文感知" in tokens


def test_tokenize_text_splits_technical_tokens_and_camel_case() -> None:
    tokens = tokenize_text("DeepSeekCoder langgraph-sdk/v1 gpt-4o-mini")

    assert "deepseekcoder" in tokens
    assert "deepseek" in tokens
    assert "coder" in tokens
    assert "langgraph-sdk/v1" in tokens
    assert "langgraph" in tokens
    assert "sdk" in tokens
    assert "v1" in tokens
    assert "gpt-4o-mini" in tokens
    assert "gpt" in tokens
    assert "mini" in tokens


def test_tokenize_text_dedupes_and_preserves_order() -> None:
    tokens = tokenize_text("LangGraph langgraph-sdk langgraph")

    assert tokens.count("langgraph") == 1
    assert tokens.index("langgraph") < tokens.index("sdk")


def test_rank_memory_facts_matches_partial_chinese_phrase() -> None:
    facts = [
        {"content": "系统支持上下文感知排序和记忆注入。", "category": "goal", "confidence": 0.7},
        {"content": "用户偏好 SQLAlchemy。", "category": "preference", "confidence": 0.95},
    ]

    ranked = rank_memory_facts(
        facts,
        current_context="继续优化感知排序",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert ranked[0]["content"].startswith("系统支持上下文感知排序")


def test_rank_memory_facts_matches_api_path_subtokens() -> None:
    facts = [
        {"content": "接口路径是 /api/v1/chat/completions。", "category": "context", "confidence": 0.6},
        {"content": "用户喜欢 PostgreSQL。", "category": "preference", "confidence": 0.95},
    ]

    ranked = rank_memory_facts(
        facts,
        current_context="继续处理 chat completions 接口",
        similarity_weight=0.6,
        confidence_weight=0.4,
    )

    assert ranked[0]["content"].startswith("接口路径是 /api/v1/chat/completions")

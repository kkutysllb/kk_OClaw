from kkoclaw.config.memory_config import MemoryConfig
from kkoclaw.agents.memory.retrieval import rank_memory_facts


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

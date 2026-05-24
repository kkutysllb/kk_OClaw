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

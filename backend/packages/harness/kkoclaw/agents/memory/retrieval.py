"""Context-aware retrieval helpers for memory fact injection."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from kkoclaw.agents.memory.message_processing import extract_message_text, filter_messages_for_memory
from kkoclaw.agents.memory.prompt import _coerce_confidence

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+-]*|[\u4e00-\u9fff]+")


def normalize_text(text: str) -> str:
    """Normalize text for lightweight lexical retrieval."""
    return re.sub(r"\s+", " ", str(text).strip().lower())


def tokenize_text(text: str) -> list[str]:
    """Tokenize mixed Chinese / English / technical text without extra deps."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    return _TOKEN_RE.findall(normalized)


def _build_tfidf_vector(tokens: list[str], idf_map: dict[str, float]) -> dict[str, float]:
    counts = Counter(tokens)
    return {token: float(freq) * idf_map[token] for token, freq in counts.items() if token in idf_map}


def _cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    dot = sum(value * vec_b.get(token, 0.0) for token, value in vec_a.items())
    norm_a = math.sqrt(sum(value * value for value in vec_a.values()))
    norm_b = math.sqrt(sum(value * value for value in vec_b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    similarity = dot / (norm_a * norm_b)
    return max(0.0, min(1.0, similarity))


def extract_current_context(messages: list[Any], *, max_turns: int, max_chars: int) -> str | None:
    """Build a recent-text query from filtered user/final-assistant turns."""
    filtered_messages = filter_messages_for_memory(messages)
    turns: list[str] = []

    for message in reversed(filtered_messages):
        msg_type = getattr(message, "type", None)
        if msg_type not in {"human", "ai"}:
            continue

        text = extract_message_text(message).strip()
        if not text:
            continue

        turns.append(text)
        if len(turns) >= max_turns * 2:
            break

    if not turns:
        return None

    context = "\n\n".join(reversed(turns)).strip()
    if not context:
        return None

    trimmed = context[:max_chars].strip()
    return trimmed or None


def rank_memory_facts(
    facts: list[dict[str, Any]],
    *,
    current_context: str | None,
    similarity_weight: float,
    confidence_weight: float,
    min_similarity: float = 0.0,
) -> list[dict[str, Any]]:
    """Rank facts by context similarity with confidence fallback."""
    valid_facts = [
        fact
        for fact in facts
        if isinstance(fact, dict) and isinstance(fact.get("content"), str) and fact["content"].strip()
    ]

    if not current_context:
        return sorted(
            valid_facts,
            key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0),
            reverse=True,
        )

    total_weight = similarity_weight + confidence_weight
    if total_weight <= 0:
        similarity_weight, confidence_weight = 0.6, 0.4
    else:
        similarity_weight /= total_weight
        confidence_weight /= total_weight

    query_tokens = tokenize_text(current_context)
    fact_tokens = [tokenize_text(fact["content"]) for fact in valid_facts]
    documents = [tokens for tokens in fact_tokens if tokens]
    if not documents or not query_tokens:
        return sorted(
            valid_facts,
            key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0),
            reverse=True,
        )

    documents = documents + [query_tokens]
    document_count = len(documents)
    vocabulary = {token for tokens in documents for token in set(tokens)}
    idf_map = {
        token: math.log((1 + document_count) / (1 + sum(1 for tokens in documents if token in set(tokens)))) + 1.0
        for token in vocabulary
    }
    query_vector = _build_tfidf_vector(query_tokens, idf_map)

    scored_facts: list[tuple[float, float, int, dict[str, Any]]] = []
    for index, fact in enumerate(valid_facts):
        similarity = _cosine_similarity(query_vector, _build_tfidf_vector(fact_tokens[index], idf_map))
        similarity = max(min_similarity, similarity)
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        final_score = (similarity * similarity_weight) + (confidence * confidence_weight)
        scored_facts.append((final_score, confidence, -index, fact))

    scored_facts.sort(reverse=True)
    return [fact for _, _, _, fact in scored_facts]

"""Context-aware retrieval helpers for memory fact injection."""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any

from kkoclaw.agents.memory.message_processing import extract_message_text, filter_messages_for_memory
from kkoclaw.agents.memory.prompt import _coerce_confidence
from kkoclaw.agents.memory.scope import is_global_scope, same_memory_scope, scope_value

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+-]*|[\u4e00-\u9fff]+")
_TECH_SPLIT_RE = re.compile(r"[-_./:+]+")
_CAMEL_SEGMENT_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+")

FactSignature = tuple[str, float, str, str | None]
MemoryScope = dict[str, Any]


@dataclass(frozen=True)
class PreparedFactCorpus:
    """Reusable facts-side retrieval state derived from a stable corpus signature."""

    facts_signature: tuple[FactSignature, ...]
    fact_tokens: tuple[tuple[str, ...], ...]
    idf_map: dict[str, float]
    fact_vectors: tuple[dict[str, float], ...]


@dataclass
class RetrievalStats:
    """Process-local debug stats for retrieval behavior."""

    rank_calls: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    calls_without_context: int = 0
    calls_with_empty_query_tokens: int = 0
    calls_with_empty_idf: int = 0
    fallback_confidence_only_calls: int = 0
    last_facts_count: int = 0
    last_ranked_count: int = 0
    last_context_chars: int = 0
    last_query_tokens: int = 0
    last_injection_tokens_budget: int = 0
    last_injected_facts_count: int = 0
    last_top_scores: list[dict[str, float | int]] = field(default_factory=list)


_RETRIEVAL_STATS = RetrievalStats()


def get_retrieval_stats() -> dict[str, Any]:
    """Return a JSON-safe snapshot of current retrieval stats."""
    return asdict(_RETRIEVAL_STATS)


def reset_retrieval_stats() -> None:
    """Reset process-local retrieval stats, mainly for tests."""
    global _RETRIEVAL_STATS
    _RETRIEVAL_STATS = RetrievalStats()


def record_retrieval_injection_stats(*, budget: int, injected_facts_count: int) -> None:
    """Track latest injection budget usage without storing raw content."""
    _RETRIEVAL_STATS.last_injection_tokens_budget = max(0, int(budget))
    _RETRIEVAL_STATS.last_injected_facts_count = max(0, int(injected_facts_count))


def normalize_text(text: str) -> str:
    """Normalize text for lightweight lexical retrieval."""
    return re.sub(r"\s+", " ", str(text).strip().lower())


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).strip())


def _is_chinese_token(token: str) -> bool:
    return bool(token) and all("\u4e00" <= ch <= "\u9fff" for ch in token)


def _generate_chinese_ngrams(token: str) -> list[str]:
    expanded: list[str] = []
    for size in (2, 3):
        if len(token) < size:
            continue
        for index in range(len(token) - size + 1):
            expanded.append(token[index : index + size])
    return expanded


def _split_camel_case_token(token: str) -> list[str]:
    segments = [segment.lower() for segment in _CAMEL_SEGMENT_RE.findall(token) if segment]
    if len(segments) <= 1:
        return []

    expanded: list[str] = []
    for index, segment in enumerate(segments):
        if len(segment) >= 2:
            expanded.append(segment)
        if index + 1 < len(segments):
            pair = "".join(segments[index : index + 2])
            if len(pair) >= 2:
                expanded.append(pair)
    return expanded


def _split_alpha_numeric_token(token: str) -> list[str]:
    parts = [part.lower() for part in re.findall(r"[A-Za-z]+\d*|\d+[A-Za-z]*", token) if len(part) >= 2]
    return parts if len(parts) > 1 else []


def _split_technical_token(token: str) -> list[str]:
    parts = [part for part in _TECH_SPLIT_RE.split(token) if len(part) >= 2]
    expanded: list[str] = []
    for part in parts:
        lowered = part.lower()
        if len(lowered) >= 2:
            expanded.append(lowered)
        expanded.extend(_split_camel_case_token(part))
        expanded.extend(_split_alpha_numeric_token(part))
    return expanded


def _dedupe_preserve_order(tokens: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for token in tokens:
        if not token or token in seen:
            continue
        seen.add(token)
        ordered.append(token)
    return ordered


def tokenize_text(text: str) -> list[str]:
    """Tokenize mixed Chinese / English / technical text without extra deps."""
    normalized = _normalize_whitespace(text)
    if not normalized:
        return []

    expanded_tokens: list[str] = []
    for raw_token in _TOKEN_RE.findall(normalized):
        base_token = raw_token if _is_chinese_token(raw_token) else raw_token.lower()
        expanded_tokens.append(base_token)

        if _is_chinese_token(raw_token):
            expanded_tokens.extend(_generate_chinese_ngrams(raw_token))
            continue

        expanded_tokens.extend(_split_technical_token(raw_token))
        expanded_tokens.extend(_split_camel_case_token(raw_token))
        expanded_tokens.extend(_split_alpha_numeric_token(raw_token))

    return _dedupe_preserve_order(expanded_tokens)


def _build_tfidf_vector(tokens: list[str], idf_map: dict[str, float]) -> dict[str, float]:
    counts = Counter(tokens)
    return {token: float(freq) * idf_map[token] for token, freq in counts.items() if token in idf_map}


def _sort_facts_by_confidence(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        facts,
        key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0),
        reverse=True,
    )


def filter_memory_facts_for_scope(
    facts: list[dict[str, Any]],
    *,
    active_scope: MemoryScope | None,
) -> list[dict[str, Any]]:
    """Filter memory facts for the active task scope.

    Scope is intentionally opt-in. Non-coding conversations usually have no
    project identity, so they keep the legacy user-level memory behavior.
    Coding project scope keeps global facts, matching project facts, and legacy
    facts that have not been migrated yet, while excluding facts from other
    coding projects.
    """
    if not active_scope:
        return facts

    active_type = scope_value(active_scope, "type")
    if not active_type:
        return facts

    filtered: list[dict[str, Any]] = []
    for fact in facts:
        fact_scope = fact.get("scope")
        if not isinstance(fact_scope, dict):
            filtered.append(fact)
            continue

        if is_global_scope(fact_scope):
            filtered.append(fact)
            continue

        if same_memory_scope(fact_scope, active_scope):
            filtered.append(fact)

    return filtered


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


def build_facts_signature(
    facts: list[dict[str, Any]],
) -> tuple[FactSignature, ...]:
    """Build a stable signature that captures retrieval-relevant fact fields."""
    signature: list[FactSignature] = []
    for fact in facts:
        content = str(fact["content"]).strip()
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        category = str(fact.get("category", "context")).strip() or "context"
        source_error = fact.get("sourceError")
        signature.append((content, confidence, category, source_error.strip() if isinstance(source_error, str) else None))
    return tuple(signature)


def _prepare_fact_corpus(
    facts_signature: tuple[FactSignature, ...],
) -> PreparedFactCorpus:
    """Prepare token and vector structures for a stable facts corpus."""
    fact_tokens = tuple(tuple(tokenize_text(content)) for content, _, _, _ in facts_signature)
    documents = [list(tokens) for tokens in fact_tokens if tokens]
    if not documents:
        return PreparedFactCorpus(
            facts_signature=facts_signature,
            fact_tokens=fact_tokens,
            idf_map={},
            fact_vectors=tuple({} for _ in facts_signature),
        )

    document_count = len(documents)
    vocabulary = {token for tokens in documents for token in set(tokens)}
    idf_map = {
        token: math.log((1 + document_count) / (1 + sum(1 for tokens in documents if token in set(tokens)))) + 1.0
        for token in vocabulary
    }
    fact_vectors = tuple(_build_tfidf_vector(list(tokens), idf_map) for tokens in fact_tokens)
    return PreparedFactCorpus(
        facts_signature=facts_signature,
        fact_tokens=fact_tokens,
        idf_map=idf_map,
        fact_vectors=fact_vectors,
    )


@lru_cache(maxsize=64)
def _prepare_fact_corpus_cached(
    facts_signature: tuple[FactSignature, ...],
) -> PreparedFactCorpus:
    """Cache reusable retrieval state for repeated fact corpora."""
    return _prepare_fact_corpus(facts_signature)


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
    _RETRIEVAL_STATS.rank_calls += 1
    _RETRIEVAL_STATS.last_facts_count = len(valid_facts)
    _RETRIEVAL_STATS.last_context_chars = len(current_context or "")
    _RETRIEVAL_STATS.last_query_tokens = 0
    _RETRIEVAL_STATS.last_ranked_count = len(valid_facts)
    _RETRIEVAL_STATS.last_top_scores = []

    if not current_context:
        _RETRIEVAL_STATS.calls_without_context += 1
        _RETRIEVAL_STATS.fallback_confidence_only_calls += 1
        return _sort_facts_by_confidence(valid_facts)

    total_weight = similarity_weight + confidence_weight
    if total_weight <= 0:
        similarity_weight, confidence_weight = 0.6, 0.4
    else:
        similarity_weight /= total_weight
        confidence_weight /= total_weight

    query_tokens = tokenize_text(current_context)
    _RETRIEVAL_STATS.last_query_tokens = len(query_tokens)
    if not query_tokens:
        _RETRIEVAL_STATS.calls_with_empty_query_tokens += 1
        _RETRIEVAL_STATS.fallback_confidence_only_calls += 1
        return _sort_facts_by_confidence(valid_facts)

    facts_signature = build_facts_signature(valid_facts)
    cache_before = _prepare_fact_corpus_cached.cache_info()
    prepared = _prepare_fact_corpus_cached(facts_signature)
    cache_after = _prepare_fact_corpus_cached.cache_info()
    if cache_after.hits > cache_before.hits:
        _RETRIEVAL_STATS.cache_hits += 1
    elif cache_after.misses > cache_before.misses:
        _RETRIEVAL_STATS.cache_misses += 1
    if not prepared.idf_map:
        _RETRIEVAL_STATS.calls_with_empty_idf += 1
        _RETRIEVAL_STATS.fallback_confidence_only_calls += 1
        return _sort_facts_by_confidence(valid_facts)

    query_vector = _build_tfidf_vector(query_tokens, prepared.idf_map)

    scored_facts: list[tuple[float, float, int, dict[str, Any]]] = []
    debug_rows: list[dict[str, float | int]] = []
    for index, fact in enumerate(valid_facts):
        similarity = _cosine_similarity(query_vector, prepared.fact_vectors[index])
        similarity = max(min_similarity, similarity)
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        final_score = (similarity * similarity_weight) + (confidence * confidence_weight)
        scored_facts.append((final_score, confidence, -index, fact))
        debug_rows.append(
            {
                "index": index,
                "similarity": round(similarity, 6),
                "confidence": round(confidence, 6),
                "final_score": round(final_score, 6),
            }
        )

    scored_facts.sort(reverse=True)
    ranked_facts = [fact for _, _, _, fact in scored_facts]
    _RETRIEVAL_STATS.last_ranked_count = len(ranked_facts)
    score_by_index = {int(row["index"]): row for row in debug_rows}
    _RETRIEVAL_STATS.last_top_scores = [
        score_by_index[index]
        for _, _, neg_index, _ in scored_facts[:3]
        if (index := -neg_index) in score_by_index
    ]
    return ranked_facts

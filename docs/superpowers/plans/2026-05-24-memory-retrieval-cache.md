# Memory Retrieval Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 memory retrieval 引入 facts 侧文档集签名缓存，在不改变外部接口和排序语义的前提下减少重复分词、重复 IDF 计算和重复 facts 向量构建。

**Architecture:** 保持 `rank_memory_facts()` 外部签名不变，在 `retrieval.py` 内新增 `PreparedFactCorpus`、facts 签名生成与 `lru_cache` 预处理函数。query 侧仍按次计算，只复用 facts 语料的预处理结果。测试覆盖缓存命中、缓存失效、行为兼容和 middleware 调用稳定性。

**Tech Stack:** Python 3.12, dataclasses, functools.lru_cache, pytest

---

## 文件结构

### Modify

- `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`：新增 facts 签名、预处理缓存和缓存后的 rank 流程
- `backend/tests/test_memory_retrieval.py`：新增缓存命中/失效/稳定性测试
- `docs/MEMORY_IMPROVEMENTS.md`：补充“已引入 facts 侧缓存”的状态说明

## Task 1: 用测试锁定缓存行为

**Files:**

- Modify: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 先写缓存命中和失效的 failing tests**

```python
from kkoclaw.agents.memory import retrieval as retrieval_module
from kkoclaw.agents.memory.retrieval import rank_memory_facts


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

    rank_memory_facts(facts_a, current_context="A", similarity_weight=0.6, confidence_weight=0.4)
    rank_memory_facts(facts_b, current_context="B", similarity_weight=0.6, confidence_weight=0.4)

    assert call_count == 2
```

- [ ] **Step 2: 运行 retrieval 测试，确认当前会失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: FAIL，提示 `_prepare_fact_corpus_cached` 或 `_prepare_fact_corpus` 不存在，或 `call_count` 断言不成立

- [ ] **Step 3: 再补一个稳定性测试，防止缓存改变排序语义**

```python
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
```

- [ ] **Step 4: 再次运行 retrieval 测试，确认仍是红灯但失败原因正确**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: FAIL，失败点集中在缓存实现缺失，而不是测试语法或导入错误

- [ ] **Step 5: 提交这一小步**

```bash
git add backend/tests/test_memory_retrieval.py
git commit -m "test: cover memory retrieval cache behavior"
```

## Task 2: 实现 facts 文档集签名缓存

**Files:**

- Modify: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`
- Test: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 新增数据结构与签名生成函数**

```python
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class PreparedFactCorpus:
    valid_facts: tuple[dict[str, Any], ...]
    fact_tokens: tuple[tuple[str, ...], ...]
    idf_map: dict[str, float]
    fact_vectors: tuple[dict[str, float], ...]


def build_facts_signature(
    facts: list[dict[str, Any]],
) -> tuple[tuple[str, float, str, str | None], ...]:
    signature: list[tuple[str, float, str, str | None]] = []
    for fact in facts:
        content = fact["content"].strip()
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        category = str(fact.get("category", "context")).strip() or "context"
        source_error = fact.get("sourceError")
        signature.append((content, confidence, category, source_error.strip() if isinstance(source_error, str) else None))
    return tuple(signature)
```

- [ ] **Step 2: 实现 facts 预处理函数和带缓存包装器**

```python
def _prepare_fact_corpus(
    facts_signature: tuple[tuple[str, float, str, str | None], ...],
) -> PreparedFactCorpus:
    valid_facts = tuple(
        {
            "content": content,
            "confidence": confidence,
            "category": category,
            "sourceError": source_error,
        }
        for content, confidence, category, source_error in facts_signature
    )
    fact_tokens = tuple(tuple(tokenize_text(fact["content"])) for fact in valid_facts)
    documents = [list(tokens) for tokens in fact_tokens if tokens]
    if not documents:
        return PreparedFactCorpus(
            valid_facts=valid_facts,
            fact_tokens=fact_tokens,
            idf_map={},
            fact_vectors=tuple({} for _ in valid_facts),
        )

    document_count = len(documents)
    vocabulary = {token for tokens in documents for token in set(tokens)}
    idf_map = {
        token: math.log((1 + document_count) / (1 + sum(1 for tokens in documents if token in set(tokens)))) + 1.0
        for token in vocabulary
    }
    fact_vectors = tuple(_build_tfidf_vector(list(tokens), idf_map) for tokens in fact_tokens)
    return PreparedFactCorpus(
        valid_facts=valid_facts,
        fact_tokens=fact_tokens,
        idf_map=idf_map,
        fact_vectors=fact_vectors,
    )


@lru_cache(maxsize=64)
def _prepare_fact_corpus_cached(
    facts_signature: tuple[tuple[str, float, str, str | None], ...],
) -> PreparedFactCorpus:
    return _prepare_fact_corpus(facts_signature)
```

- [ ] **Step 3: 改造 `rank_memory_facts()` 使用缓存结果**

```python
def rank_memory_facts(...):
    valid_facts = [
        fact
        for fact in facts
        if isinstance(fact, dict) and isinstance(fact.get("content"), str) and fact["content"].strip()
    ]

    if not current_context:
        return sorted(...)

    ...
    query_tokens = tokenize_text(current_context)
    if not query_tokens:
        return sorted(...)

    facts_signature = build_facts_signature(valid_facts)
    prepared = _prepare_fact_corpus_cached(facts_signature)
    if not prepared.idf_map:
        return sorted(...)

    query_vector = _build_tfidf_vector(query_tokens, prepared.idf_map)

    scored_facts: list[tuple[float, float, int, dict[str, Any]]] = []
    for index, fact in enumerate(prepared.valid_facts):
        similarity = _cosine_similarity(query_vector, prepared.fact_vectors[index])
        similarity = max(min_similarity, similarity)
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        final_score = (similarity * similarity_weight) + (confidence * confidence_weight)
        scored_facts.append((final_score, confidence, -index, dict(valid_facts[index])))
```

- [ ] **Step 4: 运行 retrieval 测试，确认缓存测试转绿**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: PASS

- [ ] **Step 5: 做轻量重构，减少重复的 confidence-only fallback**

```python
def _sort_facts_by_confidence(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        facts,
        key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0),
        reverse=True,
    )
```

- [ ] **Step 6: 回跑 retrieval 测试，确认重构后仍然全绿**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: PASS

- [ ] **Step 7: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/agents/memory/retrieval.py backend/tests/test_memory_retrieval.py
git commit -m "feat: cache prepared memory fact corpora"
```

## Task 3: 更新状态文档并做兼容验证

**Files:**

- Modify: `docs/MEMORY_IMPROVEMENTS.md`
- Test: `backend/tests/test_memory_middleware.py`
- Test: `backend/tests/test_memory_prompt_injection.py`

- [ ] **Step 1: 更新 memory 状态文档**

```md
已在 `main` 分支实现：
- 使用 `tiktoken` 在 `format_memory_for_injection` 中进行精确 token 计数。
- 事实被注入到提示词记忆上下文中。
- 事实按置信度排序（降序）。
- 注入遵循 `max_injection_tokens` 预算。
- 基于 TF-IDF 相似度的事实检索。
- 用于上下文感知评分的 `current_context` 输入。
- 可配置的相似度/置信度权重。
- 运行时中间件会在每次 agent 执行前注入按上下文排序后的 facts。
- retrieval 已引入 facts 侧文档集签名缓存，复用分词、IDF 和 facts 向量预处理结果。

当前限制：
- 检索目标仅覆盖 `facts[]`
- `user.*` 与 `history.*` 仍作为摘要背景注入，不参与 retrieval 排序
- 第一版缓存为进程内 `lru_cache`，未做跨进程共享
```

- [ ] **Step 2: 运行 retrieval 相关回归测试**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py tests/test_memory_middleware.py tests/test_memory_prompt_injection.py -v`

Expected: PASS，说明缓存优化没有破坏 middleware 注入和 prompt 渲染

- [ ] **Step 3: 提交这一小步**

```bash
git add docs/MEMORY_IMPROVEMENTS.md backend/tests/test_memory_retrieval.py
git commit -m "docs: record memory retrieval cache behavior"
```

## Task 4: 最终验证与收尾

**Files:**

- Test: `backend/tests/test_memory_retrieval.py`
- Test: `backend/tests/test_memory_middleware.py`
- Test: `backend/tests/test_memory_prompt_injection.py`
- Test: `backend/tests/test_lead_agent_prompt.py`

- [ ] **Step 1: 跑第二阶段优化相关完整测试**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py tests/test_memory_prompt_injection.py tests/test_memory_middleware.py tests/test_lead_agent_prompt.py -v`

Expected: PASS

- [ ] **Step 2: 做语法编译检查**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && python -m compileall backend/packages/harness/kkoclaw/agents/memory backend/packages/harness/kkoclaw/agents/middlewares backend/packages/harness/kkoclaw/agents/lead_agent`

Expected: 无语法错误，输出 `Compiling ...`

- [ ] **Step 3: 查看工作区确认只包含预期修改**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git status --short`

Expected: 仅出现 `retrieval.py`、`test_memory_retrieval.py` 和文档更新

- [ ] **Step 4: 提交最终集成结果**

```bash
git add \
  backend/packages/harness/kkoclaw/agents/memory/retrieval.py \
  backend/tests/test_memory_retrieval.py \
  docs/MEMORY_IMPROVEMENTS.md
git commit -m "feat: cache memory retrieval corpora"
```

## 自检

- spec 中要求的“facts 侧缓存、签名驱动失效、外部接口不变、query 按次计算、测试覆盖命中/失效/兼容性”都已映射到任务
- 计划未使用 `TODO`、`TBD` 或类似占位项
- 计划中的函数名和数据结构保持一致：`PreparedFactCorpus`、`build_facts_signature()`、`_prepare_fact_corpus()`、`_prepare_fact_corpus_cached()`

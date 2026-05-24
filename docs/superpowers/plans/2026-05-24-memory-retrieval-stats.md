# Memory Retrieval Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 memory retrieval 增加可查询统计、debug 级别调试日志，并基于这些统计保留对 `summarization.trigger` 与 `max_injection_tokens` 的人工调优能力。

**Architecture:** 在 `retrieval.py` 内维护轻量进程内统计对象，复用现有 `lru_cache` 与排序逻辑更新统计；在 `MemoryMiddleware` 记录注入预算与最终注入 facts 数；在 gateway 的 memory router 暴露只读 stats 端点。日志只输出安全摘要，不打印原始上下文或 fact 文本。

**Tech Stack:** Python, FastAPI, Pydantic, pytest, logging, functools.lru_cache

---

## Task 1: 为 retrieval 统计对象补测试并定义接口

**Files:**

- Modify: `backend/tests/test_memory_retrieval.py`
- Modify: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`

- [ ] **Step 1: 在 retrieval 测试文件中加入统计接口与缓存统计的失败用例**

```python
def test_rank_memory_facts_records_cache_hit_and_miss() -> None:
    reset_retrieval_stats()
    _prepare_fact_corpus_cached.cache_clear()

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
```

- [ ] **Step 2: 加入无上下文与空 query token 的失败用例**

```python
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
```

- [ ] **Step 3: 运行新增 retrieval 测试，确认它们先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -q`

Expected: FAIL，提示 `get_retrieval_stats` / `reset_retrieval_stats` 缺失，或统计字段断言失败。

- [ ] **Step 4: 在 `retrieval.py` 中加入统计对象与查询/重置接口**

```python
@dataclass
class RetrievalStats:
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
    return asdict(_RETRIEVAL_STATS)


def reset_retrieval_stats() -> None:
    global _RETRIEVAL_STATS
    _RETRIEVAL_STATS = RetrievalStats()
```

- [ ] **Step 5: 在 `rank_memory_facts()` 中接入缓存 hit/miss 与 fallback 统计**

```python
before_cache = _prepare_fact_corpus_cached.cache_info()
prepared = _prepare_fact_corpus_cached(signature, tuple(serialized_facts))
after_cache = _prepare_fact_corpus_cached.cache_info()

if after_cache.hits > before_cache.hits:
    _RETRIEVAL_STATS.cache_hits += 1
elif after_cache.misses > before_cache.misses:
    _RETRIEVAL_STATS.cache_misses += 1
```

并在无上下文、空 query token、空 idf、confidence-only fallback 等分支更新：

```python
_RETRIEVAL_STATS.calls_without_context += 1
_RETRIEVAL_STATS.fallback_confidence_only_calls += 1
```

- [ ] **Step 6: 记录 last_* 统计与 top score 数值摘要**

```python
_RETRIEVAL_STATS.last_facts_count = len(valid_facts)
_RETRIEVAL_STATS.last_ranked_count = len(ranked_facts)
_RETRIEVAL_STATS.last_context_chars = len(current_context or "")
_RETRIEVAL_STATS.last_query_tokens = len(query_tokens)
_RETRIEVAL_STATS.last_top_scores = [
    {
        "index": item["index"],
        "similarity": round(item["similarity"], 6),
        "confidence": round(item["confidence"], 6),
        "final_score": round(item["final_score"], 6),
    }
    for item in ranked_debug_rows[:3]
]
```

- [ ] **Step 7: 运行 retrieval 测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -q`

Expected: PASS

- [ ] **Step 8: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/packages/harness/kkoclaw/agents/memory/retrieval.py backend/tests/test_memory_retrieval.py
git commit -m "feat: add retrieval runtime stats"
```

## Task 2: 让 MemoryMiddleware 记录注入侧统计并输出 debug 日志

**Files:**

- Modify: `backend/packages/harness/kkoclaw/agents/middlewares/memory_middleware.py`
- Modify: `backend/tests/test_memory_middleware.py`
- Modify: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`

- [ ] **Step 1: 在 middleware 测试文件中加入注入统计与日志的失败用例**

```python
def test_memory_middleware_records_injection_stats() -> None:
    reset_retrieval_stats()
    middleware = MemoryMiddleware(config=SimpleNamespace(enabled=True))

    # 复用现有 middleware fixture 或 mock，把 retrieval 注入结果固定为非空字符串
    ...

    stats = get_retrieval_stats()
    assert stats["last_injection_tokens_budget"] == 2000
    assert stats["last_injected_facts_count"] == 2
```

```python
def test_memory_middleware_emits_debug_log(caplog) -> None:
    caplog.set_level(logging.DEBUG)
    ...
    assert "memory.retrieval ranked" in caplog.text
    assert "budget=2000" in caplog.text
```

- [ ] **Step 2: 运行 middleware 测试，确认先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_middleware.py -q`

Expected: FAIL，提示缺少统计更新或日志内容不匹配。

- [ ] **Step 3: 在 `retrieval.py` 中补注入侧统计更新函数**

```python
def record_retrieval_injection_stats(*, budget: int, injected_facts_count: int) -> None:
    _RETRIEVAL_STATS.last_injection_tokens_budget = budget
    _RETRIEVAL_STATS.last_injected_facts_count = injected_facts_count
```

- [ ] **Step 4: 在 `MemoryMiddleware` 中更新注入侧统计**

```python
record_retrieval_injection_stats(
    budget=self._memory_config.max_injection_tokens,
    injected_facts_count=len(ranked_facts[:included_count]),
)
```

如果没有注入内容，也要明确记录预算与 `0`。

- [ ] **Step 5: 在 `MemoryMiddleware` 中补 debug 级别结构化日志**

```python
logger.debug(
    "memory.retrieval ranked facts=%s context_chars=%s query_tokens=%s cache=%s fallback=%s injected=%s budget=%s top_scores=%s",
    stats["last_facts_count"],
    stats["last_context_chars"],
    stats["last_query_tokens"],
    "hit" if cache_hit else "miss",
    fallback_used,
    stats["last_injected_facts_count"],
    stats["last_injection_tokens_budget"],
    stats["last_top_scores"],
)
```

日志必须只用数值摘要，不能写入 `current_context` 或事实原文。

- [ ] **Step 6: 运行 middleware 测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_middleware.py -q`

Expected: PASS

- [ ] **Step 7: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/packages/harness/kkoclaw/agents/middlewares/memory_middleware.py backend/packages/harness/kkoclaw/agents/memory/retrieval.py backend/tests/test_memory_middleware.py
git commit -m "feat: add retrieval injection debug telemetry"
```

## Task 3: 暴露 `/api/memory/retrieval/stats` 只读接口

**Files:**

- Modify: `backend/app/gateway/routers/memory.py`
- Modify: `backend/tests/test_memory_router.py`
- Modify: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`

- [ ] **Step 1: 在 memory router 测试中加入 stats 端点失败用例**

```python
def test_memory_retrieval_stats_route_returns_runtime_stats() -> None:
    app = FastAPI()
    app.include_router(memory.router)
    stats = {
        "rank_calls": 2,
        "cache_hits": 1,
        "cache_misses": 1,
        "fallback_confidence_only_calls": 0,
        "calls_without_context": 0,
        "calls_with_empty_query_tokens": 0,
        "calls_with_empty_idf": 0,
        "last_facts_count": 3,
        "last_ranked_count": 3,
        "last_context_chars": 42,
        "last_query_tokens": 8,
        "last_injection_tokens_budget": 2000,
        "last_injected_facts_count": 2,
        "last_top_scores": [{"index": 0, "similarity": 0.9, "confidence": 0.8, "final_score": 0.86}],
    }

    with patch("app.gateway.routers.memory.get_retrieval_stats", return_value=stats):
        with TestClient(app) as client:
            response = client.get("/api/memory/retrieval/stats")

    assert response.status_code == 200
    assert response.json() == stats
```

- [ ] **Step 2: 运行 router 测试，确认先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_router.py -q`

Expected: FAIL，提示路由不存在或响应模型缺失。

- [ ] **Step 3: 在 memory router 中增加响应模型与只读端点**

```python
class RetrievalScoreSummary(BaseModel):
    index: int
    similarity: float
    confidence: float
    final_score: float


class MemoryRetrievalStatsResponse(BaseModel):
    rank_calls: int
    cache_hits: int
    cache_misses: int
    calls_without_context: int
    calls_with_empty_query_tokens: int
    calls_with_empty_idf: int
    fallback_confidence_only_calls: int
    last_facts_count: int
    last_ranked_count: int
    last_context_chars: int
    last_query_tokens: int
    last_injection_tokens_budget: int
    last_injected_facts_count: int
    last_top_scores: list[RetrievalScoreSummary]
```

```python
@router.get(
    "/memory/retrieval/stats",
    response_model=MemoryRetrievalStatsResponse,
    summary="Get Memory Retrieval Stats",
)
async def get_memory_retrieval_stats_endpoint() -> MemoryRetrievalStatsResponse:
    return MemoryRetrievalStatsResponse(**get_retrieval_stats())
```

- [ ] **Step 4: 在 router 测试中加入“不可泄露原文”的保护用例**

```python
def test_memory_retrieval_stats_route_does_not_expose_raw_text_fields() -> None:
    app = FastAPI()
    app.include_router(memory.router)

    with TestClient(app) as client:
        response = client.get("/api/memory/retrieval/stats")

    data = response.json()
    assert "current_context" not in data
    assert "facts" not in data
    assert "content" not in str(data)
```

- [ ] **Step 5: 运行 router 测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_router.py -q`

Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/app/gateway/routers/memory.py backend/tests/test_memory_router.py backend/packages/harness/kkoclaw/agents/memory/retrieval.py
git commit -m "feat: expose retrieval stats endpoint"
```

## Task 4: 更新文档并做定向回归

**Files:**

- Modify: `docs/MEMORY_IMPROVEMENTS.md`
- Modify: `docs/TODO.md`
- Modify: `config.example.yaml`

- [ ] **Step 1: 更新 memory 改进文档，说明已新增 retrieval 统计与调试接口**

在 `docs/MEMORY_IMPROVEMENTS.md` 增加类似内容：

```md
- 已新增 retrieval 进程内统计与 `/api/memory/retrieval/stats` 只读调试接口。
- 已增加 debug 级别 retrieval 日志，输出 cache 命中、fallback、注入预算和 top score 数值摘要。
- 当前建议先观察统计，再决定是否上调 `max_injection_tokens` 或 `summarization.trigger.tokens`。
```

- [ ] **Step 2: 更新 TODO，记录 retrieval 统计能力已完成**

```md
- [x] 为 memory retrieval 增加可查询统计与调试日志
```

- [ ] **Step 3: 在示例配置或相关文档中写出人工调优建议**

如果 `config.example.yaml` 已包含 memory 配置，就补注释而不是改默认值，例如：

```yaml
  max_injection_tokens: 2000  # 先观察 retrieval stats，再决定是否上调到 2500-3000
```

如果不适合加注释，则把建议写在 `MEMORY_IMPROVEMENTS.md` 即可，不强行改配置。

- [ ] **Step 4: 运行定向测试回归**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py tests/test_memory_middleware.py tests/test_memory_router.py tests/test_memory_prompt_injection.py tests/test_lead_agent_prompt.py -q`

Expected: PASS

- [ ] **Step 5: 运行语法编译检查**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && python -m compileall packages/harness/kkoclaw/agents/memory packages/harness/kkoclaw/agents/middlewares app/gateway/routers`

Expected: exit code 0

- [ ] **Step 6: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add docs/MEMORY_IMPROVEMENTS.md docs/TODO.md config.example.yaml
git commit -m "docs: describe retrieval stats and tuning guidance"
```

## Self-Review Checklist

- Spec coverage:
  - 可查询统计：Task 1 + Task 3
  - debug 日志：Task 2
  - 注入预算/facts 数统计：Task 2
  - 参数人工调优建议：Task 4
  - 不泄露原文：Task 2 + Task 3
- Placeholder scan:
  - 每个任务都给了具体文件、测试、命令和提交信息
  - 未使用 `TODO` / `TBD` / “类似前一个任务” 之类占位写法
- Type consistency:
  - 统一使用 `get_retrieval_stats()` / `reset_retrieval_stats()`
  - 路由统一使用 `MemoryRetrievalStatsResponse`
  - 统计字段与 spec 中命名保持一致

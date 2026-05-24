# Memory Context-Aware Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 memory facts 注入实现基于 `current_context` 的 TF-IDF 检索与加权排序，并在无上下文或异常时回退到当前的 confidence-only 行为。

**Architecture:** 在 `lead_agent` prompt 构建阶段提取近期上下文，交给独立的 `agents/memory/retrieval.py` 做 TF-IDF 排序；`agents/memory/prompt.py` 继续负责渲染和 token budget 控制。`memory_config.py` 增加 `retrieval` 子配置，保持旧配置兼容。

**Tech Stack:** Python 3.12, Pydantic, pytest, 纯 Python TF-IDF 稀疏向量实现

---

## 文件结构

### Create

- `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`：current context 提取、文本规范化、TF-IDF、相似度与 fact 排序
- `backend/tests/test_memory_retrieval.py`：retrieval 层单测

### Modify

- `backend/packages/harness/kkoclaw/config/memory_config.py`：新增 `MemoryRetrievalConfig` 与 `MemoryConfig.retrieval`
- `backend/packages/harness/kkoclaw/agents/memory/prompt.py`：支持 `ranked_facts` 参数，并保留旧行为兼容
- `backend/packages/harness/kkoclaw/agents/memory/__init__.py`：导出 retrieval 相关函数
- `backend/packages/harness/kkoclaw/agents/lead_agent/prompt.py`：构建 `current_context` 并在注入前调用 retrieval
- `backend/tests/test_memory_prompt_injection.py`：补充 `ranked_facts` 和兼容性测试
- `backend/tests/test_lead_agent_prompt.py`：补充 retrieval 注入集成测试
- `config.example.yaml`：新增 `memory.retrieval` 示例配置
- `docs/MEMORY_IMPROVEMENTS.md`：更新状态说明

## Task 1: 扩展 Memory 配置模型

**Files:**

- Modify: `backend/packages/harness/kkoclaw/config/memory_config.py`
- Test: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 先写配置模型的 failing test**

```python
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
```

- [ ] **Step 2: 运行测试，确认当前会失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_retrieval.py::test_memory_config_defaults_retrieval_disabled -v`

Expected: FAIL，提示 `MemoryConfig` 没有 `retrieval` 字段或测试文件不存在

- [ ] **Step 3: 在 `memory_config.py` 新增 retrieval 配置模型**

```python
from typing import Literal

from pydantic import BaseModel, Field


class MemoryRetrievalConfig(BaseModel):
    """Configuration for context-aware memory fact retrieval."""

    enabled: bool = Field(default=False, description="Whether to enable context-aware memory retrieval")
    strategy: Literal["tfidf"] = Field(default="tfidf", description="Fact retrieval strategy")
    context_max_turns: int = Field(default=4, ge=1, le=12, description="Recent user/final-assistant turns used to build current context")
    context_max_chars: int = Field(default=4000, ge=200, le=20000, description="Maximum characters retained in the current context query")
    similarity_weight: float = Field(default=0.6, ge=0.0, le=1.0, description="Weight applied to similarity score")
    confidence_weight: float = Field(default=0.4, ge=0.0, le=1.0, description="Weight applied to fact confidence")
    min_similarity: float = Field(default=0.0, ge=0.0, le=1.0, description="Minimum similarity floor for ranking")


class MemoryConfig(BaseModel):
    ...
    max_injection_tokens: int = Field(
        default=2000,
        ge=100,
        le=8000,
        description="Maximum tokens to use for memory injection",
    )
    retrieval: MemoryRetrievalConfig = Field(
        default_factory=MemoryRetrievalConfig,
        description="Context-aware memory retrieval configuration",
    )
```

- [ ] **Step 4: 运行测试，确认配置模型生效**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_retrieval.py::test_memory_config_defaults_retrieval_disabled -v`

Expected: PASS

- [ ] **Step 5: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/config/memory_config.py backend/tests/test_memory_retrieval.py
git commit -m "feat: add memory retrieval config model"
```

## Task 2: 实现 retrieval 层与排序逻辑

**Files:**

- Create: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`
- Modify: `backend/packages/harness/kkoclaw/agents/memory/__init__.py`
- Test: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 先写 retrieval 层测试**

```python
from kkoclaw.agents.memory.retrieval import extract_current_context, rank_memory_facts


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
```

- [ ] **Step 2: 运行 retrieval 测试，确认会失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_retrieval.py -v`

Expected: FAIL，提示 `kkoclaw.agents.memory.retrieval` 模块不存在

- [ ] **Step 3: 写 retrieval 最小实现**

```python
import math
import re
from collections import Counter
from typing import Any

from kkoclaw.agents.memory.message_processing import filter_messages_for_memory
from kkoclaw.agents.memory.prompt import _coerce_confidence

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+-]*|[\u4e00-\u9fff]+")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).strip().lower())


def tokenize_text(text: str) -> list[str]:
    normalized = normalize_text(text)
    return _TOKEN_RE.findall(normalized)


def _tfidf_vector(tokens: list[str], idf_map: dict[str, float]) -> dict[str, float]:
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
    filtered = filter_messages_for_memory(messages)
    turns: list[str] = []
    for message in reversed(filtered):
        msg_type = getattr(message, "type", None)
        if msg_type not in {"human", "ai"}:
            continue
        text = str(getattr(message, "content", "")).strip()
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
    return context[:max_chars].strip() or None


def rank_memory_facts(
    facts: list[dict[str, Any]],
    *,
    current_context: str | None,
    similarity_weight: float,
    confidence_weight: float,
    min_similarity: float = 0.0,
) -> list[dict[str, Any]]:
    valid_facts = [fact for fact in facts if isinstance(fact, dict) and isinstance(fact.get("content"), str) and fact["content"].strip()]
    if not current_context:
        return sorted(valid_facts, key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0), reverse=True)

    weights_sum = similarity_weight + confidence_weight
    if weights_sum <= 0:
        similarity_weight, confidence_weight = 0.6, 0.4
    else:
        similarity_weight /= weights_sum
        confidence_weight /= weights_sum

    fact_tokens = [tokenize_text(fact["content"]) for fact in valid_facts]
    query_tokens = tokenize_text(current_context)
    documents = [tokens for tokens in fact_tokens if tokens] + ([query_tokens] if query_tokens else [])
    if not documents or not query_tokens:
        return sorted(valid_facts, key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0), reverse=True)

    doc_count = len(documents)
    vocabulary = sorted({token for tokens in documents for token in set(tokens)})
    idf_map = {
        token: math.log((1 + doc_count) / (1 + sum(1 for tokens in documents if token in set(tokens)))) + 1.0
        for token in vocabulary
    }
    query_vec = _tfidf_vector(query_tokens, idf_map)

    scored: list[tuple[float, float, int, dict[str, Any]]] = []
    for index, fact in enumerate(valid_facts):
        similarity = _cosine_similarity(query_vec, _tfidf_vector(fact_tokens[index], idf_map))
        similarity = max(min_similarity, similarity)
        confidence = _coerce_confidence(fact.get("confidence"), default=0.0)
        final_score = similarity * similarity_weight + confidence * confidence_weight
        scored.append((final_score, confidence, -index, fact))

    scored.sort(reverse=True)
    return [fact for _, _, _, fact in scored]
```

- [ ] **Step 4: 导出 retrieval 接口**

```python
from kkoclaw.agents.memory.retrieval import extract_current_context, rank_memory_facts

__all__ = [
    ...
    "extract_current_context",
    "rank_memory_facts",
]
```

- [ ] **Step 5: 运行 retrieval 测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_retrieval.py -v`

Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/agents/memory/retrieval.py backend/packages/harness/kkoclaw/agents/memory/__init__.py backend/tests/test_memory_retrieval.py
git commit -m "feat: add memory fact retrieval ranking"
```

## Task 3: 扩展 memory prompt 渲染接口

**Files:**

- Modify: `backend/packages/harness/kkoclaw/agents/memory/prompt.py`
- Test: `backend/tests/test_memory_prompt_injection.py`

- [ ] **Step 1: 先补 `ranked_facts` 的 failing test**

```python
def test_format_memory_prefers_ranked_facts_when_provided() -> None:
    memory_data = {
        "facts": [
            {"content": "Low confidence fact", "category": "context", "confidence": 0.2},
            {"content": "High confidence fact", "category": "context", "confidence": 0.9},
        ]
    }
    ranked_facts = [
        {"content": "Low confidence fact", "category": "context", "confidence": 0.2},
        {"content": "High confidence fact", "category": "context", "confidence": 0.9},
    ]

    result = format_memory_for_injection(memory_data, max_tokens=2000, ranked_facts=ranked_facts)

    assert result.index("Low confidence fact") < result.index("High confidence fact")
```

- [ ] **Step 2: 运行单测，确认接口尚不存在**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_prompt_injection.py::test_format_memory_prefers_ranked_facts_when_provided -v`

Expected: FAIL，提示 `format_memory_for_injection()` 不接受 `ranked_facts`

- [ ] **Step 3: 在 `prompt.py` 增加 `ranked_facts` 参数并保持旧行为**

```python
def format_memory_for_injection(
    memory_data: dict[str, Any],
    max_tokens: int = 2000,
    ranked_facts: list[dict[str, Any]] | None = None,
) -> str:
    ...
    facts_data = ranked_facts if ranked_facts is not None else memory_data.get("facts", [])
    if isinstance(facts_data, list) and facts_data:
        ranked_facts_data = (
            facts_data
            if ranked_facts is not None
            else sorted(
                (
                    f
                    for f in facts_data
                    if isinstance(f, dict) and isinstance(f.get("content"), str) and f.get("content").strip()
                ),
                key=lambda fact: _coerce_confidence(fact.get("confidence"), default=0.0),
                reverse=True,
            )
        )
        ...
        for fact in ranked_facts_data:
            ...
```

- [ ] **Step 4: 运行 prompt 注入测试，确认全部通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_prompt_injection.py -v`

Expected: PASS

- [ ] **Step 5: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/agents/memory/prompt.py backend/tests/test_memory_prompt_injection.py
git commit -m "feat: support pre-ranked memory facts for injection"
```

## Task 4: 在 lead agent prompt 中接入 current_context 与 retrieval

**Files:**

- Modify: `backend/packages/harness/kkoclaw/agents/lead_agent/prompt.py`
- Test: `backend/tests/test_lead_agent_prompt.py`

- [ ] **Step 1: 先写 lead agent 集成测试**

```python
from unittest.mock import MagicMock

from kkoclaw.config.memory_config import MemoryConfig, MemoryRetrievalConfig


def test_get_memory_context_uses_ranked_facts_when_retrieval_enabled(monkeypatch) -> None:
    app_config = MagicMock()
    app_config.memory = MemoryConfig(
        enabled=True,
        injection_enabled=True,
        retrieval=MemoryRetrievalConfig(enabled=True),
    )
    monkeypatch.setattr("kkoclaw.agents.lead_agent.prompt.get_memory_data", lambda *args, **kwargs: {"facts": [{"content": "a", "category": "goal", "confidence": 0.3}]})
    monkeypatch.setattr("kkoclaw.agents.lead_agent.prompt.extract_current_context", lambda *args, **kwargs: "current context")
    monkeypatch.setattr("kkoclaw.agents.lead_agent.prompt.rank_memory_facts", lambda facts, **kwargs: [{"content": "ranked", "category": "goal", "confidence": 0.3}])

    result = _get_memory_context(agent_name=None, app_config=app_config)

    assert "ranked" in result
```

- [ ] **Step 2: 运行测试，确认当前实现尚未调用 retrieval**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_lead_agent_prompt.py::test_get_memory_context_uses_ranked_facts_when_retrieval_enabled -v`

Expected: FAIL，提示 `extract_current_context` / `rank_memory_facts` 未被调用或结果中不含 `ranked`

- [ ] **Step 3: 在 `lead_agent/prompt.py` 接入 retrieval**

```python
from kkoclaw.agents.memory import (
    extract_current_context,
    format_memory_for_injection,
    get_memory_data,
    rank_memory_facts,
)


def _get_memory_context(
    agent_name: str | None = None,
    *,
    app_config: AppConfig | None = None,
    messages: list[Any] | None = None,
) -> str:
    ...
    memory_data = get_memory_data(agent_name, user_id=get_effective_user_id())
    ranked_facts = None
    retrieval_config = config.retrieval

    if retrieval_config.enabled:
        try:
            current_context = extract_current_context(
                messages or [],
                max_turns=retrieval_config.context_max_turns,
                max_chars=retrieval_config.context_max_chars,
            )
            ranked_facts = rank_memory_facts(
                memory_data.get("facts", []),
                current_context=current_context,
                similarity_weight=retrieval_config.similarity_weight,
                confidence_weight=retrieval_config.confidence_weight,
                min_similarity=retrieval_config.min_similarity,
            )
        except Exception:
            logger.exception("Failed to rank memory facts; falling back to confidence ordering")

    memory_content = format_memory_for_injection(
        memory_data,
        max_tokens=config.max_injection_tokens,
        ranked_facts=ranked_facts,
    )
```

- [ ] **Step 4: 把调用点传入当前消息**

```python
memory_section = _get_memory_context(
    agent_name=agent_name,
    app_config=app_config,
    messages=messages,
)
```

- [ ] **Step 5: 运行 lead agent prompt 测试**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_lead_agent_prompt.py -v`

Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/agents/lead_agent/prompt.py backend/tests/test_lead_agent_prompt.py
git commit -m "feat: wire memory retrieval into lead agent prompt"
```

## Task 5: 更新示例配置与状态文档

**Files:**

- Modify: `config.example.yaml`
- Modify: `docs/MEMORY_IMPROVEMENTS.md`

- [ ] **Step 1: 在示例配置中加入 retrieval 配置块**

```yaml
memory:
  enabled: true
  storage_path: memory.json
  debounce_seconds: 30
  model_name: null
  max_facts: 100
  fact_confidence_threshold: 0.7
  injection_enabled: true
  max_injection_tokens: 2000
  retrieval:
    enabled: false
    strategy: tfidf
    context_max_turns: 4
    context_max_chars: 4000
    similarity_weight: 0.6
    confidence_weight: 0.4
    min_similarity: 0.0
```

- [ ] **Step 2: 更新 `MEMORY_IMPROVEMENTS.md` 的状态说明**

```md
已在 `main` 分支实现：
- 使用 `tiktoken` 在 `format_memory_for_injection` 中进行精确 token 计数。
- 事实被注入到提示词记忆上下文中。
- 事实按置信度排序（降序）。
- 注入遵循 `max_injection_tokens` 预算。
- 基于 TF-IDF 相似度的 facts 检索。
- `current_context` 驱动的上下文感知排序。
- `similarity_weight` / `confidence_weight` 加权排序。

当前限制：
- 检索目标仅覆盖 `facts[]`
- `user.*` 与 `history.*` 仍始终注入，不参与检索排序
- 第一版未引入缓存或 embedding 检索
```

- [ ] **Step 3: 运行 targeted 验证，确保文档与配置无语法问题**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && python - <<'PY'\nimport yaml, pathlib\ntext = pathlib.Path('config.example.yaml').read_text()\nyaml.safe_load(text)\nprint('config.example.yaml ok')\nPY`

Expected: 输出 `config.example.yaml ok`

- [ ] **Step 4: 提交这一小步**

```bash
git add config.example.yaml docs/MEMORY_IMPROVEMENTS.md
git commit -m "docs: document memory retrieval configuration"
```

## Task 6: 完整验证与收尾

**Files:**

- Test: `backend/tests/test_memory_retrieval.py`
- Test: `backend/tests/test_memory_prompt_injection.py`
- Test: `backend/tests/test_lead_agent_prompt.py`

- [ ] **Step 1: 跑 memory 相关 targeted test suite**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && pytest tests/test_memory_retrieval.py tests/test_memory_prompt_injection.py tests/test_lead_agent_prompt.py -v`

Expected: PASS，所有新增与相关既有测试通过

- [ ] **Step 2: 检查静态诊断**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && python -m compileall backend/packages/harness/kkoclaw/agents/memory backend/packages/harness/kkoclaw/agents/lead_agent backend/packages/harness/kkoclaw/config`

Expected: 无语法错误，输出 `Compiling ...`

- [ ] **Step 3: 查看工作区确认仅包含预期修改**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git status --short`

Expected: 仅出现本计划涉及的文件变更

- [ ] **Step 4: 提交最终集成改动**

```bash
git add \
  backend/packages/harness/kkoclaw/agents/memory/retrieval.py \
  backend/packages/harness/kkoclaw/agents/memory/prompt.py \
  backend/packages/harness/kkoclaw/agents/memory/__init__.py \
  backend/packages/harness/kkoclaw/agents/lead_agent/prompt.py \
  backend/packages/harness/kkoclaw/config/memory_config.py \
  backend/tests/test_memory_retrieval.py \
  backend/tests/test_memory_prompt_injection.py \
  backend/tests/test_lead_agent_prompt.py \
  config.example.yaml \
  docs/MEMORY_IMPROVEMENTS.md
git commit -m "feat: add context-aware memory fact retrieval"
```

## 自检

- spec 中要求的 `current_context`、TF-IDF、加权排序、回退行为、配置项、测试和文档更新均已映射到任务
- 计划未使用 `TODO`、`TBD` 或“稍后实现”这类占位内容
- 后续任务中使用的函数名与前文保持一致：`extract_current_context`、`rank_memory_facts`、`format_memory_for_injection(..., ranked_facts=...)`

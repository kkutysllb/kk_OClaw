# Memory Tokenizer Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 `tokenize_text()` 对中文短语和技术词的切分能力，在不引入新依赖和不改变 retrieval 外部接口的前提下提高 facts 检索召回率。

**Architecture:** 保持所有实现留在 `backend/packages/harness/kkoclaw/agents/memory/retrieval.py` 中，通过少量内部 helper 为 `tokenize_text()` 增加“原词 + 展开词”规则。先用测试锁定中文 n-gram、技术词拆分、驼峰拆分、路径片段和去重顺序，再做最小实现，并通过 retrieval 排序测试验证行为收益。

**Tech Stack:** Python 3.12, `re`, `functools.lru_cache`, `pytest`

---

## 文件结构

### Modify

- `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`：新增 tokenizer helper，增强 `tokenize_text()`
- `backend/tests/test_memory_retrieval.py`：新增 tokenizer 行为测试与基于排序的回归测试
- `docs/MEMORY_IMPROVEMENTS.md`：补充“已增强中文/技术词切分”的状态说明

## Task 1: 用测试锁定 tokenizer 目标行为

**Files:**

- Modify: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 先写 `tokenize_text()` 的 failing tests**

```python
from kkoclaw.agents.memory.retrieval import rank_memory_facts, tokenize_text


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
```

- [ ] **Step 2: 再写 retrieval 排序层面的 failing tests**

```python
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
```

- [ ] **Step 3: 运行 retrieval 测试，确认这些新增测试先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: FAIL，失败点集中在 `tokenize_text()` 还没有中文 n-gram、驼峰拆分、路径拆分或去重逻辑

- [ ] **Step 4: 提交这一小步**

```bash
git add backend/tests/test_memory_retrieval.py
git commit -m "test: cover memory tokenizer enhancement"
```

## Task 2: 在 `retrieval.py` 中实现规则增强 tokenizer

**Files:**

- Modify: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`
- Test: `backend/tests/test_memory_retrieval.py`

- [ ] **Step 1: 新增 tokenizer helper 常量与函数**

```python
_TECH_SPLIT_RE = re.compile(r"[-_./:+]+")
_CAMEL_CASE_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+\d*|\d+[A-Za-z]+|\d+")


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
    parts = [part.lower() for part in _CAMEL_CASE_RE.findall(token) if len(part) >= 2]
    return parts if len(parts) > 1 else []


def _split_technical_token(token: str) -> list[str]:
    parts = [part for part in _TECH_SPLIT_RE.split(token) if len(part) >= 2]
    expanded: list[str] = []
    for part in parts:
        expanded.append(part)
        expanded.extend(_split_camel_case_token(part))
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
```

- [ ] **Step 2: 用最小改动重写 `tokenize_text()`**

```python
def tokenize_text(text: str) -> list[str]:
    """Tokenize mixed Chinese / English / technical text without extra deps."""
    normalized = normalize_text(text)
    if not normalized:
        return []

    expanded_tokens: list[str] = []
    for base_token in _TOKEN_RE.findall(normalized):
        expanded_tokens.append(base_token)

        if _is_chinese_token(base_token):
            expanded_tokens.extend(_generate_chinese_ngrams(base_token))
            continue

        expanded_tokens.extend(_split_technical_token(base_token))
        expanded_tokens.extend(_split_camel_case_token(base_token))

    return _dedupe_preserve_order(expanded_tokens)
```

- [ ] **Step 3: 运行 retrieval 测试，确认 tokenizer 新测试转绿**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: PASS

- [ ] **Step 4: 做轻量收敛，避免英文子词过短或重复展开**

```python
def _split_technical_token(token: str) -> list[str]:
    parts = [part for part in _TECH_SPLIT_RE.split(token) if len(part) >= 2]
    expanded: list[str] = []
    for part in parts:
        lowered = part.lower()
        if len(lowered) >= 2:
            expanded.append(lowered)
        expanded.extend(_split_camel_case_token(part))
    return expanded
```

- [ ] **Step 5: 回跑 retrieval 测试，确认重构后仍然全绿**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py -v`

Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add backend/packages/harness/kkoclaw/agents/memory/retrieval.py backend/tests/test_memory_retrieval.py
git commit -m "feat: enhance memory tokenizer rules"
```

## Task 3: 更新文档并验证缓存与排序兼容性

**Files:**

- Modify: `docs/MEMORY_IMPROVEMENTS.md`
- Test: `backend/tests/test_memory_prompt_injection.py`
- Test: `backend/tests/test_memory_middleware.py`
- Test: `backend/tests/test_lead_agent_prompt.py`

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
- `tokenize_text()` 已增强中文 2/3-gram、技术词分隔符拆分、驼峰拆分和路径片段切分。
```

- [ ] **Step 2: 运行 tokenizer 相关完整回归测试**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py tests/test_memory_prompt_injection.py tests/test_memory_middleware.py tests/test_lead_agent_prompt.py -v`

Expected: PASS，说明 tokenizer 增强没有破坏 retrieval 缓存、middleware 注入和 prompt 渲染

- [ ] **Step 3: 提交这一小步**

```bash
git add docs/MEMORY_IMPROVEMENTS.md
git commit -m "docs: record memory tokenizer enhancement"
```

## Task 4: 最终验证与收尾

**Files:**

- Test: `backend/tests/test_memory_retrieval.py`
- Test: `backend/tests/test_memory_prompt_injection.py`
- Test: `backend/tests/test_memory_middleware.py`
- Test: `backend/tests/test_lead_agent_prompt.py`
- Test: `backend/packages/harness/kkoclaw/agents/memory/retrieval.py`

- [ ] **Step 1: 跑最终验证命令**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_memory_retrieval.py tests/test_memory_prompt_injection.py tests/test_memory_middleware.py tests/test_lead_agent_prompt.py -q`

Expected: `N passed`

- [ ] **Step 2: 做语法编译检查**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && python -m compileall backend/packages/harness/kkoclaw/agents/memory backend/packages/harness/kkoclaw/agents/middlewares backend/packages/harness/kkoclaw/agents/lead_agent`

Expected: 无语法错误，输出 `Compiling ...`

- [ ] **Step 3: 查看工作区确认只包含预期修改**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git status --short`

Expected: 仅出现 `retrieval.py`、`test_memory_retrieval.py` 和 `MEMORY_IMPROVEMENTS.md`，外加本计划文档

- [ ] **Step 4: 提交最终集成结果**

```bash
git add \
  backend/packages/harness/kkoclaw/agents/memory/retrieval.py \
  backend/tests/test_memory_retrieval.py \
  docs/MEMORY_IMPROVEMENTS.md \
  docs/superpowers/plans/2026-05-24-memory-tokenizer-enhancement.md
git commit -m "feat: enhance memory tokenizer"
```

## 自检

- spec 里要求的“中文 2/3-gram、技术词与驼峰拆分、路径片段、无新依赖、缓存兼容、测试覆盖与噪音控制”都已映射到任务
- 计划没有使用 `TODO`、`TBD` 或类似占位项
- 函数名在各任务中保持一致：`tokenize_text()`、`_is_chinese_token()`、`_generate_chinese_ngrams()`、`_split_camel_case_token()`、`_split_technical_token()`、`_dedupe_preserve_order()`

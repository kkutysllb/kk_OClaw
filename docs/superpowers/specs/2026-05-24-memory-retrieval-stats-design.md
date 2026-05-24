# Memory Retrieval Stats Design

## 背景

当前项目已经具备以下 memory retrieval 能力：

- 从近期用户/最终助手消息中提取 `current_context`
- 对 `facts[]` 执行 TF-IDF 相似度排序
- 使用 `similarity + confidence` 加权评分
- 使用 facts 侧文档集签名缓存复用分词、IDF 与 facts 向量
- 通过 `MemoryMiddleware.before_agent()` 在运行时注入排序后的 facts
- 使用增强版 `tokenize_text()` 改善中文和技术词召回

当前问题不是“能力缺失”，而是“缺少观察面”：

1. 无法直接查看 retrieval cache 的命中率
2. 无法方便查看 retrieval 是否经常因缺少 `current_context` 或空 query 而回退
3. 无法量化当前 tokenizer 增强后是否真的改善了检索效果
4. 无法基于真实运行统计判断 `summarization.trigger` 与 `max_injection_tokens` 是否需要微调

当前 `config.yaml` 相关值为：

```yaml
summarization:
  trigger:
  - type: tokens
    value: 15564

memory:
  max_injection_tokens: 2000
  retrieval:
    enabled: true
```

这组值目前偏保守但并不错误。当前更需要的是“先可观察，再决定是否微调”，而不是直接自动改配置。

## 目标

本次改造需要完成以下目标：

1. 为 retrieval 增加可查询的运行统计
2. 暴露一个只读查询入口，用于查看 retrieval cache 与排序运行状态
3. 不泄露用户原始上下文或事实文本
4. 基于当前实现，对 `summarization.trigger` 与 `max_injection_tokens` 给出人工调优建议

## 非目标

本次改造不包含以下内容：

- 不做自动调参
- 不做持久化统计
- 不接入 Prometheus、OpenTelemetry 或外部监控系统
- 不改变 retrieval 排序公式
- 不改变 summarization 逻辑
- 不新增复杂权限模型

## 设计原则

- 以只读调试能力为主，不改变核心行为
- 统计只保留聚合指标和安全摘要，不返回敏感原文
- 先提供足够观察性，再决定后续是否需要自动告警或配置调优
- 尽量复用现有 memory / middleware / gateway 结构

## 方案选项

### 方案 A：只做 debug 日志

优点：

- 实现最轻

缺点：

- 不可查询
- 线上或长时间运行后不方便回看

### 方案 B：可查询统计 + debug 日志（推荐）

做法：

- 在进程内维护 retrieval 统计
- 提供只读查询接口
- 同时在 debug 级别打印结构化日志

优点：

- 兼顾线上排查与本地调试
- 改动仍然可控

缺点：

- 比单纯日志多一个查询面

### 方案 C：可查询统计 + 自动建议/告警

优点：

- 更智能

缺点：

- 范围显著扩大
- 容易在缺少长期统计基础时过早自动化

## 推荐方案

推荐采用 `方案 B：可查询统计 + debug 日志`，但“调优部分”只输出人工建议，不做自动执行。

## 统计设计

### 统计范围

统计覆盖 retrieval 排序流程，不覆盖 memory 写回流程。

重点在 `rank_memory_facts()` 和 `MemoryMiddleware._build_retrieval_injection()` 两个阶段：

- 排序阶段：query、cache、候选数、回退原因
- 注入阶段：注入文本是否为空、最终注入 facts 数与预算相关摘要

### 建议统计项

建议维护一个进程内统计对象，包含：

- `rank_calls`
- `cache_hits`
- `cache_misses`
- `calls_without_context`
- `calls_with_empty_query_tokens`
- `calls_with_empty_idf`
- `fallback_confidence_only_calls`
- `last_facts_count`
- `last_ranked_count`
- `last_context_chars`
- `last_query_tokens`
- `last_injection_tokens_budget`
- `last_injected_facts_count`
- `last_top_scores`

其中：

- `last_top_scores` 只保留数值摘要，不保留完整 fact 文本
- 可选保存每个 top fact 的：
  - index
  - confidence
  - similarity
  - final_score

## 数据结构建议

建议在 `retrieval.py` 中增加轻量状态对象，例如：

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
    last_top_scores: list[dict[str, float | int]]
```

同时提供：

- `get_retrieval_stats()`
- `reset_retrieval_stats()`（仅调试/测试用）

## cache hit/miss 统计策略

当前缓存实现基于：

```python
@lru_cache(maxsize=64)
def _prepare_fact_corpus_cached(...)
```

但 `lru_cache` 默认不会在业务层自动暴露本次调用是否命中。

建议做法：

- 在调用 `_prepare_fact_corpus_cached()` 前后读取 `cache_info()`
- 通过 `hits` / `misses` 计数变化判断本次调用命中还是未命中
- 然后同步更新 `RetrievalStats`

这样无需重写缓存机制。

## 调试日志设计

建议只在 `debug` 级别输出 retrieval 结构化日志。

推荐内容：

- facts 总数
- current_context 字符数
- query token 数
- cache hit/miss
- 是否 fallback 到 confidence-only
- top 3 facts 的数值摘要
- 注入预算与最终注入 fact 数

示例风格：

```text
memory.retrieval ranked facts=18 context_chars=356 query_tokens=42 cache=hit fallback=false injected=6 budget=2000 top_scores=[...]
```

要求：

- 不打印完整 `current_context`
- 不打印完整 fact 文本

## 可查询入口设计

### 推荐形态

推荐通过现有 gateway 增加一个只读调试接口，例如：

- `GET /memory/retrieval/stats`

返回内容示例：

```json
{
  "rank_calls": 42,
  "cache_hits": 31,
  "cache_misses": 11,
  "fallback_confidence_only_calls": 6,
  "calls_without_context": 4,
  "calls_with_empty_query_tokens": 2,
  "last_facts_count": 18,
  "last_ranked_count": 18,
  "last_context_chars": 356,
  "last_query_tokens": 42,
  "last_injection_tokens_budget": 2000,
  "last_injected_facts_count": 6,
  "last_top_scores": [
    {"index": 0, "similarity": 0.82, "confidence": 0.91, "final_score": 0.856},
    {"index": 1, "similarity": 0.67, "confidence": 0.88, "final_score": 0.754}
  ]
}
```

### 安全约束

该接口必须：

- 只返回聚合统计与数值摘要
- 不返回原始对话内容
- 不返回原始 fact 文本

## `summarization.trigger` 与 `max_injection_tokens` 的审视结论

### 当前值

- `summarization.trigger.tokens = 15564`
- `memory.max_injection_tokens = 2000`

### 当前判断

这组参数在当前 64k 模型配置下属于“偏保守但合理”：

- `15564` 让摘要触发明显早于模型上限，避免对话长尾失控
- `2000` 让 memory 注入保持在较低预算内，不至于和主对话、工具结果抢上下文

### 是否立即调整

本次建议：

- 不自动修改这两个值
- 先通过 retrieval 统计观察真实运行情况

### 后续人工调优条件

如果统计长期显示以下现象，再考虑微调：

1. retrieval 排序经常成功，但 `last_injected_facts_count` 长期偏小
   - 可考虑把 `max_injection_tokens` 提高到 `2500-3000`

2. retrieval 注入与主对话上下文竞争不明显，但摘要过早触发
   - 可考虑把 `summarization.trigger.tokens` 提高到 `18000-22000`

3. retrieval 经常 fallback 到无上下文
   - 这通常不是 `max_injection_tokens` 问题，而是 `context_max_turns/context_max_chars` 或消息过滤问题

## 测试设计

建议新增测试覆盖：

### 1. 统计正确性

- 命中缓存时 `cache_hits` 增加
- miss 时 `cache_misses` 增加
- 无上下文时 `calls_without_context` 与 `fallback_confidence_only_calls` 增加

### 2. 注入侧统计

- `MemoryMiddleware` 成功注入时记录：
  - `last_injection_tokens_budget`
  - `last_injected_facts_count`

### 3. 查询接口

- 查询接口返回结构正确
- 返回内容不包含原始对话文本或 fact 原文

### 4. 日志行为

- 可选通过 `caplog` 验证 debug 日志关键字段存在

## 风险与缓解

### 风险 1：调试接口泄露敏感信息

缓解：

- 只返回数值摘要
- 明确禁止暴露原文

### 风险 2：统计逻辑影响主路径性能

缓解：

- 仅维护轻量内存计数
- 不做持久化
- 不做复杂聚合

### 风险 3：过早根据少量样本修改配置

缓解：

- 本次只提供建议，不自动调整
- 等有稳定运行数据后再手动微调

## 最终结论

本次建议实现：

- retrieval 的进程内可查询统计
- debug 级别的结构化调试日志
- 一个只读查询接口查看 retrieval 运行状态
- 对 `summarization.trigger` 与 `max_injection_tokens` 给出基于统计的人工调优建议

本次不做：

- 自动调参
- 持久化监控
- 外部指标系统接入

这样可以先建立“观察能力”，再基于真实运行数据判断 tokenizer 增强后的实际效果，以及当前摘要阈值和注入预算是否需要进一步微调。

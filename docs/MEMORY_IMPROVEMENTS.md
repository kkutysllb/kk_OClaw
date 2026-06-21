# 记忆系统改进

本文档记录记忆注入行为及路线图状态。

## 状态（截至 2026-05-24）

已在 `main` 分支实现：

- 使用 `tiktoken` 在 `format_memory_for_injection` 中进行精确 token 计数。
- 事实被注入到提示词记忆上下文中。
- 事实按置信度排序（降序）。
- 注入遵循 `max_injection_tokens` 预算。
- 基于 TF-IDF 相似度的事实检索。
- 用于上下文感知评分的 `current_context` 输入。
- 可配置的相似度/置信度权重（`similarity_weight`、`confidence_weight`）。
- 运行时中间件会在每次 agent 执行前注入按上下文排序后的 facts。
- retrieval 已引入 facts 侧文档集签名缓存，复用分词、IDF 和 facts 向量预处理结果。
- `tokenize_text()` 已增强中文 2/3-gram、技术词分隔符拆分、驼峰拆分和路径片段切分。
- retrieval 已增加进程内运行时统计，可查询 cache hit/miss、fallback 次数、最近一次排序摘要和注入摘要。
- gateway 已暴露只读调试接口 `/api/memory/retrieval/stats`。
- `MemoryMiddleware` 会输出 debug 级别 retrieval 日志，仅包含 cache、fallback、注入预算和 top score 数值摘要，不包含原始上下文或事实原文。
- memory facts 已支持 scope-aware 隔离：普通对话默认保持 user-level 行为；coding agent 可通过 `memory_scope` 或 `project_id`/`project_root` 推导 `coding_project` scope，注入时仅保留 `global`、当前项目和未迁移 legacy facts。

## 当前行为

当前功能：

```python
def format_memory_for_injection(
    memory_data: dict[str, Any],
    max_tokens: int = 2000,
    ranked_facts: list[dict[str, Any]] | None = None,
) -> str:
```

当前注入格式：

- `User Context` 部分来自 `user.*.summary`
- `History` 部分来自 `history.*.summary`
- `Facts` 部分来自 `facts[]`
  - retrieval 关闭时：按置信度排序
  - retrieval 开启时：按 `current_context` TF-IDF 相似度与 `confidence` 的加权分数排序
  - 若当前运行存在 active scope（例如 coding agent 的 `coding_project`），会先过滤 facts，再进行排序和注入
  - facts 仍会在 token 预算内追加到上限

Token 计数：

- 可用时使用 `tiktoken`（`cl100k_base`）
- 若 tokenizer 导入失败，回退为 `len(text) // 4`

## 当前限制

- 检索目标仅覆盖 `facts[]`
- `user.*` 与 `history.*` 仍作为摘要背景注入，不参与 retrieval 排序
- `user.*` 与 `history.*` 仍是 user-level 摘要，尚未按 `global` / `coding_project` / `conversation` 拆分，因此跨项目污染的彻底修复还需要后续 schema 升级
- 第一版缓存为进程内 `lru_cache`，未做跨进程共享
- tokenizer 仍为轻量规则方案，未引入自定义技术词表或外部分词依赖
- 第一版未引入 BM25 或 embedding 检索
- 当前统计仍为进程内数据，进程重启后会重置

## 当前评分策略

```text
final_score = (similarity * 0.6) + (confidence * 0.4)
```

当前集成形式：

1. 从过滤后的用户/最终助手轮次中提取近期对话上下文。
2. 计算每个事实与当前上下文的 TF-IDF 余弦相似度。
3. 按加权分数排序并在 token 预算内注入。
4. 若上下文不可用或 retrieval 异常，回退为仅按置信度排序。

## 调优建议

- 先观察 `/api/memory/retrieval/stats` 中的 `last_injected_facts_count`、`last_query_tokens`、`cache_hits/cache_misses` 与 `fallback_confidence_only_calls`，再决定是否调参。
- 若 `last_injected_facts_count` 长期贴近上限且高分 facts 经常被截断，可考虑将 `memory.max_injection_tokens` 从 `2000` 小幅上调到 `2500-3000`。
- 若 retrieval 命中正常但对话仍频繁触发摘要，优先观察 `summarization.trigger` 是否过早触发，再决定是否放宽 tokens 阈值。
- 现阶段不建议自动联动调参，先基于统计做人工观察与小步调整。

## 验证

当前的回归测试覆盖范围包括：

- 记忆注入输出中包含事实
- 置信度排序
- 预排序 facts 渲染
- token 预算限制的事实包含
- retrieval 排序与无上下文回退
- retrieval 统计、middleware 调试日志与 stats 路由
- lead-agent prompt 中的 retrieval 接入
- MemoryMiddleware 运行时注入

测试文件：

- `backend/tests/test_memory_prompt_injection.py`
- `backend/tests/test_memory_retrieval.py`
- `backend/tests/test_lead_agent_prompt.py`
- `backend/tests/test_memory_middleware.py`
- `backend/tests/test_memory_router.py`

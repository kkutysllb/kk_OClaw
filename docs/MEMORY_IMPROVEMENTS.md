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
  - facts 仍会在 token 预算内追加到上限

Token 计数：

- 可用时使用 `tiktoken`（`cl100k_base`）
- 若 tokenizer 导入失败，回退为 `len(text) // 4`

## 当前限制

- 检索目标仅覆盖 `facts[]`
- `user.*` 与 `history.*` 仍作为摘要背景注入，不参与 retrieval 排序
- 第一版缓存为进程内 `lru_cache`，未做跨进程共享
- tokenizer 仍为轻量规则方案，未引入自定义技术词表或外部分词依赖
- 第一版未引入 BM25 或 embedding 检索

## 当前评分策略

```text
final_score = (similarity * 0.6) + (confidence * 0.4)
```

当前集成形式：

1. 从过滤后的用户/最终助手轮次中提取近期对话上下文。
2. 计算每个事实与当前上下文的 TF-IDF 余弦相似度。
3. 按加权分数排序并在 token 预算内注入。
4. 若上下文不可用或 retrieval 异常，回退为仅按置信度排序。

## 验证

当前的回归测试覆盖范围包括：

- 记忆注入输出中包含事实
- 置信度排序
- 预排序 facts 渲染
- token 预算限制的事实包含
- retrieval 排序与无上下文回退
- lead-agent prompt 中的 retrieval 接入
- MemoryMiddleware 运行时注入

测试文件：

- `backend/tests/test_memory_prompt_injection.py`
- `backend/tests/test_memory_retrieval.py`
- `backend/tests/test_lead_agent_prompt.py`
- `backend/tests/test_memory_middleware.py`

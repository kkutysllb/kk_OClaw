# 记忆系统改进

本文档记录记忆注入行为及路线图状态。

## 状态（截至 2026-03-10）

已在 `main` 分支实现：
- 使用 `tiktoken` 在 `format_memory_for_injection` 中进行精确 token 计数。
- 事实被注入到提示词记忆上下文中。
- 事实按置信度排序（降序）。
- 注入遵循 `max_injection_tokens` 预算。

已计划 / 尚未合并：
- 基于 TF-IDF 相似度的事实检索。
- 用于上下文感知评分的 `current_context` 输入。
- 可配置的相似度/置信度权重（`similarity_weight`、`confidence_weight`）。
- 每次模型调用前进行上下文感知检索的中间件/运行时集成。

## 当前行为

当前功能：

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

当前注入格式：
- `User Context` 部分来自 `user.*.summary`
- `History` 部分来自 `history.*.summary`
- `Facts` 部分来自 `facts[]`，按置信度排序，追加至 token 预算用完

Token 计数：
- 可用时使用 `tiktoken`（`cl100k_base`）
- 若 tokenizer 导入失败，回退为 `len(text) // 4`

## 已知缺口

本文档的早期版本将 TF-IDF/上下文感知检索描述为已实现功能。
这在 `main` 分支中并不准确，造成了混淆。

问题参考：`#1059`

## 路线图（已计划）

计划中的评分策略：

```text
final_score = (similarity * 0.6) + (confidence * 0.4)
```

计划中的集成形式：
1. 从过滤后的用户/最终助手轮次中提取近期对话上下文。
2. 计算每个事实与当前上下文的 TF-IDF 余弦相似度。
3. 按加权分数排序并在 token 预算内注入。
4. 若上下文不可用，回退为仅按置信度排序。

## 验证

当前的回归测试覆盖范围包括：
- 记忆注入输出中包含事实
- 置信度排序
- token 预算限制的事实包含

测试文件：
- `backend/tests/test_memory_prompt_injection.py`

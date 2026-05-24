# Memory Config Review Design

## 背景

当前项目已经完成一系列记忆系统增强：

- 会话摘要压缩
- facts 注入到提示词上下文
- 基于 `current_context` 的 TF-IDF 检索
- 相似度 + 置信度加权排序
- facts 侧检索缓存
- `tokenize_text()` 的中文/技术词规则增强

当前本地 `config.yaml` 中，`memory.retrieval` 已经启用，并且字段结构与当前代码实现基本对齐：

```yaml
memory:
  enabled: true
  storage_path: memory.json
  debounce_seconds: 30
  model_name: glm-5.1
  max_facts: 100
  fact_confidence_threshold: 0.75
  injection_enabled: true
  max_injection_tokens: 2000
  retrieval:
    enabled: true
    strategy: tfidf
    context_max_turns: 4
    context_max_chars: 4000
    similarity_weight: 0.6
    confidence_weight: 0.4
    min_similarity: 0.0
```

但目前仍有两个需要补齐的点：

1. 需要判断这些值是否与当前实现、示例配置和最新文档描述一致
2. 需要把已完成的 memory 能力同步反映到 `docs/TODO.md`

本次工作只处理 memory 相关配置，不扩展到安全默认值、工具配置、上传转换、host bash 等其他配置域。

## 目标

本次改造需要完成以下目标：

1. 审视并小幅更新 `config.yaml` 中的 `memory:` 配置
2. 保持当前已启用的 retrieval 能力不变
3. 只在有明确依据时调整现有数值，不做大范围重配
4. 更新 `docs/TODO.md`，反映最新已完成的 memory 系统能力

## 非目标

本次改造不包含以下内容：

- 不修改 `models:` 配置
- 不调整 `tool_search`、`sandbox`、`uploads`、`agents_api`、`skill_evolution`
- 不重新设计 `summarization` 策略
- 不修改记忆系统代码实现
- 不扩展到新的 roadmap 设计

## 设计原则

- 以当前真实实现为准，而不是只按示例配置机械对齐
- 优先保留用户现有配置意图
- 只有当参数明显偏旧、偏离当前实现或与示例/文档存在冲突时才调整
- `docs/TODO.md` 只补充与近期已完成 memory 工作直接相关的条目

## 当前配置分析

### 1. `memory.enabled`

当前值：`true`

判断：

- 与当前项目已经启用的记忆能力一致
- 无需调整

### 2. `memory.model_name`

当前值：`glm-5.1`

判断：

- 当前配置显式指定记忆抽取模型，而不是沿用默认模型
- 这是用户已有明确选择
- 本次不建议改为 `null`

### 3. `memory.max_facts`

当前值：`100`

判断：

- 与当前实现和已有文档相符
- 在 facts 侧缓存和 retrieval 已上线的情况下，该规模仍属合理
- 无需调整

### 4. `memory.fact_confidence_threshold`

当前值：`0.75`

对比：

- `config.example.yaml` 当前示例值为 `0.7`
- 本地配置使用更严格的保留阈值

判断：

- 当前值不是错误配置
- 但它会减少可写入 facts 数量，偏向保守
- 如果目标是让 retrieval 有更丰富候选事实，可以考虑轻微放宽到 `0.7`

建议：

- 将 `0.75` 下调到 `0.7`
- 原因是：
  - 与示例配置对齐
  - 有利于给 TF-IDF 检索提供更多候选 facts
  - 变更幅度小，仍保持较高置信门槛

### 5. `memory.max_injection_tokens`

当前值：`2000`

判断：

- 与示例配置一致
- 当前记忆注入仍只覆盖 `facts[]` 排序注入，不包含更大的 user/history 检索扩展
- 结合当前 64k 模型上限与 facts 数量，`2000` 属于合理保守值

建议：

- 保持 `2000`

### 6. `memory.retrieval.*`

当前值：

- `enabled: true`
- `strategy: tfidf`
- `context_max_turns: 4`
- `context_max_chars: 4000`
- `similarity_weight: 0.6`
- `confidence_weight: 0.4`
- `min_similarity: 0.0`

判断：

- 与当前代码实现、`MEMORY_IMPROVEMENTS.md` 以及最近完成的功能保持一致
- 这些值已经是当前最合理的默认组合

建议：

- 全部保留不变

## 更新方案

### 方案 A：只补注释，不改数值

做法：

- 保持当前全部数值不变
- 只在 `config.yaml` 中补充少量 memory 注释
- 更新 `docs/TODO.md`

优点：

- 改动最保守

缺点：

- 不能解决 `fact_confidence_threshold` 与当前示例值不一致的问题

### 方案 B：保守优化并同步 TODO（推荐）

做法：

- 保留现有 retrieval 配置
- 将 `fact_confidence_threshold` 从 `0.75` 调整为 `0.7`
- 保留 `max_injection_tokens: 2000`
- 更新 `docs/TODO.md` 以反映已完成 memory 功能

优点：

- 变更小且有明确依据
- 与当前示例配置和最近实现更一致

缺点：

- 仍然属于经验性小调优，而非系统性重配

### 方案 C：联动调整 memory + summarization

做法：

- 除 memory 外，同时联动重配摘要触发阈值与保留策略

优点：

- 优化空间更大

缺点：

- 超出当前范围
- 会引入更多主观取舍

## 推荐方案

推荐采用 `方案 B：保守优化并同步 TODO`。

具体执行为：

- `config.yaml`
  - 保留当前 `memory.retrieval` 全部字段和数值
  - 将 `fact_confidence_threshold` 从 `0.75` 调整为 `0.7`
  - 保持 `max_injection_tokens: 2000`
- `docs/TODO.md`
  - 在“已完成功能”中补充最近已落地的 memory 能力
  - 不修改与 memory 无关的计划项

## `docs/TODO.md` 更新范围

建议新增到“已完成功能”的条目：

- [x] 实现基于 `current_context` 的 TF-IDF 相似度检索
- [x] 实现按相似度 + 置信度的 memory facts 加权排序
- [x] 为 memory retrieval 引入 facts 侧文档集签名缓存
- [x] 增强 `tokenize_text()` 的中文/技术词切分能力

这些条目都对应近期已完成并已验证的真实功能，适合纳入 TODO 的已完成区。

## 风险与缓解

### 风险 1：降低 `fact_confidence_threshold` 后 facts 写入数量增多

缓解：

- 新值仅从 `0.75` 调整到 `0.7`
- 仍然属于高置信阈值
- `max_facts: 100` 和 retrieval 排序仍会限制注入规模

### 风险 2：TODO 内容与文档重复

缓解：

- `MEMORY_IMPROVEMENTS.md` 负责详细说明
- `docs/TODO.md` 只保留“是否已完成”的高层状态

### 风险 3：误改用户其他配置意图

缓解：

- 本次只改 `memory:` 段中的一个参数
- 其他 memory 参数按当前配置保留

## 测试与验证

本次主要是配置与文档更新，不涉及新的业务代码实现。

验证重点：

1. `config.yaml` 结构仍与当前 schema 兼容
2. `docs/TODO.md` 更新后语义准确、范围克制
3. 不修改与本次范围无关的配置项

## 最终结论

本次建议只做一个小幅配置调整和一组 TODO 状态同步：

- 将 `memory.fact_confidence_threshold` 从 `0.75` 调整为 `0.7`
- 保留 `memory.max_injection_tokens: 2000`
- 保留当前 retrieval 全部配置
- 在 `docs/TODO.md` 中补充已完成的 memory 系统增强项

这样既能让当前本地配置更贴近最新示例与已实现能力，也能把近期完成的记忆系统工作同步反映到项目 TODO 中，且改动范围最小、风险最低。

# 对话摘要

KKOCLAW 包含自动对话摘要功能，用于处理接近模型 token 限制的长对话。启用后，系统会自动压缩较旧的消息，同时保留最近的上下文。

## 概述

摘要功能使用 LangChain 的 `SummarizationMiddleware` 来监控对话历史，并根据可配置的阈值触发摘要。激活后，它会：

1. 实时监控消息 token 数量
2. 在达到阈值时触发摘要
3. 保留最近的消息完整，同时总结较旧的对话
4. 保持 AI/Tool 消息配对在一起，确保上下文连续性
5. 将摘要结果注入回对话中

## 配置

摘要功能在 `config.yaml` 的 `summarization` 键下配置：

```yaml
summarization:
  enabled: true
  model_name: null  # 使用默认模型或指定轻量级模型

  # 触发条件（OR 逻辑——任一条件触发摘要）
  trigger:
    - type: tokens
      value: 4000
    # 附加触发条件（可选）
    # - type: messages
    #   value: 50
    # - type: fraction
    #   value: 0.8  # 模型最大输入 token 的 80%

  # 上下文保留策略
  keep:
    type: messages
    value: 20

  # 摘要调用的 token 裁剪
  trim_tokens_to_summarize: 4000

  # 自定义摘要提示（可选）
  summary_prompt: null

  # 被视为技能文件读取的工具名称
  skill_file_read_tool_names:
    - read_file
    - read
    - view
    - cat
```

### 配置选项

#### `enabled`
- **类型**：布尔值
- **默认值**：`false`
- **说明**：启用或禁用自动摘要

#### `model_name`
- **类型**：字符串或 null
- **默认值**：`null`（使用默认模型）
- **说明**：用于生成摘要的模型。建议使用轻量级、成本效益高的模型，如 `gpt-4o-mini` 或同等产品。

#### `trigger`
- **类型**：单个 `ContextSize` 或 `ContextSize` 对象列表
- **必需**：启用时至少需要指定一个触发条件
- **说明**：触发摘要的阈值。使用 OR 逻辑——满足任一阈值时触发摘要。

**ContextSize 类型：**

1. **Token 触发**：当 token 数达到指定值时触发
   ```yaml
   trigger:
     type: tokens
     value: 4000
   ```

2. **消息触发**：当消息数达到指定值时触发
   ```yaml
   trigger:
     type: messages
     value: 50
   ```

3. **比例触发**：当 token 使用量达到模型最大输入 token 的百分比时触发
   ```yaml
   trigger:
     type: fraction
     value: 0.8  # 最大输入 token 的 80%
   ```

**多触发条件：**
```yaml
trigger:
  - type: tokens
    value: 4000
  - type: messages
    value: 50
```

#### `keep`
- **类型**：`ContextSize` 对象
- **默认值**：`{type: messages, value: 20}`
- **说明**：指定摘要后保留多少最近的对话历史。

**示例：**
```yaml
# 保留最近 20 条消息
keep:
  type: messages
  value: 20

# 保留最近 3000 个 token
keep:
  type: tokens
  value: 3000

# 保留模型最大输入 token 的 30%
keep:
  type: fraction
  value: 0.3
```

#### `trim_tokens_to_summarize`
- **类型**：整数或 null
- **默认值**：`4000`
- **说明**：准备摘要调用消息时包含的最大 token 数。设为 `null` 跳过裁剪（不推荐用于很长对话）。

#### `summary_prompt`
- **类型**：字符串或 null
- **默认值**：`null`（使用 LangChain 默认提示词）
- **说明**：生成摘要的自定义提示词模板。提示词应引导模型提取最重要的上下文。

#### `preserve_recent_skill_count`
- **类型**：整数（≥ 0）
- **默认值**：`5`
- **说明**：最近加载的技能文件（工具结果中工具名在 `skill_file_read_tool_names` 中且目标路径在 `skills.container_path` 下，如 `/mnt/skills/...`）中，从摘要中挽救的数量。防止 agent 在压缩后丢失技能指令。设为 `0` 完全禁用技能挽救。

#### `preserve_recent_skill_tokens`
- **类型**：整数（≥ 0）
- **默认值**：`25000`
- **说明**：为挽救的技能读取保留的总 token 预算。此预算用尽后，允许对较旧的技能包进行摘要。

#### `preserve_recent_skill_tokens_per_skill`
- **类型**：整数（≥ 0）
- **默认值**：`5000`
- **说明**：每技能的 token 上限。任何单个技能读取的工具结果超过此大小则不会被挽救（像普通内容一样进入摘要器）。

#### `skill_file_read_tool_names`
- **类型**：字符串列表
- **默认值**：`["read_file", "read", "view", "cat"]`
- **说明**：摘要挽救期间被视为技能文件读取的工具名称。只有当工具名称在此列表中且目标路径在 `skills.container_path` 下时，工具调用才有资格进行技能挽救。

**默认提示词行为：**
LangChain 默认提示词指示模型：
- 提取最高质量/最相关的上下文
- 关注对整体目标至关重要的信息
- 避免重复已完成的操作
- 仅返回提取的上下文

## 工作原理

### 摘要流程

1. **监控**：在每次模型调用前，中间件统计消息历史中的 token 数量
2. **触发检查**：如果满足任何配置的阈值，则触发摘要
3. **消息分区**：消息分为：
   - 需摘要的消息（超出 `keep` 阈值的较旧消息）
   - 需保留的消息（在 `keep` 阈值内的最近消息）
4. **摘要生成**：模型生成较旧消息的简洁摘要
5. **上下文替换**：消息历史更新：
   - 删除所有旧消息
   - 添加一条摘要消息
   - 保留最近的消息
6. **AI/Tool 配对保护**：系统确保 AI 消息及其对应的 tool 消息保持在一起
7. **技能挽救**：在摘要生成前，最近加载的技能文件（工具结果中工具名在 `skill_file_read_tool_names` 中且目标路径在 `skills.container_path` 下）从摘要集中提出，并前置到保留的消息尾部。选择按最新优先在三个预算下进行：`preserve_recent_skill_count`、`preserve_recent_skill_tokens` 和 `preserve_recent_skill_tokens_per_skill`。触发的 AIMessage 及其所有配对的 ToolMessages 一起移动以保持 tool_call ↔ tool_result 配对完整。

### Token 计数

- 使用基于字符数的近似 token 计数
- 对于 Anthropic 模型：约 3.3 字符/token
- 对于其他模型：使用 LangChain 默认估算
- 可通过自定义 `token_counter` 函数定制

### 消息保留

中间件智能地保留消息上下文：

- **最近消息**：始终根据 `keep` 配置保持完整
- **AI/Tool 对**：永不拆分——如果截断点落在 tool 消息内，系统会调整以保持整个 AI + Tool 消息序列一起
- **摘要格式**：摘要作为 HumanMessage 注入，格式为：
  ```
  以下是截至当前的对话摘要：

  [生成的摘要文本]
  ```

## 最佳实践

### 选择触发阈值

1. **Token 触发**：推荐用于大多数场景
   - 设置为模型上下文窗口的 60-80%
   - 示例：对于 8K 上下文，使用 4000-6000 token

2. **消息触发**：用于控制对话长度
   - 适用于包含许多短消息的应用
   - 示例：50-100 条消息，取决于平均消息长度

3. **比例触发**：适用于使用多个模型时
   - 自动适应每个模型的容量
   - 示例：0.8（模型最大输入 token 的 80%）

### 选择保留策略（`keep`）

1. **基于消息的保留**：适用于大多数场景
   - 保留自然的对话流程
   - 推荐：15-25 条消息

2. **基于 token 的保留**：需要精确控制时使用
   - 适合管理精确的 token 预算
   - 推荐：2000-4000 token

3. **基于比例的保留**：适用于多模型设置
   - 自动随模型容量缩放
   - 推荐：0.2-0.4（最大输入 token 的 20-40%）

### 模型选择

- **推荐**：使用轻量级、成本效益高的模型进行摘要
  - 示例：`gpt-4o-mini`、`claude-haiku` 或同等产品
  - 摘要不需要最强大的模型
  - 高流量应用可大幅节省成本

- **默认**：如果 `model_name` 为 `null`，则使用默认模型
  - 可能更昂贵，但确保一致性
  - 适合简单设置

### 优化建议

1. **平衡触发**：组合 token 和消息触发以获得稳健处理
   ```yaml
   trigger:
     - type: tokens
       value: 4000
     - type: messages
       value: 50
   ```

2. **保守保留**：初始保留更多消息，根据性能调整
   ```yaml
   keep:
     type: messages
     value: 25  # 从较高值开始，需要时减少
   ```

3. **策略性裁剪**：限制发送给摘要模型的 token 数
   ```yaml
   trim_tokens_to_summarize: 4000  # 防止昂贵的摘要调用
   ```

4. **监控和迭代**：跟踪摘要质量并调整配置

## 故障排查

### 摘要质量问题

**问题**：摘要丢失重要上下文

**解决方案**：
1. 增加 `keep` 值以保留更多消息
2. 降低触发阈值以更早进行摘要
3. 自定义 `summary_prompt` 以强调关键信息
4. 使用能力更强的模型进行摘要

### 性能问题

**问题**：摘要调用时间过长

**解决方案**：
1. 使用更快的模型进行摘要（如 `gpt-4o-mini`）
2. 减少 `trim_tokens_to_summarize` 以发送更少的上下文
3. 提高触发阈值以减少摘要频率

### Token 限制错误

**问题**：尽管有摘要仍然达到 token 限制

**解决方案**：
1. 降低触发阈值以更早进行摘要
2. 减少 `keep` 值以保留更少的消息
3. 检查是否有单条消息非常大
4. 考虑使用基于比例的触发

## 实现细节

### 代码结构

- **配置**：`packages/harness/kkoclaw/config/summarization_config.py`
- **集成**：`packages/harness/kkoclaw/agents/lead_agent/agent.py`
- **中间件**：使用 `langchain.agents.middleware.SummarizationMiddleware`

### 中间件顺序

摘要在线程数据和 Sandbox 初始化之后、标题和澄清之前运行：

1. ThreadDataMiddleware
2. SandboxMiddleware
3. **SummarizationMiddleware** ← 在此处运行
4. TitleMiddleware
5. ClarificationMiddleware

### 状态管理

- 摘要是无状态的——配置在启动时加载一次
- 摘要在对话历史中作为普通消息添加
- Checkpointer 自动持久化摘要后的历史

## 配置示例

### 最小配置
```yaml
summarization:
  enabled: true
  trigger:
    type: tokens
    value: 4000
  keep:
    type: messages
    value: 20
```

### 生产配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini  # 轻量级模型以节约成本
  trigger:
    - type: tokens
      value: 6000
    - type: messages
      value: 75
  keep:
    type: messages
    value: 25
  trim_tokens_to_summarize: 5000
```

### 多模型配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini
  trigger:
    type: fraction
    value: 0.7  # 模型最大输入 token 的 70%
  keep:
    type: fraction
    value: 0.3  # 保留最大输入 token 的 30%
  trim_tokens_to_summarize: 4000
```

### 保守配置（高质量）
```yaml
summarization:
  enabled: true
  model_name: gpt-4  # 使用完整模型获得高质量摘要
  trigger:
    type: tokens
    value: 8000
  keep:
    type: messages
    value: 40  # 保留更多上下文
  trim_tokens_to_summarize: null  # 不裁剪
```

## 参考

- [LangChain 摘要中间件文档](https://docs.langchain.com/oss/python/langchain/middleware/built-in#summarization)
- [LangChain 源代码](https://github.com/langchain-ai/langchain)

# Plan 模式与 TodoList 中间件

本文档描述如何在 KKOCLAW 2.0 中启用和使用带有 TodoList 中间件的 Plan 模式功能。

## 概述

Plan 模式向 Agent 添加了一个 TodoList 中间件，它提供了一个 `write_todos` 工具，帮助 Agent：
- 将复杂任务分解为更小、可管理的步骤
- 随工作进展跟踪进度
- 向用户提供正在进行的操作的可见性

TodoList 中间件基于 LangChain 的 `TodoListMiddleware` 构建。

## 配置

### 启用 Plan 模式

Plan 模式通过 **运行时配置** 控制，使用 `RunnableConfig` 的 `configurable` 部分中的 `is_plan_mode` 参数。这允许你按请求动态启用或禁用 plan 模式。

```python
from langchain_core.runnables import RunnableConfig
from kkoclaw.agents.lead_agent.agent import make_lead_agent

# 通过运行时配置启用 plan 模式
config = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # 启用 plan 模式
    }
)

# 创建启用 plan 模式的 agent
agent = make_lead_agent(config)
```

### 配置选项

- **is_plan_mode** (bool)：是否启用带 TodoList 中间件的 plan 模式。默认：`False`
  - 通过 `config.get("configurable", {}).get("is_plan_mode", False)` 传递
  - 可为每次 agent 调用动态设置
  - 无需全局配置

## 默认行为

启用 plan 模式并使用默认设置时，agent 将可以使用 `write_todos` 工具，其行为如下：

### 何时使用 TodoList

Agent 将在以下情况使用 todo 列表：
1. 复杂的多步骤任务（3 个以上不同步骤）
2. 需要仔细规划的非平凡任务
3. 用户明确请求 todo 列表时
4. 用户提供多个任务时

### 何时不使用 TodoList

Agent 将在以下情况跳过使用 todo 列表：
1. 单一、直接的任务
2. 琐碎任务（少于 3 步）
3. 纯对话或信息性请求

### 任务状态

- **pending**：任务尚未开始
- **in_progress**：正在处理（可同时有多个并行任务）
- **completed**：任务已成功完成

## 使用示例

### 基本用法

```python
from langchain_core.runnables import RunnableConfig
from kkoclaw.agents.lead_agent.agent import make_lead_agent

# 创建启用 plan 模式的 agent
config_with_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # 将添加 TodoList 中间件
    }
)
agent_with_todos = make_lead_agent(config_with_plan_mode)

# 创建禁用 plan 模式的 agent（默认）
config_without_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "another-thread",
        "thinking_enabled": True,
        "is_plan_mode": False,  # 无 TodoList 中间件
    }
)
agent_without_todos = make_lead_agent(config_without_plan_mode)
```

### 按请求动态 Plan 模式

你可以为不同的对话或任务动态启用/禁用 plan 模式：

```python
from langchain_core.runnables import RunnableConfig
from kkoclaw.agents.lead_agent.agent import make_lead_agent

def create_agent_for_task(task_complexity: str):
    """根据任务复杂度创建带 plan 模式的 agent。"""
    is_complex = task_complexity in ["high", "very_high"]

    config = RunnableConfig(
        configurable={
            "thread_id": f"task-{task_complexity}",
            "thinking_enabled": True,
            "is_plan_mode": is_complex,  # 仅为复杂任务启用
        }
    )

    return make_lead_agent(config)

# 简单任务 - 不需要 TodoList
simple_agent = create_agent_for_task("low")

# 复杂任务 - 启用 TodoList 以便更好地跟踪
complex_agent = create_agent_for_task("high")
```

## 工作原理

1. 调用 `make_lead_agent(config)` 时，它从 `config.configurable` 中提取 `is_plan_mode`
2. 配置传递给 `_build_middlewares(config)`
3. `_build_middlewares()` 读取 `is_plan_mode` 并调用 `_create_todo_list_middleware(is_plan_mode)`
4. 如果 `is_plan_mode=True`，创建 `TodoListMiddleware` 实例并添加到中间件链
5. 中间件自动将 `write_todos` 工具添加到 agent 的工具集
6. Agent 可以在执行期间使用此工具管理任务
7. 中间件处理 todo 列表状态并将其提供给 agent

## 架构

```
make_lead_agent(config)
  │
  ├─> 提取：is_plan_mode = config.configurable.get("is_plan_mode", False)
  │
  └─> _build_middlewares(config)
        │
        ├─> ThreadDataMiddleware
        ├─> SandboxMiddleware
        ├─> SummarizationMiddleware（通过全局配置启用）
        ├─> TodoListMiddleware（如果 is_plan_mode=True）← 新增
        ├─> TitleMiddleware
        └─> ClarificationMiddleware
```

## 实现细节

### Agent 模块
- **位置**：`packages/harness/kkoclaw/agents/lead_agent/agent.py`
- **函数**：`_create_todo_list_middleware(is_plan_mode: bool)` — 如果 plan 模式启用则创建 TodoListMiddleware
- **函数**：`_build_middlewares(config: RunnableConfig)` — 基于运行时配置构建中间件链
- **函数**：`make_lead_agent(config: RunnableConfig)` — 使用适当的中间件创建 agent

### 运行时配置
Plan 模式通过 `RunnableConfig.configurable` 中的 `is_plan_mode` 参数控制：
```python
config = RunnableConfig(
    configurable={
        "is_plan_mode": True,  # 启用 plan 模式
        # ... 其他可配置选项
    }
)
```

## 主要优势

1. **动态控制**：按请求启用/禁用 plan 模式，无需全局状态
2. **灵活性**：不同的对话可有不同的 plan 模式设置
3. **简洁性**：无需全局配置管理
4. **上下文感知**：Plan 模式决策可基于任务复杂度、用户偏好等

## 自定义提示词

KKOCLAW 为 TodoListMiddleware 使用自定义的 `system_prompt` 和 `tool_description`，匹配整体的 KKOCLAW 提示词风格：

### 系统提示词特性
- 使用 XML 标签（`<todo_list_system>`）保持结构一致性与 KKOCLAW 主提示词一致
- 强调关键规则和最佳实践
- 清晰的"何时使用"与"何时不使用"指导原则
- 专注于实时更新和即时任务完成

### 工具描述特性
- 详细的使用场景及示例
- 强烈强调不用于简单任务
- 清晰的任务状态定义（pending、in_progress、completed）
- 全面的最佳实践部分
- 任务完成要求，防止过早标记完成

自定义提示词定义在 `_create_todo_list_middleware()` 中，位于 `packages/harness/kkoclaw/agents/lead_agent/agent.py:57`。

## 注意事项

- TodoList 中间件使用 LangChain 内置的 `TodoListMiddleware`，配合**自定义 KKOCLAW 风格的提示词**
- Plan 模式**默认禁用**（`is_plan_mode=False`）以保持向后兼容
- 中间件位于 `ClarificationMiddleware` 之前，允许在澄清流程中进行 todo 管理
- 自定义提示词强调与 KKOCLAW 主系统提示词相同的原则（清晰、行动导向、关键规则）

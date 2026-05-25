# Custom Agent To Subagent Bridge Design

## 背景

当前项目里存在两套相邻但未打通的能力：

- `.kkoclaw/agents/<name>/` 目录用于定义自定义 agent
- `task` 工具与 `subagents` registry 用于调度 subagent

这两套机制各自独立：

- 自定义 agent 通过 `config.yaml` 与 `SOUL.md` 定义角色、技能、工具组和可选模型
- subagent 通过 `BUILTIN_SUBAGENTS`、`subagents.custom_agents` 和 `subagents.agents` 参与调度

因此，用户虽然已经创建了 `.kkoclaw/agents/kkutys-stock/`，但当前还不能直接通过 `task(..., subagent_type="kkutys-stock")` 调用它。

用户当前希望复用已经创建的自定义 agent，而不是再在 `subagents.custom_agents` 中维护第二份同名配置。目标是让 lead agent 能直接把任务派发给该 agent，同时尽量不扩大代码改动范围。

## 目标

本次设计需要实现以下目标：

1. 允许 `task` 工具直接调度 `.kkoclaw/agents/<name>/` 中定义的自定义 agent
2. 复用现有自定义 agent 的 `config.yaml` 与 `SOUL.md`，避免重复维护第二份配置
3. 将自定义 agent 在运行时桥接为 `SubagentConfig`，复用现有 subagent 执行链路
4. 保持与现有 subagent 模型解析逻辑兼容，包括显式 `model` 优先和父子模型路由
5. 保持向后兼容，未创建自定义 agent 时现有行为不变
6. 对非法或不完整的自定义 agent 做保守处理，不暴露给 `task` 调用

## 非目标

本次改造不包含以下内容：

- 不新增前端 UI 管理页面
- 不修改 lead agent prompt 的高层任务拆解策略
- 不引入新的 agent 存储格式
- 不在第一版支持 agent 专属的复杂工具组映射规则
- 不自动把所有自定义 agent 暴露给非 `task` 的其他调度入口
- 不改动 `.kkoclaw/agents` 的目录结构
- 不在第一版支持从自定义 agent 反向生成 `subagents.custom_agents` 配置

## 现状分析

当前关键模块如下：

- `config/agents_config.py`
  - 负责读取 `.kkoclaw/agents/<name>/config.yaml`
  - 负责读取 `.kkoclaw/agents/<name>/SOUL.md`
  - 已提供 `load_agent_config()`、`load_agent_soul()` 和 `list_custom_agents()`
- `subagents/registry.py`
  - 负责构建可被调度的 subagent 列表
  - 当前只认识：
    - 内建 subagent
    - `subagents.custom_agents`
  - 还不会查询 `.kkoclaw/agents`
- `task_tool`
  - 调用 `get_available_subagent_names()` 暴露可选 subagent 名单
  - 调用 `get_subagent_config()` 获取具体配置

这意味着只要在 `subagents/registry.py` 一层增加对 `.kkoclaw/agents` 的桥接，就可以复用现有执行链，而不必在 `task_tool` 或 executor 中复制判断逻辑。

## 方案选项

### 方案 A：在 subagent registry 中桥接自定义 agent（推荐）

做法：

- 扩展 `get_subagent_config()` 与 `get_subagent_names()`
- 当名称不属于内建 subagent 且不在 `subagents.custom_agents` 中时，继续尝试从 `.kkoclaw/agents/<name>/` 加载
- 将读取到的 `AgentConfig + SOUL.md` 转换为运行时 `SubagentConfig`

优点：

- 复用现有 `task` 调度链
- 不需要维护第二份配置
- 逻辑集中在 registry 层，职责清晰
- 与模型路由、skills 覆盖、执行器兼容性最好

缺点：

- 需要补一层字段映射和校验逻辑

### 方案 B：启动时同步 `.kkoclaw/agents` 到 `subagents.custom_agents`

做法：

- 在配置加载阶段扫描 `.kkoclaw/agents`
- 自动生成运行时 custom subagent 条目

优点：

- 理论上配置视图比较统一

缺点：

- 启动阶段逻辑更重
- 配置来源不再单一，容易让人分不清真实来源
- 需要更仔细处理覆盖和冲突

### 方案 C：在 `task_tool` 内部特判自定义 agent

做法：

- `task_tool` 遇到未知 `subagent_type` 时，直接去 `.kkoclaw/agents` 查找

优点：

- 表面上改动集中

缺点：

- 破坏 registry 作为统一来源的职责边界
- 其他未来调用入口可能得不到同样能力
- 测试和复用都会变差

## 推荐方案

推荐采用 `方案 A：在 subagent registry 中桥接自定义 agent`。

原因：

- 最符合“复用已有 `.kkoclaw/agents`，不重复维护配置”的需求
- 侵入范围最小，不需要修改 prompt 或额外增加新的配置源
- 现有 `task`、executor、模型路由和 per-agent override 都可以继续走统一入口

## 桥接规则

### 1. 名称解析顺序

`get_subagent_config(name)` 的解析顺序扩展为：

1. 内建 subagent
2. `subagents.custom_agents`
3. `.kkoclaw/agents/<name>/`

`get_subagent_names()` 的名称聚合顺序也保持同样层次：

1. 内建 subagent 名称
2. `subagents.custom_agents` 名称
3. 可桥接的 `.kkoclaw/agents` 名称

如果出现重名，优先级按上述顺序生效，后面的来源不覆盖前面的来源。

### 2. 可桥接条件

第一版只桥接满足以下条件的自定义 agent：

- 目录存在：`.kkoclaw/agents/<name>/`
- `config.yaml` 存在且可解析
- `SOUL.md` 存在且非空
- `name` 合法，且与现有自定义 agent 命名规则一致

若任一条件不满足：

- `get_subagent_config(name)` 返回 `None`
- `get_subagent_names()` / `get_available_subagent_names()` 不暴露该名称
- 日志记录 debug 或 warning，避免静默误判

### 3. 字段映射规则

从 `.kkoclaw/agents/<name>/config.yaml` 读取的字段，桥接为 `SubagentConfig` 的规则如下：

- `name`
  - 直接映射到 `SubagentConfig.name`
- `description`
  - 直接映射到 `SubagentConfig.description`
- `skills`
  - 直接映射到 `SubagentConfig.skills`
- `model`
  - 直接映射到 `SubagentConfig.model`
  - 这意味着显式模型仍优先于父子模型路由
- `SOUL.md`
  - 作为 `SubagentConfig.system_prompt`

第一版暂不直接桥接以下字段：

- `tool_groups`
  - 先不从自定义 agent 的 tool group 自动推导到 subagent tools
  - 原因是当前 subagent 和 lead agent 对工具控制的结构不同，贸然映射容易扩大范围

第一版桥接生成的 `SubagentConfig` 中：

- `tools`
  - 采用 `None`，表示使用 subagent 现有默认工具解析逻辑
- `disallowed_tools`
  - 采用 `None`
- `max_turns`
  - 使用 `SubagentConfig` 默认值，后续仍可由 `subagents.agents.<name>` 覆盖
- `timeout_seconds`
  - 使用 `SubagentConfig` 默认值，后续仍可由 `subagents.agents.<name>` 覆盖

## 与现有覆盖逻辑的关系

桥接后的自定义 agent 应继续遵守现有 subagent 覆盖与解析规则。

### 1. 模型优先级

优先级保持为：

```text
subagent 显式 model
> model_routing 命中规则后的候选模型
> 继承父模型
> 默认模型
```

其中：

- 若 `.kkoclaw/agents/<name>/config.yaml` 里写了 `model`
  - 视为显式 `subagent.model`
  - 优先于动态路由
- 若没有写
  - 则继续参与父子模型路由

### 2. `subagents.agents` 覆盖

桥接后的自定义 agent 仍允许通过 `subagents.agents.<name>` 做覆盖，例如：

- `timeout_seconds`
- `max_turns`
- `model`
- `skills`

也就是说：

- `.kkoclaw/agents/<name>/config.yaml` 提供该 agent 自带的默认定义
- `subagents.agents.<name>` 提供在“作为 subagent 被调度时”的运行时覆盖

### 3. `subagents.custom_agents` 共存

如果同名条目已经存在于 `subagents.custom_agents`：

- 以 `subagents.custom_agents` 为准
- `.kkoclaw/agents/<name>` 不再参与该名称的桥接

这样可以保持当前配置层级的一致性，并给用户留下显式覆盖入口。

## 暴露给 `task` 的行为

桥接完成后，lead agent 通过 `task` 可见并可调用的 subagent 名单中，将包含满足条件的 `.kkoclaw/agents` 自定义 agent。

例如：

- 用户创建 `.kkoclaw/agents/kkutys-stock/`
- 配置和 `SOUL.md` 合法

则 `task(..., subagent_type="kkutys-stock")` 应可直接进入现有 subagent 执行链。

这意味着：

- `kkutys-stock` 可以复用已有 `SOUL.md`
- 可以复用其 skills 白名单
- 可以参与后续父子模型路由和 per-agent override

## 错误处理

第一版采用保守错误处理策略：

- 缺少 `config.yaml`
  - 视为不存在，不暴露
- `config.yaml` 解析失败
  - 不暴露，并记录 warning
- 缺少 `SOUL.md`
  - 不暴露，并记录 debug 或 warning
- `SOUL.md` 为空
  - 不暴露
- 名称非法
  - 不暴露，并记录 warning

对运行时调用而言：

- 若用户手动传入一个未暴露或桥接失败的名称
  - 行为保持现有逻辑，即视为未知 subagent
  - 不增加新的特殊异常类型

## 代码落点

建议主要修改以下模块：

### 1. `config/agents_config.py`

尽量复用现有函数，不新增大的职责变更。

可新增一个轻量帮助函数，例如：

- 判断某个 agent 是否满足“可桥接为 subagent”的条件

但不建议把 subagent 相关逻辑写进这里。

### 2. `subagents/registry.py`

这是主要改动点。

建议新增：

- 一个从 `.kkoclaw/agents/<name>` 构造 `SubagentConfig` 的帮助函数
- 一个枚举“可桥接自定义 agent 名称”的帮助函数

并让以下入口统一复用：

- `get_subagent_config()`
- `get_subagent_names()`
- `get_available_subagent_names()`

### 3. 其他层保持不变

- `task_tool` 不写桥接特判
- `SubagentExecutor` 不新增来源判断
- prompt 层不增加额外分支

## 测试设计

至少覆盖以下场景：

1. 合法的 `.kkoclaw/agents/kkutys-stock/` 可被列入 `get_subagent_names()`
2. 合法的 `.kkoclaw/agents/kkutys-stock/` 可被列入 `get_available_subagent_names()`
3. `get_subagent_config("kkutys-stock")` 能返回桥接后的 `SubagentConfig`
4. `description`、`skills`、`model`、`SOUL.md` 正确映射
5. 未配置 `model` 时，可继续参与父子模型路由
6. 同名存在于 `subagents.custom_agents` 时，以 `subagents.custom_agents` 为准
7. 缺少 `SOUL.md` 时不暴露
8. `config.yaml` 非法时不暴露
9. `subagents.agents.<name>` 的 `timeout_seconds`、`max_turns`、`model`、`skills` 覆盖仍生效

## 向后兼容

本次设计保持以下兼容性：

- 不创建 `.kkoclaw/agents` 时，现有 subagent 行为完全不变
- 已使用 `subagents.custom_agents` 的用户不受影响
- 已使用 `subagents.agents` 覆盖 built-in 或 custom subagent 的用户不受影响
- `task` 的接口签名和调用方式不变

## 实施边界

第一版只做最小可用桥接：

- 打通 `.kkoclaw/agents` 到 subagent registry
- 复用 `config.yaml` 与 `SOUL.md`
- 保持与现有模型路由兼容

第一版明确不做：

- tool groups 到 subagent tools 的自动映射
- 更复杂的权限控制
- 前端配置与展示增强
- 自定义 agent 与 subagent 的双向同步

## 成功标准

满足以下条件即可视为本次设计成功：

1. 用户创建 `.kkoclaw/agents/kkutys-stock/` 后，无需重复配置第二份 subagent 定义
2. lead agent 能通过 `task(..., subagent_type="kkutys-stock")` 调用该 agent
3. 该 agent 的 `SOUL.md`、skills 和可选显式模型能正确生效
4. 缺失必要文件时不会污染可用 subagent 列表
5. 不影响现有 built-in 与 `subagents.custom_agents` 的行为

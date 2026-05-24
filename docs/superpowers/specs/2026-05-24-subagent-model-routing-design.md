# Subagent Model Routing Design

## 背景

当前项目的 subagent 模型选择逻辑比较简单：

- 如果 subagent 自己显式配置了 `model`，则使用该模型
- 否则继承父模型
- 如果父模型不可用，再回退到默认模型

这一逻辑适合“单一继承”场景，但不适合“父模型负责任务推理与分解，执行型 subagent 使用另一组模型”的场景。

用户当前希望实现的是一种更通用的能力：

1. 父模型集合由用户配置，而不是写死某几个模型名
2. 子模型候选顺序由用户配置，而不是写死 `glm-5.1` 或 `minimax`
3. 规则作用范围由用户配置，可以只作用于任务型 subagent
4. 当候选模型都不可用时，系统仍然必须可运行，应回退到默认模型 `models[0]`

因此，本次设计不是做某个模型品牌的硬编码特判，而是增加一个通用、配置驱动的 subagent model routing 机制。

## 目标

本次改造需要实现以下目标：

1. 支持按父模型名称匹配 subagent 模型路由规则
2. 支持按 subagent 类型控制规则适用范围
3. 支持按候选顺序解析目标模型
4. 候选模型缺失时回退到默认模型，保证系统可运行
5. 保持现有 subagent 显式 `model` 配置的最高优先级
6. 不影响 `bash` 等未命中规则的 subagent

## 非目标

本次改造不包含以下内容：

- 不新增前端 UI 配置页面
- 不在 prompt 中嵌入模型切换逻辑
- 不做模型能力自动探测
- 不根据任务内容做语义级动态选模
- 不在第一版支持正则、通配符或前缀匹配模型名
- 不在第一版支持复杂的多规则冲突策略
- 不在前端额外展示“本次 subagent 实际使用了哪个路由模型”

## 设计原则

- 完全配置驱动，不把具体模型名写死在代码里
- 优先保证系统可运行，任何规则失配都不能导致 subagent 整体不可执行
- 尽量复用现有 subagent 解析链路，不把逻辑散落到多个调用点
- 保持向后兼容：未配置路由规则时，行为与当前一致

## 方案选项

### 方案 A：在选模函数中硬编码规则

做法：

- 在 `resolve_subagent_model_name()` 中直接判断特定父模型名
- 再按固定候选顺序切换到某些目标模型

优点：

- 代码量最小

缺点：

- 模型名被写死
- 后续每次换模型都要改代码
- 无法体现“用户配置决定路由”的目标

### 方案 B：新增配置化 model routing（推荐）

做法：

- 在 `subagents` 配置下增加 `model_routing`
- 运行时按 `parent_models`、`include_subagent_types`、`exclude_subagent_types`、`preferred_models` 与 `fallback` 进行解析

优点：

- 完全符合用户“模型名均可配置”的要求
- 扩展性最好
- 对当前代码结构侵入可控

缺点：

- 需要增加配置模型与解析逻辑

### 方案 C：只在 `task_tool` 中临时改写模型

做法：

- `task_tool` 拿到 `parent_model` 后，临时把 subagent 的 `model` 改写为目标模型

优点：

- 看起来集中在一个入口

缺点：

- 职责边界不清晰
- 容易和其他 subagent 调用路径脱节
- 不利于复用与测试

## 推荐方案

推荐采用 `方案 B：新增配置化 model routing`。

原因：

- 用户明确要求父模型、候选模型都由用户配置指定
- 当前需求的本质是“路由策略”，而不是“特定模型例外”
- 该能力应属于 subagent 配置与解析层，而不是 prompt 或工具层

## 配置设计

建议在 `subagents` 下新增 `model_routing` 配置：

```yaml
subagents:
  model_routing:
    enabled: true
    rules:
      - parent_models: ["deepseek-v4-flash", "deepseek-v4-pro"]
        include_subagent_types: ["general-purpose"]
        exclude_subagent_types: ["bash"]
        preferred_models: ["glm-5.1", "minimax-m2.5"]
        fallback: default
```

说明：

- `enabled`
  - 是否启用 model routing
- `rules`
  - 路由规则列表，按配置顺序匹配，采用“首条命中即停止”
- `parent_models`
  - 命中该规则的父模型名列表
- `include_subagent_types`
  - 允许命中的 subagent 类型；为空或缺省表示不限制
- `exclude_subagent_types`
  - 排除的 subagent 类型；命中后即不应用该规则
- `preferred_models`
  - 目标模型候选顺序；只要在当前 `models` 配置中存在，即选中第一个可用模型
- `fallback`
  - 第一版建议只支持：
    - `default`：回退到默认模型，即 `models[0]`
    - `inherit`：回退到父模型

其中：

- 当前用户要求默认推荐使用 `default`
- `preferred_models` 中的模型名完全由用户配置，不在代码中写死

## 运行时优先级

最终的 subagent 模型解析优先级建议为：

```text
subagent 显式 model
> model_routing 命中规则后的候选模型
> 继承父模型
> 默认模型(models[0])
```

具体解释：

1. 若 subagent 自己显式配置了 `model`，则直接使用，不走路由规则
2. 否则尝试应用 `model_routing`
3. 若没有命中任何规则，则保持现有逻辑：优先继承父模型
4. 若父模型也不可用，则回退默认模型

这样可以保证：

- 显式配置永远优先
- 路由规则只增强继承逻辑，不破坏已有配置能力
- 未开启或未命中路由规则时，系统行为与当前保持一致

## 规则匹配逻辑

单条规则的匹配逻辑建议如下：

1. `parent_model` 在 `parent_models` 中
2. 若 `include_subagent_types` 非空，则当前 `subagent_type` 必须在其中
3. 若 `exclude_subagent_types` 非空，则当前 `subagent_type` 不能在其中

若命中规则，则按 `preferred_models` 顺序查找：

1. 在当前 `AppConfig.models` 中检查模型名是否存在
2. 取第一个存在的模型作为目标模型
3. 若全部不存在，则按 `fallback` 执行

若 `preferred_models` 为空列表，则视为“无候选模型”，直接按 `fallback` 执行。

默认回退策略：

- `fallback=default`：使用 `models[0]`
- `fallback=inherit`：使用 `parent_model`

若 `fallback=inherit` 但父模型为空，则再回退 `models[0]`

## 只配置一个模型时的行为

系统必须优先保证可运行。

因此，当只配置了一个模型时，例如：

```yaml
models:
  - name: deepseek-v4-flash
```

如果：

- 当前父模型命中了某条路由规则
- 但 `preferred_models` 中的候选模型都没有配置

则应回退到默认模型 `models[0]`，也就是仍然使用唯一已配置模型执行 subagent。

这意味着：

- 路由规则是“优先使用更合适的执行模型”
- 而不是“强制切换失败则让系统报错”

## 代码落点

建议主要修改两处：

### 1. `config/subagents_config.py`

新增配置模型，例如：

- `SubagentModelRoutingRuleConfig`
- `SubagentModelRoutingConfig`

并挂到 `SubagentsAppConfig` 下，负责：

- 解析 YAML
- 暴露规则列表
- 为后续 resolver 提供结构化配置

### 2. `subagents/config.py`

在当前 `resolve_subagent_model_name()` 周围增加一层路由解析逻辑，例如：

- `resolve_routed_subagent_model_name(...)`
- 或扩展 `resolve_subagent_model_name(...)` 的参数，让其接收 `subagent_type`

该层负责：

- 读取 `model_routing`
- 判断规则是否命中
- 选择候选模型或 fallback

### 不建议修改的层

- 不在 prompt 层做路由
- 不在 `task_tool` 中写死模型判断
- 不在 `SubagentExecutor` 内部重复写一套判断逻辑

`task_tool` 继续只负责向下传递 `parent_model` 与 `subagent_type`，执行器继续使用统一的解析结果。

## 日志与可观测性

建议在 debug 级别增加一条简洁日志，帮助排查为什么某个 subagent 使用了某个模型。

示例：

```text
subagent.model_routing matched parent=deepseek-v4-pro type=general-purpose selected=glm-5.1 fallback=default
```

要求：

- 不记录 prompt 内容
- 不记录用户消息内容
- 只记录模型名、subagent 类型和是否触发 fallback

## 测试设计

第一版至少应覆盖以下场景：

1. `subagent.model` 显式配置时，不走路由规则
2. 父模型命中规则，且首个候选模型存在，选择首个候选
3. 父模型命中规则，首个候选不存在但第二个存在，选择第二个候选
4. 父模型命中规则，候选全不存在，`fallback=default` 时回退 `models[0]`
5. 父模型命中规则，候选全不存在，`fallback=inherit` 时回退父模型
6. 父模型未命中任何规则，保持现有逻辑
7. `subagent_type` 被 `exclude_subagent_types` 排除时，不应用规则
8. 只配置一个模型时，即便命中规则，也能正常回退运行
9. 未配置 `model_routing` 时，行为与当前版本保持一致

## 向后兼容性

该方案应满足以下兼容要求：

- 老配置中没有 `subagents.model_routing` 时，不报错
- 默认行为保持不变
- 现有 `subagents.agents.<name>.model` 覆盖逻辑继续有效
- 自定义 subagent 与内建 subagent 都可以复用同一套路由逻辑

## 风险与约束

- 第一版只做精确字符串匹配，不支持模糊匹配
- 规则按顺序匹配时，若未来允许多条规则同时命中，需要明确“首条命中即停止”
- 若用户把 `preferred_models` 配成不存在的模型名，系统不会报错，而是按 fallback 回退
- 若 `models` 为空，仍应沿用现有错误处理：系统本身无法创建 agent

## 结论

本次需求应落地为一个通用、配置驱动的 subagent 模型路由系统，而不是针对某些模型名的硬编码特判。

推荐方案为：

- 新增 `subagents.model_routing`
- 用户自行配置父模型集合、候选子模型顺序和 fallback
- 运行时统一由 subagent 选模层进行解析
- 默认优先保证系统可运行，候选缺失时回退到默认模型 `models[0]`

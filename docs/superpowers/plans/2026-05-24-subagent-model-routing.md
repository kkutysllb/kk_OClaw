# Subagent Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 subagent 增加完全配置化的父模型到子模型路由能力，在命中规则时优先选择候选执行模型，否则安全回退到默认模型。

**Architecture:** 在 `config/subagents_config.py` 中新增 `model_routing` 配置模型；在 `subagents/config.py` 中集中实现路由解析与 fallback；`task_tool` 和 `SubagentExecutor` 只负责继续传递 `parent_model` / `subagent_type`，不分散业务逻辑。显式 `subagent.model` 保持最高优先级，未命中路由时保持现有行为。

**Tech Stack:** Python, Pydantic, pytest, dataclasses, existing subagent registry/executor pipeline

---

## File Structure

- Modify: `backend/packages/harness/kkoclaw/config/subagents_config.py`
  - 负责新增 `model_routing` 配置结构和读取逻辑
- Modify: `backend/packages/harness/kkoclaw/subagents/config.py`
  - 负责集中实现 routed model resolve 逻辑
- Modify: `backend/packages/harness/kkoclaw/tools/builtins/task_tool.py`
  - 负责把 `subagent_type` 传入统一解析入口
- Modify: `backend/packages/harness/kkoclaw/subagents/executor.py`
  - 负责在最终建模时继续使用统一解析入口
- Modify: `config.example.yaml`
  - 负责展示 `subagents.model_routing` 的示例配置
- Create: `backend/tests/test_subagent_model_routing.py`
  - 负责覆盖 routing 配置解析与 resolver 逻辑
- Modify: `backend/tests/test_task_tool_core_logic.py`
  - 负责验证 `task_tool` 将 `subagent_type`/选模结果正确传递给工具层与执行器

## Task 1: 新增 `model_routing` 配置模型

**Files:**

- Create: `backend/tests/test_subagent_model_routing.py`
- Modify: `backend/packages/harness/kkoclaw/config/subagents_config.py`

- [ ] **Step 1: 在新测试文件中加入配置解析失败用例**

```python
from kkoclaw.config.subagents_config import SubagentsAppConfig


def test_subagents_config_parses_model_routing_rules() -> None:
    config = SubagentsAppConfig(
        model_routing={
            "enabled": True,
            "rules": [
                {
                    "parent_models": ["deepseek-v4-flash", "deepseek-v4-pro"],
                    "include_subagent_types": ["general-purpose"],
                    "exclude_subagent_types": ["bash"],
                    "preferred_models": ["glm-5.1", "minimax-m2.5"],
                    "fallback": "default",
                }
            ],
        }
    )

    assert config.model_routing.enabled is True
    assert len(config.model_routing.rules) == 1
    rule = config.model_routing.rules[0]
    assert rule.parent_models == ["deepseek-v4-flash", "deepseek-v4-pro"]
    assert rule.include_subagent_types == ["general-purpose"]
    assert rule.exclude_subagent_types == ["bash"]
    assert rule.preferred_models == ["glm-5.1", "minimax-m2.5"]
    assert rule.fallback == "default"
```

- [ ] **Step 2: 加入默认值与空配置兼容用例**

```python
from kkoclaw.config.subagents_config import SubagentsAppConfig


def test_subagents_config_defaults_model_routing_to_disabled() -> None:
    config = SubagentsAppConfig()

    assert config.model_routing.enabled is False
    assert config.model_routing.rules == []
```

- [ ] **Step 3: 运行新测试，确认先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_subagent_model_routing.py -q`

Expected: FAIL，提示 `SubagentsAppConfig` 没有 `model_routing` 字段或相关类型未定义。

- [ ] **Step 4: 在 `subagents_config.py` 中新增配置模型**

```python
from typing import Literal


class SubagentModelRoutingRuleConfig(BaseModel):
    parent_models: list[str] = Field(default_factory=list, description="Parent model names that trigger this rule")
    include_subagent_types: list[str] | None = Field(default=None, description="Optional allowlist of subagent types")
    exclude_subagent_types: list[str] | None = Field(default=None, description="Optional denylist of subagent types")
    preferred_models: list[str] = Field(default_factory=list, description="Preferred target models in priority order")
    fallback: Literal["default", "inherit"] = Field(default="default", description="Fallback behavior when no preferred model exists")


class SubagentModelRoutingConfig(BaseModel):
    enabled: bool = Field(default=False, description="Whether subagent model routing is enabled")
    rules: list[SubagentModelRoutingRuleConfig] = Field(default_factory=list, description="Ordered routing rules; first match wins")
```

- [ ] **Step 5: 将 `model_routing` 挂到 `SubagentsAppConfig`**

```python
class SubagentsAppConfig(BaseModel):
    timeout_seconds: int = Field(...)
    max_turns: int | None = Field(...)
    agents: dict[str, SubagentOverrideConfig] = Field(default_factory=dict, ...)
    custom_agents: dict[str, CustomSubagentConfig] = Field(default_factory=dict, ...)
    model_routing: SubagentModelRoutingConfig = Field(
        default_factory=SubagentModelRoutingConfig,
        description="Optional parent-model to subagent-model routing rules",
    )
```

- [ ] **Step 6: 在加载日志中补充 routing 开关摘要**

```python
routing_summary = (
    f"enabled={_subagents_config.model_routing.enabled}, rules={len(_subagents_config.model_routing.rules)}"
)
```

并把它加到现有 `logger.info(...)` 中，避免将来排查时看不到配置是否生效。

- [ ] **Step 7: 运行测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_subagent_model_routing.py -q`

Expected: PASS

- [ ] **Step 8: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/packages/harness/kkoclaw/config/subagents_config.py backend/tests/test_subagent_model_routing.py
git commit -m "feat: add subagent model routing config"
```

## Task 2: 实现统一的 routed model resolve 逻辑

**Files:**

- Modify: `backend/packages/harness/kkoclaw/subagents/config.py`
- Modify: `backend/tests/test_subagent_model_routing.py`

- [ ] **Step 1: 在测试文件中加入“显式 model 优先”失败用例**

```python
from kkoclaw.subagents.config import SubagentConfig, resolve_subagent_model_name
from kkoclaw.config.subagents_config import SubagentsAppConfig


def test_resolve_subagent_model_name_preserves_explicit_model() -> None:
    config = SubagentConfig(
        name="general-purpose",
        description="gp",
        system_prompt="test",
        model="custom-executor",
    )
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="default-model")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "custom-executor"
```

- [ ] **Step 2: 加入候选命中 / fallback / exclude 的失败用例**

```python
def test_resolve_subagent_model_name_uses_first_available_preferred_model() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[
            SimpleNamespace(name="default-model"),
            SimpleNamespace(name="glm-5.1"),
            SimpleNamespace(name="minimax-m2.5"),
        ],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "minimax-m2.5"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "glm-5.1"


def test_resolve_subagent_model_name_falls_back_to_default_model_when_candidates_missing() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="deepseek-v4-flash")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "minimax-m2.5"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "deepseek-v4-flash"


def test_resolve_subagent_model_name_skips_rule_for_excluded_subagent_type() -> None:
    config = SubagentConfig(name="bash", description="bash", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="default-model"), SimpleNamespace(name="glm-5.1")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["deepseek-v4-flash"],
                        "include_subagent_types": ["general-purpose", "bash"],
                        "exclude_subagent_types": ["bash"],
                        "preferred_models": ["glm-5.1"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "deepseek-v4-flash",
        subagent_type="bash",
        app_config=app_config,
    )
    assert resolved == "deepseek-v4-flash"
```

- [ ] **Step 3: 运行测试，确认先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_subagent_model_routing.py -q`

Expected: FAIL，提示 `resolve_subagent_model_name()` 不接受 `subagent_type`，或断言仍然沿用旧继承逻辑。

- [ ] **Step 4: 在 `subagents/config.py` 中新增辅助函数**

```python
def _configured_model_names(app_config: "AppConfig") -> set[str]:
    return {model.name for model in app_config.models}


def _rule_matches(*, rule, parent_model: str | None, subagent_type: str | None) -> bool:
    if parent_model is None or parent_model not in rule.parent_models:
        return False
    if rule.include_subagent_types and subagent_type not in rule.include_subagent_types:
        return False
    if rule.exclude_subagent_types and subagent_type in rule.exclude_subagent_types:
        return False
    return True
```

- [ ] **Step 5: 扩展 `resolve_subagent_model_name()` 签名并接入路由逻辑**

```python
def resolve_subagent_model_name(
    config: SubagentConfig,
    parent_model: str | None,
    *,
    subagent_type: str | None = None,
    app_config: "AppConfig | None" = None,
) -> str:
    if config.model != "inherit":
        return config.model

    if app_config is None:
        from kkoclaw.config import get_app_config
        app_config = get_app_config()

    routing = getattr(getattr(app_config, "subagents", None), "model_routing", None)
    if routing and routing.enabled:
        configured_names = _configured_model_names(app_config)
        for rule in routing.rules:
            if not _rule_matches(rule=rule, parent_model=parent_model, subagent_type=subagent_type):
                continue
            for candidate in rule.preferred_models:
                if candidate in configured_names:
                    return candidate
            if rule.fallback == "inherit" and parent_model is not None:
                return parent_model
            return _default_model_name(app_config)

    if parent_model is not None:
        return parent_model
    return _default_model_name(app_config)
```

- [ ] **Step 6: 加一条 debug 日志**

```python
logger.debug(
    "subagent.model_routing matched parent=%s type=%s selected=%s fallback=%s",
    parent_model,
    subagent_type,
    selected_model,
    fallback_used,
)
```

只记录模型名与 subagent 类型，不记录 prompt 或用户消息。

- [ ] **Step 7: 运行测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_subagent_model_routing.py -q`

Expected: PASS

- [ ] **Step 8: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/packages/harness/kkoclaw/subagents/config.py backend/tests/test_subagent_model_routing.py
git commit -m "feat: add routed subagent model resolution"
```

## Task 3: 把 `subagent_type` 接入现有调用链

**Files:**

- Modify: `backend/packages/harness/kkoclaw/tools/builtins/task_tool.py`
- Modify: `backend/packages/harness/kkoclaw/subagents/executor.py`
- Modify: `backend/tests/test_task_tool_core_logic.py`

- [ ] **Step 1: 在 `test_task_tool_core_logic.py` 中加入失败用例**

```python
def test_task_tool_passes_subagent_type_to_model_resolution(monkeypatch):
    config = _make_subagent_config()
    runtime = _make_runtime()
    captured = {}

    class DummyExecutor:
        def __init__(self, **kwargs):
            captured["executor_kwargs"] = kwargs

        def execute_async(self, prompt, task_id=None):
            return task_id or "generated-task-id"

    def fake_resolve_subagent_model_name(config_arg, parent_model, *, subagent_type=None, app_config=None):
        captured["resolve_call"] = {
            "config": config_arg,
            "parent_model": parent_model,
            "subagent_type": subagent_type,
            "app_config": app_config,
        }
        return "glm-5.1"

    monkeypatch.setattr(task_tool_module, "SubagentStatus", FakeSubagentStatus)
    monkeypatch.setattr(task_tool_module, "SubagentExecutor", DummyExecutor)
    monkeypatch.setattr(task_tool_module, "get_subagent_config", lambda _: config)
    monkeypatch.setattr(task_tool_module, "resolve_subagent_model_name", fake_resolve_subagent_model_name)
    monkeypatch.setattr(task_tool_module, "get_background_task_result", lambda _: _make_result(FakeSubagentStatus.COMPLETED, result="done"))
    monkeypatch.setattr(task_tool_module, "get_stream_writer", lambda: lambda event: None)
    monkeypatch.setattr(task_tool_module.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr("kkoclaw.tools.get_available_tools", lambda **kwargs: ["tool-a"])

    output = _run_task_tool(
        runtime=runtime,
        description="运行子任务",
        prompt="collect diagnostics",
        subagent_type="general-purpose",
        tool_call_id="tc-routing",
    )

    assert output == "Task Succeeded. Result: done"
    assert captured["resolve_call"]["subagent_type"] == "general-purpose"
```

- [ ] **Step 2: 运行该测试，确认先失败**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_task_tool_core_logic.py::test_task_tool_passes_subagent_type_to_model_resolution -q`

Expected: FAIL，提示 `resolve_subagent_model_name()` 调用参数不匹配，或未向其传入 `subagent_type`。

- [ ] **Step 3: 修改 `task_tool.py`，把 `subagent_type` 传给 resolver**

```python
effective_model = resolve_subagent_model_name(
    config,
    parent_model,
    subagent_type=subagent_type,
    app_config=resolved_app_config,
)
```

- [ ] **Step 4: 修改 `SubagentExecutor`，确保最终建模时也传入 `self.config.name`**

```python
if config.model != "inherit" or parent_model is not None or app_config is not None:
    self.model_name = resolve_subagent_model_name(
        config,
        parent_model,
        subagent_type=config.name,
        app_config=app_config,
    )
```

以及：

```python
if self.model_name is None:
    self.model_name = resolve_subagent_model_name(
        self.config,
        self.parent_model,
        subagent_type=self.config.name,
        app_config=app_config,
    )
```

- [ ] **Step 5: 运行定向测试，确认通过**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_task_tool_core_logic.py::test_task_tool_passes_subagent_type_to_model_resolution tests/test_subagent_model_routing.py -q`

Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add backend/packages/harness/kkoclaw/tools/builtins/task_tool.py backend/packages/harness/kkoclaw/subagents/executor.py backend/tests/test_task_tool_core_logic.py backend/tests/test_subagent_model_routing.py
git commit -m "feat: thread subagent type into model routing"
```

## Task 4: 更新示例配置并完成回归

**Files:**

- Modify: `config.example.yaml`
- Modify: `backend/tests/test_subagent_model_routing.py`

- [ ] **Step 1: 在 `config.example.yaml` 增加最小可读示例**

```yaml
# subagents:
#   model_routing:
#     enabled: true
#     rules:
#       - parent_models: ["deepseek-v4-flash", "deepseek-v4-pro"]
#         include_subagent_types: ["general-purpose"]
#         exclude_subagent_types: ["bash"]
#         preferred_models: ["glm-5.1", "minimax-m2.5"]
#         fallback: default
```

要求：

- 写在 `subagents` 配置段附近
- 明确说明父模型名、候选模型名都由用户自己配置
- 说明 `fallback: default` 表示回退到 `models[0]`

- [ ] **Step 2: 在测试文件中补“只配置一个模型也能运行”的用例**

```python
def test_resolve_subagent_model_name_with_single_configured_model_still_runs() -> None:
    config = SubagentConfig(name="general-purpose", description="gp", system_prompt="test")
    app_config = SimpleNamespace(
        models=[SimpleNamespace(name="only-model")],
        subagents=SubagentsAppConfig(
            model_routing={
                "enabled": True,
                "rules": [
                    {
                        "parent_models": ["only-model"],
                        "include_subagent_types": ["general-purpose"],
                        "preferred_models": ["glm-5.1", "custom-minimax"],
                        "fallback": "default",
                    }
                ],
            }
        ),
    )

    resolved = resolve_subagent_model_name(
        config,
        "only-model",
        subagent_type="general-purpose",
        app_config=app_config,
    )
    assert resolved == "only-model"
```

- [ ] **Step 3: 运行定向回归**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && uv run pytest tests/test_subagent_model_routing.py tests/test_task_tool_core_logic.py tests/test_subagent_timeout_config.py tests/test_subagent_executor.py -q`

Expected: PASS

- [ ] **Step 4: 运行编译检查**

Run: `cd /Users/libing/kk_Projects/kk_OClaw/backend && python -m compileall packages/harness/kkoclaw/config packages/harness/kkoclaw/subagents packages/harness/kkoclaw/tools/builtins`

Expected: exit code 0

- [ ] **Step 5: 提交**

```bash
cd /Users/libing/kk_Projects/kk_OClaw
git add config.example.yaml backend/tests/test_subagent_model_routing.py
git commit -m "docs: add subagent model routing example"
```

## Self-Review Checklist

- Spec coverage:
  - 配置化规则：Task 1
  - 路由解析与 fallback：Task 2
  - 调用链接线：Task 3
  - 单模型可运行与示例配置：Task 4
- Placeholder scan:
  - 每个任务都给了具体文件、测试名、命令与代码片段
  - 没有 `TODO` / `TBD` / “类似前一个任务”
- Type consistency:
  - 统一使用 `model_routing`
  - 统一使用 `preferred_models`
  - resolver 统一新增 `subagent_type` 参数

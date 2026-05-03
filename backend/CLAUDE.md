# CLAUDE.md

此文件为 Claude Code 在处理此仓库代码时提供指导。

## 项目概述

KKOCLAW 是一个基于 LangGraph 的 AI 超级智能体系统，采用全栈架构。后端提供"超级智能体"，具有沙箱执行、持久记忆、子智能体委派和可扩展工具集成能力——全部在 per-thread 隔离环境中运行。

**架构**:
- **Gateway API** (port 9193): REST API 和内嵌 LangGraph 兼容的 agent 运行时
- **Frontend** (port 9192): Next.js 网页界面
- **Nginx** (port 9191): 统一反向代理入口
- **Provisioner** (port 9194, Docker 开发中可选): 仅在沙箱配置为 provisioner/Kubernetes 模式时启动

**运行时**:
- `make dev`、Docker 开发和 Docker 生产都在 Gateway 中运行 agent 运行时，通过 `RunManager` + `run_agent()` + `StreamBridge` (`packages/harness/kkoclaw/runtime/`)

**项目结构**:
```
kk_OClaw/
├── Makefile                    # 根命令
├── config.yaml                 # 主应用配置
├── extensions_config.json      # MCP 服务器和技能配置
├── backend/                    # 后端应用
│   ├── packages/harness/       # kkoclaw-harness 包 (import: kkoclaw.*)
│   │   └── kkoclaw/
│   │       ├── agents/         # LangGraph agent 系统
│   │       ├── sandbox/        # 沙箱执行系统
│   │       ├── subagents/      # 子智能体委派系统
│   │       ├── tools/builtins/ # 内置工具
│   │       ├── mcp/            # MCP 集成
│   │       ├── models/         # 模型工厂
│   │       ├── skills/         # 技能系统
│   │       ├── config/         # 配置系统
│   │       ├── community/      # 社区工具
│   │       ├── reflection/     # 动态模块加载
│   │       └── client.py       # 嵌入式 Python Client
│   └── app/                    # 应用层 (import: app.*)
│       ├── gateway/            # FastAPI Gateway API
│       └── channels/           # IM 平台集成
├── frontend/                   # Next.js 前端应用
└── skills/                     # Agent 技能目录
```

## 命令

**根目录** (完整应用):
```bash
make check      # 检查系统要求
make install    # 安装所有依赖
make dev        # 启动所有服务
make stop       # 停止所有服务
```

**后端目录** (仅后端开发):
```bash
make install    # 安装后端依赖
make dev        # 运行 Gateway API 带热重载
make gateway    # 仅运行 Gateway API
make test       # 运行所有后端测试
make lint       # lint 检查
make format     # 代码格式化
```

## 架构

### Harness / App 分层

后端分为两层，具有严格的依赖方向：

- **Harness** (`packages/harness/kkoclaw/`): 可发布的 agent 框架包 (`kkoclaw-harness`)。导入前缀: `kkoclaw.*`。包含 agent 编排、工具、沙箱、模型、MCP、技能、配置。
- **App** (`app/`): 未发布的应用代码。导入前缀: `app.*`。包含 FastAPI Gateway API 和 IM 渠道集成。

**依赖规则**: App 导入 kkoclaw，但 kkoclaw 永不导入 app。此边界由 CI 中的 `tests/test_harness_boundary.py` 强制执行。

### Agent 系统

**Lead Agent** (`packages/harness/kkoclaw/agents/lead_agent/agent.py`):
- 入口: `make_lead_agent(config: RunnableConfig)` 注册在 `langgraph.json`
- 通过 `create_chat_model()` 动态模型选择
- 工具通过 `get_available_tools()` 加载
- 系统提示词由 `apply_prompt_template()` 生成

**ThreadState** (`packages/harness/kkoclaw/agents/thread_state.py`):
- 扩展 `AgentState`: `sandbox`, `thread_data`, `title`, `artifacts`, `todos`, `uploaded_files`, `viewed_images`

**运行时配置** (via `config.configurable`):
- `thinking_enabled` - 启用模型扩展思考
- `model_name` - 选择特定 LLM 模型
- `is_plan_mode` - 启用 TodoList 中间件
- `subagent_enabled` - 启用任务委派工具

### 中间件链

Lead-agent 中间件按严格顺序组装：

1. **ThreadDataMiddleware** - 创建 per-thread 目录
2. **UploadsMiddleware** - 追踪注入上传文件
3. **SandboxMiddleware** - 获取沙箱
4. **DanglingToolCallMiddleware** - 注入占位 ToolMessage
5. **LLMErrorHandlingMiddleware** - 标准化 LLM 错误
6. **GuardrailMiddleware** - 工具调用前授权（可选）
7. **SandboxAuditMiddleware** - 安全审计
8. **ToolErrorHandlingMiddleware** - 工具异常转错误
9. **SummarizationMiddleware** - 上下文压缩（可选）
10. **TodoListMiddleware** - 任务追踪（可选）
11. **TokenUsageMiddleware** - Token 统计（可选）
12. **TitleMiddleware** - 自动标题
13. **MemoryMiddleware** - 记忆更新队列
14. **ViewImageMiddleware** - 图片注入（视觉模型）
15. **DeferredToolFilterMiddleware** - 延迟工具（可选）
16. **SubagentLimitMiddleware** - 子智能体限制（可选）
17. **LoopDetectionMiddleware** - 循环检测
18. **ClarificationMiddleware** - 澄清拦截（必须最后）

### 沙箱系统 (`packages/harness/kkoclaw/sandbox/`)

**接口**: 抽象 `Sandbox` with `execute_command`, `read_file`, `write_file`, `list_dir`
**提供者模式**: `SandboxProvider` with `acquire`, `get`, `release` 生命周期
**实现**:
- `LocalSandboxProvider` - 单例本地文件系统执行
- `AioSandboxProvider` - Docker 隔离

**虚拟路径系统**:
- Agent 看到: `/mnt/user-data/{workspace,uploads,outputs}`, `/mnt/skills`
- 物理路径: `backend/.kkoclaw/users/{user_id}/threads/{thread_id}/user-data/...`

### 子智能体系统 (`packages/harness/kkoclaw/subagents/`)

**内置 Agent**: `general-purpose`（除 `task` 外的所有工具）和 `bash`（命令专家）
**执行**: 双线程池 - `_scheduler_pool` (3 workers) + `_execution_pool` (3 workers)
**并发**: `MAX_CONCURRENT_SUBAGENTS = 3`，15 分钟超时

### 记忆系统 (`packages/harness/kkoclaw/agents/memory/`)

**组件**:
- `updater.py` - LLM 记忆更新与事实提取
- `queue.py` - 防抖更新队列
- `prompt.py` - 记忆更新提示词模板
- `storage.py` - 文件存储，per-user 隔离

**Per-User 隔离**: 记忆存储在 `{base_dir}/users/{user_id}/memory.json`

### Gateway API (`app/gateway/`)

FastAPI 应用，端口 8001。

**路由**: Models, MCP, Skills, Memory, Uploads, Threads, Artifacts, Suggestions, Thread Runs, Feedback

### IM 渠道系统 (`app/channels/`)

桥接外部消息平台（飞书、Slack、Telegram、钉钉）到 KKOCLAW agent。

## 代码风格

- 使用 `ruff` 进行 lint 和格式化
- 行宽: 240 字符
- Python 3.12+ 带类型提示
- 双引号，空格缩进

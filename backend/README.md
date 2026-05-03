# KKOCLAW 后端

KKOCLAW 是一个基于 LangGraph 的 AI 超级智能体系统，具有沙箱执行、持久记忆和可扩展工具集成能力。后端使 AI 智能体能够在隔离的 per-thread 环境中执行代码、浏览网页、管理文件、委派任务给子智能体，并跨会话保留上下文。

---

## 架构

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (Port 2026)           │
                        │      Unified reverse proxy           │
                        └───────┬──────────────────┬───────────┘
                                │                  │
              /api/langgraph/*  │                  │  /api/* (other)
                                ▼                  ▼
               ┌────────────────────┐  ┌────────────────────────┐
               │ LangGraph Server   │  │   Gateway API (8001)   │
               │    (Port 2024)     │  │   FastAPI REST         │
               │                    │  │                        │
               │ ┌────────────────┐ │  │ Models, MCP, Skills,   │
               │ │  Lead Agent    │ │  │ Memory, Uploads,       │
               │ │  ┌──────────┐  │ │  │ Artifacts              │
               │ │  │Middleware│  │ │  └────────────────────────┘
               │ │  │  Chain   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │  Tools   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │Subagents │  │ │
               │ │  └──────────┘  │ │
               │ └────────────────┘ │
               └────────────────────┘
```

**请求路由** (via Nginx):
- `/api/langgraph/*` → LangGraph Server - agent 交互、线程、流式传输
- `/api/*` (other) → Gateway API - 模型、MCP、技能、记忆、上传、产物
- `/` (non-API) → Frontend - Next.js 网页界面

---

## 核心组件

### Lead Agent

单一的 LangGraph agent (`lead_agent`) 是运行时入口，通过 `make_lead_agent(config)` 创建。它整合了：

- **动态模型选择**，支持 thinking 和 vision
- **中间件链**，处理横切关注点（18 个中间件）
- **工具系统**，包含沙箱、MCP、社区和内置工具
- **子智能体委派**，用于并行任务执行
- **系统提示词**，注入技能、记忆上下文和工作目录指导

### 中间件链

中间件按严格顺序执行，每个处理特定关注点：

| # | 中间件 | 用途 |
|---|--------|------|
| 1 | ThreadDataMiddleware | 创建 per-thread 隔离目录 |
| 2 | UploadsMiddleware | 将新上传的文件注入会话上下文 |
| 3 | SandboxMiddleware | 获取沙箱执行环境 |
| 4 | DanglingToolCallMiddleware | 修复悬空工具调用 |
| 5 | LLMErrorHandlingMiddleware | 标准化 LLM 调用错误 |
| 6 | GuardrailMiddleware | 工具调用前安全授权（可选） |
| 7 | SandboxAuditMiddleware | Shell/文件操作安全审计 |
| 8 | ToolErrorHandlingMiddleware | 工具异常转错误消息 |
| 9 | SummarizationMiddleware | 上下文 Token 超限压缩（可选） |
| 10 | TodoListMiddleware | Plan Mode 多步骤任务追踪（可选） |
| 11 | TokenUsageMiddleware | Token 用量统计（可选） |
| 12 | TitleMiddleware | 自动生成对话标题 |
| 13 | MemoryMiddleware | 异步记忆提取队列 |
| 14 | ViewImageMiddleware | 视觉模型图片注入（条件启用） |
| 15 | DeferredToolFilterMiddleware | 延迟工具加载（可选） |
| 16 | SubagentLimitMiddleware | 限制并发子智能体（可选） |
| 17 | LoopDetectionMiddleware | 检测工具调用循环 |
| 18 | ClarificationMiddleware | 拦截澄清请求（必须为最后） |

### 沙箱系统

Per-thread 隔离执行，带虚拟路径翻译：

- **抽象接口**: `execute_command`, `read_file`, `write_file`, `list_dir`
- **提供者**: `LocalSandboxProvider`（文件系统）和 `AioSandboxProvider`（Docker）
- **虚拟路径**: `/mnt/user-data/{workspace,uploads,outputs}` → 线程特定物理目录
- **技能路径**: `/mnt/skills` → `skills/` 目录
- **工具**: `bash`, `ls`, `read_file`, `write_file`, `str_replace`（本地提供者下 bash 默认禁用）

### 子智能体系统

异步任务委派，支持并发执行：

- **内置 Agent**: `general-purpose`（全工具集）和 `bash`（命令专家）
- **并发**: 每轮最多 3 个子智能体，15 分钟超时
- **执行**: 后台线程池，带状态追踪和 SSE 事件
- **流程**: Agent 调用 `task()` 工具 → 执行器在后台运行子智能体 → 轮询完成 → 返回结果

### 记忆系统

LLM 驱动的跨会话持久上下文保留：

- **自动提取**: 分析对话以获取用户上下文、事实和偏好
- **结构化存储**: 用户上下文、历史记录和带置信度评分的事实
- **防抖更新**: 批量更新以最小化 LLM 调用
- **系统提示词注入**: Top 事实 + 上下文注入 agent 提示词
- **存储**: JSON 文件，基于 mtime 的缓存失效

### 工具生态

| 类别 | 工具 |
|------|------|
| **沙箱** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **内置** | `present_files`, `ask_clarification`, `view_image`, `task`（子智能体） |
| **社区** | Tavily（网页搜索）、Jina AI（网页抓取）、Firecrawl（抓取）、DuckDuckGo（图片搜索） |
| **MCP** | 任意 Model Context Protocol 服务器（stdio、SSE、HTTP 传输） |
| **Skills** | 通过系统提示词注入的领域特定工作流 |

### Gateway API

FastAPI 应用，为前端集成提供 REST 端点：

| 路由 | 用途 |
|------|------|
| `GET /api/models` | 列出可用 LLM 模型 |
| `GET/PUT /api/mcp/config` | 管理 MCP 服务器配置 |
| `GET/PUT /api/skills` | 列出和管理技能 |
| `POST /api/skills/install` | 从 .skill 档案安装技能 |
| `GET /api/memory` | 检索记忆数据 |
| `POST /api/memory/reload` | 强制记忆重载 |
| `POST /api/threads/{id}/uploads` | 上传文件 |
| `DELETE /api/threads/{id}` | 删除本地线程数据 |

### IM 渠道

IM 桥接支持飞书、Slack、Telegram、钉钉等平台。渠道通过 `langgraph-sdk` HTTP 客户端与 Gateway 通信。

---

## 项目结构

```
backend/
├── packages/harness/kkoclaw/   # Harness 层（可发布 Agent 框架包）
│   ├── agents/                  # Agent 系统
│   │   ├── lead_agent/          # 主 agent（工厂、提示词）
│   │   ├── middlewares/         # 18 个中间件组件
│   │   ├── memory/              # 记忆提取与存储
│   │   └── thread_state.py      # ThreadState 数据模型
│   ├── sandbox/                 # 沙箱执行
│   │   ├── local/               # 本地文件系统提供者
│   │   ├── sandbox.py           # 抽象接口
│   │   ├── tools.py             # bash, ls, read/write/str_replace
│   │   └── middleware.py        # 沙箱生命周期
│   ├── subagents/               # 子智能体委派
│   │   ├── builtins/            # general-purpose, bash agents
│   │   ├── executor.py          # 后台执行引擎
│   │   └── registry.py          # Agent 注册表
│   ├── tools/builtins/          # 内置工具
│   ├── mcp/                     # MCP 协议集成
│   ├── models/                  # 模型工厂
│   ├── skills/                  # 技能发现与加载
│   ├── config/                  # 配置系统
│   ├── community/               # 社区工具与提供者
│   ├── reflection/              # 动态模块加载
│   └── client.py                # 嵌入式 Python client
├── app/                         # 应用层
│   ├── gateway/                 # FastAPI Gateway API
│   └── channels/                # IM 平台集成
├── tests/                       # 测试套件
├── docs/                        # 文档
├── langgraph.json               # LangGraph 服务器配置
└── pyproject.toml               # Python 依赖
```

---

## 技术栈

- **LangGraph** (1.0.6+) - Agent 框架和多智能体编排
- **LangChain** (1.2.3+) - LLM 抽象和工具系统
- **FastAPI** (0.115.0+) - Gateway REST API
- **langchain-mcp-adapters** - Model Context Protocol 支持
- **agent-sandbox** - 沙箱代码执行
- **markitdown** - 多格式文档转换
- **tavily-python** / **firecrawl-py** - 网页搜索和抓取

---

## 许可证

详见项目根目录的 [LICENSE](../LICENSE) 文件。

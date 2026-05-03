# 架构概述

本文档提供了 KKOCLAW 后端架构的全面概述。

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              客户端（浏览器）                              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Nginx（端口 2026）                               │
│                    统一反向代理入口点                                      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  /api/langgraph/*  →  LangGraph 服务器（2024）                       │  │
│  │  /api/*            →  网关 API（8001）                               │  │
│  │  /*                →  前端（3000）                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   LangGraph 服务器   │ │    网关 API         │ │     前端            │
│    （端口 2024）      │ │   （端口 8001）       │ │   （端口 3000）      │
│                     │ │                     │ │                     │
│  - Agent 运行时     │ │  - 模型 API         │ │  - Next.js 应用     │
│  - 线程管理         │ │  - MCP 配置         │ │  - React UI         │
│  - SSE 流式响应     │ │  - 技能管理         │ │  - 聊天界面         │
│  - 检查点           │ │  - 文件上传         │ │                     │
│                     │ │  - 线程清理         │ │                     │
│                     │ │  - 制品管理         │ │                     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
          │                       │
          │     ┌─────────────────┘
          │     │
          ▼     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          共享配置                                          │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │      config.yaml        │  │      extensions_config.json            │ │
│  │  - 模型配置             │  │  - MCP 服务器                         │ │
│  │  - 工具配置             │  │  - 技能状态                           │ │
│  │  - 沙箱配置             │  │                                        │ │
│  │  - 摘要配置             │  │                                        │ │
│  └─────────────────────────┘  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## 组件详情

### LangGraph 服务器

LangGraph 服务器是核心 Agent 运行时，基于 LangGraph 构建，用于健壮的多 Agent 工作流编排。

**入口点**：`packages/harness/kkoclaw/agents/lead_agent/agent.py:make_lead_agent`

**主要职责**：
- Agent 的创建和配置
- 线程状态管理
- 中间件链执行
- 工具执行编排
- SSE 流式实时响应

**配置**：`langgraph.json`

```json
{
  "agent": {
    "type": "agent",
    "path": "kkoclaw.agents:make_lead_agent"
  }
}
```

### 网关 API

基于 FastAPI 的应用程序，提供非 Agent 操作的 REST 端点。

**入口点**：`app/gateway/app.py`

**路由模块**：
- `models.py` - `/api/models` - 模型列表和详情
- `mcp.py` - `/api/mcp` - MCP 服务器配置
- `skills.py` - `/api/skills` - 技能管理
- `uploads.py` - `/api/threads/{id}/uploads` - 文件上传
- `threads.py` - `/api/threads/{id}` - LangGraph 删除后清理本地 KKOCLAW 线程数据
- `artifacts.py` - `/api/threads/{id}/artifacts` - 制品服务
- `suggestions.py` - `/api/threads/{id}/suggestions` - 后续建议生成

Web 对话删除流程现在分布在两个后端面上：LangGraph 处理 `DELETE /api/langgraph/threads/{thread_id}` 以清理线程状态，然后网关的 `threads.py` 路由通过 `Paths.delete_thread_dir()` 移除 KKOCLAW 管理的文件系统数据。

### Agent 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           make_lead_agent(config)                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            中间件链                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. ThreadDataMiddleware  - 初始化工作区/上传/输出目录        │   │
│  │ 2. UploadsMiddleware     - 处理上传的文件                      │   │
│  │ 3. SandboxMiddleware     - 获取沙箱环境                        │   │
│  │ 4. SummarizationMiddleware - 上下文缩减（如启用）              │   │
│  │ 5. TitleMiddleware       - 自动生成标题                        │   │
│  │ 6. TodoListMiddleware    - 任务跟踪（计划模式）                │   │
│  │ 7. ViewImageMiddleware   - 视觉模型支持                        │   │
│  │ 8. ClarificationMiddleware - 处理澄清请求                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Agent 核心                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │      模型        │  │      工具        │  │    系统提示词        │   │
│  │  （来自工厂）    │  │  （已配置 +       │  │  （含技能）          │   │
│  │                  │  │   MCP + 内置）   │  │                      │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 线程状态

`ThreadState` 扩展了 LangGraph 的 `AgentState` 并增加了额外字段：

```python
class ThreadState(AgentState):
    # 继承自 AgentState 的核心状态
    messages: list[BaseMessage]

    # KKOCLAW 扩展
    sandbox: dict             # 沙箱环境信息
    artifacts: list[str]      # 生成的文件路径
    thread_data: dict         # {workspace, uploads, outputs} 路径
    title: str | None         # 自动生成的对话标题
    todos: list[dict]         # 任务跟踪（计划模式）
    viewed_images: dict       # 视觉模型图像数据
```

### 沙箱系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           沙箱架构                                        │
└─────────────────────────────────────────────────────────────────────────┘

                      ┌─────────────────────────┐
                      │    SandboxProvider      │ （抽象类）
                      │  - acquire()            │
                      │  - get()                │
                      │  - release()            │
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                                         │
              ▼                                         ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│  LocalSandboxProvider   │              │  AioSandboxProvider     │
│  (packages/harness/kkoclaw/sandbox/local.py) │              │  (packages/harness/kkoclaw/community/)       │
│                         │              │                         │
│  - 单例实例             │              │  - 基于 Docker          │
│  - 直接执行             │              │  - 隔离容器             │
│  - 开发环境使用         │              │  - 生产环境使用         │
└─────────────────────────┘              └─────────────────────────┘

                      ┌─────────────────────────┐
                      │        Sandbox          │ （抽象类）
                      │  - execute_command()    │
                      │  - read_file()          │
                      │  - write_file()         │
                      │  - list_dir()           │
                      └─────────────────────────┘
```

**虚拟路径映射**：

| 虚拟路径 | 物理路径 |
|---------|---------|
| `/mnt/user-data/workspace` | `backend/.kkoclaw/threads/{thread_id}/user-data/workspace` |
| `/mnt/user-data/uploads` | `backend/.kkoclaw/threads/{thread_id}/user-data/uploads` |
| `/mnt/user-data/outputs` | `backend/.kkoclaw/threads/{thread_id}/user-data/outputs` |
| `/mnt/skills` | `kk-oclaw/skills/` |

### 工具系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             工具来源                                      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│     内置工具        │  │    配置工具          │  │    MCP 工具         │
│  (packages/harness/kkoclaw/tools/)       │  │  (config.yaml)      │  │  (extensions.json)  │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ - present_files     │  │ - web_search        │  │ - github            │
│ - ask_clarification │  │ - web_fetch         │  │ - filesystem        │
│ - view_image        │  │ - bash              │  │ - postgres          │
│                     │  │ - read_file         │  │ - brave-search      │
│                     │  │ - write_file        │  │ - puppeteer         │
│                     │  │ - str_replace       │  │ - ...               │
│                     │  │ - ls                │  │                     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
           │                       │                       │
           └───────────────────────┴───────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   get_available_tools() │
                      │   (packages/harness/kkoclaw/tools/__init__)  │
                      └─────────────────────────┘
```

### 模型工厂

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            模型工厂                                       │
│                     (packages/harness/kkoclaw/models/factory.py)                              │
└─────────────────────────────────────────────────────────────────────────┘

config.yaml:
┌─────────────────────────────────────────────────────────────────────────┐
│ models:                                                                  │
│   - name: gpt-4                                                         │
│     display_name: GPT-4                                                 │
│     use: langchain_openai:ChatOpenAI                                    │
│     model: gpt-4                                                        │
│     api_key: $OPENAI_API_KEY                                            │
│     max_tokens: 4096                                                    │
│     supports_thinking: false                                            │
│     supports_vision: true                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   create_chat_model()   │
                      │  - name: str            │
                      │  - thinking_enabled     │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   resolve_class()       │
                      │  （反射机制）            │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   BaseChatModel         │
                      │  （LangChain 实例）      │
                      └─────────────────────────┘
```

**支持的提供商**：
- OpenAI（`langchain_openai:ChatOpenAI`）
- Anthropic（`langchain_anthropic:ChatAnthropic`）
- DeepSeek（`langchain_deepseek:ChatDeepSeek`）
- 通过 LangChain 集成自定义

### MCP 集成

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            MCP 集成                                      │
│                        (packages/harness/kkoclaw/mcp/manager.py)                              │
└─────────────────────────────────────────────────────────────────────────┘

extensions_config.json:
┌─────────────────────────────────────────────────────────────────────────┐
│ {                                                                        │
│   "mcpServers": {                                                       │
│     "github": {                                                         │
│       "enabled": true,                                                  │
│       "type": "stdio",                                                  │
│       "command": "npx",                                                 │
│       "args": ["-y", "@modelcontextprotocol/server-github"],           │
│       "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}                          │
│     }                                                                   │
│   }                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │  MultiServerMCPClient   │
                      │  (langchain-mcp-adapters)│
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       ┌───────────┐        ┌───────────┐        ┌───────────┐
       │  stdio    │        │   SSE     │        │   HTTP    │
       │ 传输      │        │ 传输      │        │ 传输      │
       └───────────┘        └───────────┘        └───────────┘
```

### 技能系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             技能系统                                      │
│                       (packages/harness/kkoclaw/skills/loader.py)                             │
└─────────────────────────────────────────────────────────────────────────┘

目录结构：
┌─────────────────────────────────────────────────────────────────────────┐
│ skills/                                                                  │
│ ├── public/                        # 公共技能（已提交至仓库）            │
│ │   ├── pdf-processing/                                                 │
│ │   │   └── SKILL.md                                                    │
│ │   ├── frontend-design/                                                │
│ │   │   └── SKILL.md                                                    │
│ │   └── ...                                                             │
│ └── custom/                        # 自定义技能（在 gitignore 中）       │
│     └── user-installed/                                                 │
│         └── SKILL.md                                                    │
└─────────────────────────────────────────────────────────────────────────┘

SKILL.md 格式：
┌─────────────────────────────────────────────────────────────────────────┐
│ ---                                                                      │
│ name: PDF Processing                                                     │
│ description: 高效处理 PDF 文档                                           │
│ license: MIT                                                            │
│ allowed-tools:                                                          │
│   - read_file                                                           │
│   - write_file                                                          │
│   - bash                                                                │
│ ---                                                                      │
│                                                                          │
│ # 技能指令                                                               │
│ 注入到系统提示词中的内容...                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 请求流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         请求流程示例                                      │
│                     用户向 Agent 发送消息                                │
└─────────────────────────────────────────────────────────────────────────┘

1. 客户端 → Nginx
   POST /api/langgraph/threads/{thread_id}/runs
   {"input": {"messages": [{"role": "user", "content": "Hello"}]}}

2. Nginx → LangGraph 服务器（2024）
   反向代理到 LangGraph 服务器

3. LangGraph 服务器
   a. 加载/创建线程状态
   b. 执行中间件链：
      - ThreadDataMiddleware：设置路径
      - UploadsMiddleware：注入文件列表
      - SandboxMiddleware：获取沙箱
      - SummarizationMiddleware：检查 token 限制
      - TitleMiddleware：根据需要生成标题
      - TodoListMiddleware：加载待办事项（计划模式）
      - ViewImageMiddleware：处理图像
      - ClarificationMiddleware：检查澄清请求

   c. 执行 Agent：
      - 模型处理消息
      - 可能调用工具（bash、web_search 等）
      - 工具通过沙箱执行
      - 结果添加到消息中

   d. 通过 SSE 流式传输响应

4. 客户端接收流式响应
```

## 数据流

### 文件上传流程

```
1. 客户端上传文件
   POST /api/threads/{thread_id}/uploads
   Content-Type: multipart/form-data

2. 网关接收文件
   - 验证文件
   - 存储到 .kkoclaw/threads/{thread_id}/user-data/uploads/
   - 如果是文档：通过 markitdown 转换为 Markdown

3. 返回响应
   {
     "files": [{
       "filename": "doc.pdf",
       "path": ".kkoclaw/.../uploads/doc.pdf",
       "virtual_path": "/mnt/user-data/uploads/doc.pdf",
       "artifact_url": "/api/threads/.../artifacts/mnt/.../doc.pdf"
     }]
   }

4. 下一次 Agent 运行
   - UploadsMiddleware 列出文件
   - 将文件列表注入到消息中
   - Agent 可通过 virtual_path 访问
```

### 线程清理流程

```
1. 客户端通过 LangGraph 删除对话
   DELETE /api/langgraph/threads/{thread_id}

2. Web UI 接着调用网关清理
   DELETE /api/threads/{thread_id}

3. 网关移除 KKOCLAW 管理的本地文件
   - 递归删除 .kkoclaw/threads/{thread_id}/
   - 目录不存在时视为无操作
   - 无效的线程 ID 在文件系统访问前被拒绝
```

### 配置重载

```
1. 客户端更新 MCP 配置
   PUT /api/mcp/config

2. 网关写入 extensions_config.json
   - 更新 mcpServers 部分
   - 文件 mtime 变化

3. MCP 管理器检测到变化
   - get_cached_mcp_tools() 检查 mtime
   - 如果有变化：重新初始化 MCP 客户端
   - 加载更新后的服务器配置

4. 下一次 Agent 运行使用新工具
```

## 安全考虑

### 沙箱隔离

- Agent 代码在沙箱边界内执行
- 本地沙箱：直接执行（仅开发环境）
- Docker 沙箱：容器隔离（生产环境推荐）
- 文件操作中的路径遍历防护

### API 安全

- 线程隔离：每个线程有独立的数据目录
- 文件验证：上传时检查路径安全性
- 环境变量解析：密钥不存储在配置中

### MCP 安全

- 每个 MCP 服务器在自己的进程中运行
- 环境变量在运行时解析
- 服务器可以独立启用/禁用

## 性能考虑

### 缓存

- MCP 工具通过文件 mtime 进行缓存失效
- 配置加载一次，文件变化时重新加载
- 技能在启动时解析一次，缓存在内存中

### 流式传输

- SSE 用于实时响应流式传输
- 减少首次响应时间
- 对长时间操作提供进度可见性

### 上下文管理

- 摘要中间件在接近限制时减少上下文
- 可配置的触发条件：token 数、消息数或比例
- 保留最新消息的同时摘要较旧的消息

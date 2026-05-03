# KKOCLAW

[English](./README.md) | 中文

[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](./Makefile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

KKOCLAW 是一个开源的 **super agent harness**。它把 **sub-agents**、**memory** 和 **sandbox** 组织在一起，再配合可扩展的 **skills**，让 agent 可以完成几乎任何事情。

---

## 目录

- [快速开始](#快速开始)
  - [配置](#配置)
  - [运行应用](#运行应用)
    - [部署建议与资源规划](#部署建议与资源规划)
    - [方式一：Docker（推荐）](#方式一docker推荐)
    - [方式二：本地开发](#方式二本地开发)
    - [方式三：start.sh 一键脚本（本地开发推荐）](#方式三startsh-一键脚本本地开发推荐)
  - [进阶配置](#进阶配置)
    - [Sandbox 模式](#sandbox-模式)
    - [MCP Server](#mcp-server)
    - [IM 渠道](#im-渠道)
    - [LangSmith 链路追踪](#langsmith-链路追踪)
- [核心特性](#核心特性)
  - [Skills 与 Tools](#skills-与-tools)
  - [Sub-Agents](#sub-agents)
  - [Sandbox 与文件系统](#sandbox-与文件系统)
  - [Context Engineering](#context-engineering)
  - [长期记忆](#长期记忆)
- [推荐模型](#推荐模型)
- [内嵌 Python Client](#内嵌-python-client)
- [文档](#文档)
- [安全使用](#️-安全使用)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 快速开始

### 配置

1. **克隆仓库**

   ```bash
   git clone <repository-url>
   cd kk_OClaw
   ```

2. **生成本地配置文件**

   在项目根目录执行：

   ```bash
   make config
   ```

   这个命令会基于示例模板生成本地配置文件。

3. **配置你要使用的模型**

   编辑 `config.yaml`，至少定义一个模型：

   ```yaml
   models:
     - name: gpt-4                       # 内部标识
       display_name: GPT-4               # 展示名称
       use: langchain_openai:ChatOpenAI  # LangChain 类路径
       model: gpt-4                      # API 使用的模型标识
       api_key: $OPENAI_API_KEY          # API key（推荐使用环境变量）
       max_tokens: 4096                  # 单次请求最大 tokens
       temperature: 0.7                  # 采样温度
   ```

4. **为已配置的模型设置 API key**

   推荐在项目根目录下的 `.env` 文件中设置：

   ```bash
   TAVILY_API_KEY=your-tavily-api-key
   OPENAI_API_KEY=your-openai-api-key
   ```

### 运行应用

#### 部署建议与资源规划

| 部署场景 | 起步配置 | 推荐配置 | 说明 |
|---------|-----------|------------|-------|
| 本地体验 / `make dev` | 4 vCPU、8 GB 内存、20 GB SSD | 8 vCPU、16 GB 内存 | 适合单个开发者或单个轻量会话 |
| Docker 开发 / `make docker-start` | 4 vCPU、8 GB 内存、25 GB SSD | 8 vCPU、16 GB 内存 | 镜像构建和 sandbox 容器更吃资源 |
| 长期运行服务 / `make up` | 8 vCPU、16 GB 内存、40 GB SSD | 16 vCPU、32 GB 内存 | 适合共享环境、多 agent 任务 |

- 上面的配置只覆盖 KKOCLAW 本身；本地大模型需单独预留资源。
- 持续运行的服务推荐 Linux + Docker。

#### 方式一：Docker（推荐）

**开发模式**（支持热更新，挂载源码）：

```bash
make docker-init    # 拉取 sandbox 镜像
make docker-start   # 启动服务
```

**生产模式**（本地构建镜像，挂载运行期配置与数据）：

```bash
make up     # 构建镜像并启动全部生产服务
make down   # 停止并移除容器
```

访问地址：http://localhost:9191

#### 方式二：本地开发

前提：先完成上面的"配置"步骤。

1. **检查依赖环境**：
   ```bash
   make check  # 校验 Node.js 22+、pnpm、uv、nginx
   ```

2. **安装依赖**：
   ```bash
   make install  # 安装 backend + frontend 依赖
   ```

3. **（可选）预拉取 sandbox 镜像**：
   ```bash
   make setup-sandbox
   ```

4. **启动服务**：
   ```bash
   make dev
   ```

5. **访问地址**：http://localhost:9191

#### 方式三：start.sh 一键脚本（本地开发推荐）

`start.sh` 是一个自包含的服务管理脚本，统一管理 Gateway、Frontend、Nginx 三个服务。通过 PID 文件实现进程隔离——只管理自己的进程，不会误伤同机上其他项目。

**常用命令**：

```bash
./start.sh start              # 启动所有服务（开发模式，热重载）
./start.sh start prod         # 生产模式启动（优化构建）
./start.sh stop               # 停止所有服务
./start.sh restart dev        # 重启（开发模式）
./start.sh status             # 查看服务运行状态
./start.sh logs               # 查看所有服务日志
./start.sh logs gateway       # 仅查看 Gateway 日志
```

**服务端口**（可通过 `.env` 自定义）：

| 服务     | 默认端口 | 环境变量          |
|----------|---------|-------------------|
| Nginx    | 9191    | `LANGGRAPH_PORT`  |
| Frontend | 9192    | `FRONTEND_PORT`   |
| Gateway  | 9193    | `GATEWAY_PORT`    |

**核心特性**：
- **进程隔离**：每个服务有独立的 PID 文件（`.pids/`），`stop` 只精确终止自己的进程，不会影响同机其他项目。
- **端口感知管理**：自动检测并清理残留的端口占用。
- **健康检查**：启动时等待每个服务端口就绪后才启动下一个。
- **彩色状态输出**：`./start.sh status` 用绿/黄/红三色显示状态、PID 和日志路径。
- **环境变量配置**：所有端口和路径都可通过 `.env` 自定义。

**跳过依赖同步**（已安装依赖时更快启动）：

```bash
SKIP_INSTALL=true ./start.sh start
```

### 进阶配置

#### Sandbox 模式

KKOCLAW 支持多种 sandbox 执行方式：
- **本地执行**（直接在宿主机上运行 sandbox 代码）
- **Docker 执行**（在隔离的 Docker 容器里运行 sandbox 代码）
- **Docker + Kubernetes 执行**（通过 provisioner 服务在 Kubernetes Pod 中运行 sandbox 代码）

#### MCP Server

KKOCLAW 支持可配置的 MCP Server 和 skills，用来扩展能力。对于 HTTP/SSE MCP Server，还支持 OAuth token 流程。

#### IM 渠道

KKOCLAW 支持从即时通讯应用接收任务。只要配置完成，对应渠道会自动启动，而且都不需要公网 IP。

| 渠道 | 传输方式 | 上手难度 |
|---------|-----------|------------|
| Telegram | Bot API（long-polling） | 简单 |
| Slack | Socket Mode | 中等 |
| Feishu / Lark | WebSocket | 中等 |
| 企业微信 | WebSocket | 中等 |
| 钉钉 | Stream Push（WebSocket） | 中等 |

**`config.yaml` 中的配置示例：**

```yaml
channels:
  langgraph_url: http://localhost:9193/api
  gateway_url: http://localhost:9193

  feishu:
    enabled: true
    app_id: $FEISHU_APP_ID
    app_secret: $FEISHU_APP_SECRET

  wecom:
    enabled: true
    bot_id: $WECOM_BOT_ID
    bot_secret: $WECOM_BOT_SECRET

  slack:
    enabled: true
    bot_token: $SLACK_BOT_TOKEN
    app_token: $SLACK_APP_TOKEN

  telegram:
    enabled: true
    bot_token: $TELEGRAM_BOT_TOKEN

  dingtalk:
    enabled: true
    client_id: $DINGTALK_CLIENT_ID
    client_secret: $DINGTALK_CLIENT_SECRET
```

**命令**

| 命令 | 说明 |
|---------|-------------|
| `/new` | 开启新对话 |
| `/status` | 查看当前 thread 信息 |
| `/models` | 列出可用模型 |
| `/memory` | 查看 memory |
| `/help` | 查看帮助 |

#### LangSmith 链路追踪

在 `.env` 文件中添加以下配置：

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=xxx
```

## 核心特性

### Skills 与 Tools

Skills 是 KKOCLAW 能做"几乎任何事"的关键。

标准的 Agent Skill 是一种结构化能力模块，通常就是一个 Markdown 文件，里面定义了工作流、最佳实践，以及相关的参考资源。KKOCLAW 自带一批内置 skills，覆盖研究、报告生成、演示文稿制作、网页生成、图像和视频生成等场景。真正有意思的地方在于它的扩展性：你可以加自己的 skills，替换内置 skills，或者把多个 skills 组合成复合工作流。

Skills 采用按需渐进加载，不会一次性把所有内容都塞进上下文。只有任务确实需要时才加载。

Tools 也是同样的思路。KKOCLAW 自带一组核心工具：网页搜索、网页抓取、文件操作、bash 执行；同时也支持通过 MCP Server 和 Python 函数扩展自定义工具。

```text
# sandbox 容器内的路径
/mnt/skills/public
├── research/SKILL.md
├── report-generation/SKILL.md
├── slide-creation/SKILL.md
├── web-page/SKILL.md
└── image-generation/SKILL.md

/mnt/skills/custom
└── your-custom-skill/SKILL.md      ← 你的 skill
```

### Sub-Agents

复杂任务通常不可能一次完成，KKOCLAW 会先拆解，再执行。

lead agent 可以按需动态拉起 sub-agents。每个 sub-agent 都有自己独立的上下文、工具和终止条件。只要条件允许，它们就会并行运行，返回结构化结果，最后再由 lead agent 汇总成一份完整输出。

这也是 KKOCLAW 能处理从几分钟到几小时任务的原因。比如一个研究任务，可以拆成十几个 sub-agents，分别探索不同方向，最后合并成一份报告，或者一个网站，或者一套带生成视觉内容的演示文稿。

### Sandbox 与文件系统

KKOCLAW 不只是"会说它能做"，它是真的有一台自己的"电脑"。

每个任务都运行在隔离的 Docker 容器里，里面有完整的文件系统，包括 skills、workspace、uploads、outputs。agent 可以读写和编辑文件，可以执行 bash 命令和代码，也可以查看图片。整个过程都在 sandbox 内完成，可审计、会隔离。

```text
# sandbox 容器内的路径
/mnt/user-data/
├── uploads/          ← 你的文件
├── workspace/        ← agents 的工作目录
└── outputs/          ← 最终交付物
```

### Context Engineering

**隔离的 Sub-Agent Context**：每个 sub-agent 都在自己独立的上下文里运行。它看不到主 agent 的上下文，也看不到其他 sub-agents 的上下文。

**摘要压缩**：在单个 session 内，KKOCLAW 会比较积极地管理上下文，包括总结已完成的子任务、把中间结果转存到文件系统、压缩暂时不重要的信息。

### 长期记忆

大多数 agents 会在对话结束后把一切都忘掉，KKOCLAW 不一样。

跨 session 使用时，KKOCLAW 会逐步积累关于你的持久 memory，包括你的个人偏好、知识背景，以及长期沉淀下来的工作习惯。你用得越多，它越了解你的写作风格、技术栈和重复出现的工作流。memory 保存在本地，控制权也始终在你手里。

## 推荐模型

KKOCLAW 对模型没有强绑定，只要实现了 OpenAI 兼容 API 的 LLM，理论上都可以接入。不过在下面这些能力上表现更强的模型，通常会更适合 KKOCLAW：

- **长上下文窗口**（100k+ tokens），适合深度研究和多步骤任务
- **推理能力**，适合自适应规划和复杂拆解
- **多模态输入**，适合理解图片和视频
- **稳定的 tool use 能力**，适合可靠的函数调用和结构化输出

## 内嵌 Python Client

KKOCLAW 也可以作为内嵌的 Python 库使用，不必启动完整的 HTTP 服务：

```python
from kkoclaw.client import KKOCLAWClient

client = KKOCLAWClient()

# Chat
response = client.chat("分析这篇论文", thread_id="my-thread")

# Streaming（LangGraph SSE 协议）
for event in client.stream("你好"):
    if event.type == "messages-tuple" and event.data.get("type") == "ai":
        print(event.data["content"])

# 配置与管理
models = client.list_models()
skills = client.list_skills()
client.update_skill("web-search", enabled=True)
client.upload_files("thread-1", ["./report.pdf"])
```

## 文档

- [贡献指南](CONTRIBUTING.md) - 开发环境搭建与协作流程
- [项目说明](backend/docs/项目说明.md) - 完整项目文档
- [后端架构](backend/README.md) - 后端架构与 API 参考

## 安全使用

### 不恰当的部署可能导致安全风险

KKOCLAW 具备**系统指令执行、资源操作、业务逻辑调用**等关键高权限能力，默认设计为**部署在本地可信环境（仅本机 127.0.0.1 回环访问）**。若将 agent 部署至不可信局域网、公网云服务器等环境，且未采取严格的安全防护措施，可能导致安全风险。

### 安全使用建议

建议将 KKOCLAW 部署在本地可信的网络环境下。若您有跨设备、跨网络的部署需求，必须加入严格的安全措施：

- **设置访问 IP 白名单**：使用 iptables 或硬件防火墙配置 IP 白名单
- **前置身份验证**：配置反向代理（nginx 等），开启高强度的前置身份验证
- **网络隔离**：将 agent 和可信设备划分到同一个专用 VLAN
- **持续关注项目更新**：持续关注 KKOCLAW 项目的安全功能更新

## 参与贡献

欢迎参与贡献。开发环境、工作流和相关规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源发布。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cover.png">
    <img alt="KKOCLAW — 开源超级智能体平台" src="assets/cover.png" width="100%" />
  </picture>
</p>

---

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
    - [启动服务](#启动服务)
    - [服务管理命令](#服务管理命令)
    - [服务端口](#服务端口)
  - [进阶配置](#进阶配置)
    - [Sandbox 模式](#sandbox-模式)
    - [MCP Server](#mcp-server)
    - [IM 渠道](#im-渠道)
    - [LangSmith 链路追踪](#langsmith-链路追踪)
- [桌面端](#桌面端)
  - [桌面端开发环境搭建](#桌面端开发环境搭建)
  - [桌面端运行命令](#桌面端运行命令)
  - [桌面端特性](#桌面端特性)
  - [桌面端自动更新](#桌面端自动更新)
- [核心特性](#核心特性)
  - [Skills 与 Tools](#skills-与-tools)
  - [Sub-Agents](#sub-agents)
  - [Sandbox 与文件系统](#sandbox-与文件系统)
  - [Context Engineering](#context-engineering)
  - [长期记忆](#长期记忆)
  - [Token 用量统计](#token-用量统计)
- [项目 TODO](#项目-todo)
  - [今日已完成](#今日已完成)
  - [后续待完成](#后续待完成)
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
   git clone https://github.com/kkutysllb/kk_OClaw
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

所有部署模式统一通过 `start.sh` 管理，支持三种运行模式：

| 模式 | 命令 | 说明 |
|------|------|------|
| dev | `./start.sh start` | 本地开发，热重载 |
| prod | `start.sh start prod` | 本地生产，预构建前端 |
| docker | `start.sh start docker` | Docker 生产，容器化部署 |

#### 部署建议与资源规划

| 部署场景 | 起步配置 | 推荐配置 | 说明 |
|---------|-----------|------------|-------|
| 本地开发 / `./start.sh start` | 4 vCPU、8 GB 内存、20 GB SSD | 8 vCPU、16 GB 内存 | 适合单个开发者或单个轻量会话 |
| 本地生产 / `./start.sh start prod` | 4 vCPU、8 GB 内存、20 GB SSD | 8 vCPU、16 GB 内存 | 适合稳定运行 |
| Docker 生产 / `./start.sh start docker` | 8 vCPU、16 GB 内存、40 GB SSD | 16 vCPU、32 GB 内存 | 适合共享环境、多 agent 任务 |

- 上面的配置只覆盖 KKOCLAW 本身；本地大模型需单独预留资源。
- 持续运行的服务推荐 Linux + Docker 模式。

#### 启动服务

**首次使用前**，先完成「配置」步骤，然后安装依赖：

```bash
make check    # 校验 Node.js 22+、pnpm、uv、nginx
make install  # 安装 backend + frontend 依赖
```

**本地开发模式**（默认，支持热重载）：

```bash
./start.sh start
```

**Docker 生产模式**（容器化部署，首次启动会自动构建镜像）：

```bash
./start.sh start docker
```

生产部署如果需要提高 Gateway 并发，可在 `.env` 中设置：

```bash
GATEWAY_WORKERS=2
```

该配置同时适用于本地 `prod` 与 Docker `prod`；开发模式因启用热重载，会忽略该参数并保持单 worker。

访问地址：http://localhost:9191（可通过 `.env` 中的 `NGINX_PORT` 自定义）

> **提示**：Docker 模式需要先安装并启动 Docker。`stop`/`status`/`logs` 命令会自动检测当前运行模式（本地或 Docker），无需手动指定。

#### 服务管理命令

```bash
./start.sh start              # 启动所有服务（开发模式，热重载）
./start.sh start docker       # Docker 生产模式启动
./start.sh start prod         # 本地生产模式启动
./start.sh stop               # 停止所有服务（自动检测模式）
./start.sh restart            # 重启所有服务
./start.sh restart docker     # 重启 Docker 服务
./start.sh status             # 查看服务运行状态（自动检测模式）
./start.sh logs               # 查看所有服务日志
./start.sh logs gateway       # 仅查看 Gateway 日志
./start.sh clean              # 清理缓存文件
./start.sh clean build        # 清理构建产物
./start.sh clean all          # 深度清理
```

跳过依赖同步（已安装依赖时更快启动）：

```bash
SKIP_INSTALL=true ./start.sh start
```

#### 服务端口

所有端口通过 `.env` 文件统一配置：

| 服务     | 默认端口 | 环境变量          |
|----------|---------|-------------------|
| Nginx    | 9191    | `NGINX_PORT`      |
| Frontend | 9192    | `FRONTEND_PORT`   |
| Gateway  | 9193    | `GATEWAY_PORT`    |

本地开发和 Docker 模式共享同一套端口配置，切换部署方式时访问地址不变。

Gateway 生产并发数通过 `.env` 中的 `GATEWAY_WORKERS` 控制，默认 `1`。

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

## 桌面端

KKOCLAW 提供了一个基于 **Tauri 2.0** 的跨平台桌面客户端（macOS / Linux / Windows）。

### 两种使用方式

| 方式 | 适用人群 | 说明 |
|------|---------|------|
| **下载安装包**（推荐） | 普通用户 | 从 [Releases](https://github.com/kkutysllb/kk_OClaw/releases) 下载安装包，开箱即用，无需安装 Python / uv / Node.js 等依赖 |
| **源码编译** | 开发者 | 克隆仓库后在本地编译运行，适用于二次开发和调试 |

**下载安装包**方式下，Python 后端（Gateway + 所有依赖）通过 PyInstaller 打包为独立可执行文件，嵌入安装包中。用户下载安装即可使用，Docker 仅在使用代码沙箱功能时可选安装。

桌面客户端启动时会自动拉起嵌入式后端服务（Gateway），关闭窗口时自动最小化到系统托盘，点击托盘图标即可恢复。

### 桌面端开发环境搭建（源码编译）

> 以下内容仅适用于需要从源码编译的开发者。普通用户请直接下载安装包。

桌面端在原有 Web 端依赖的基础上，还需要 Rust 和 Tauri CLI。

```bash
# 进入 desktop 目录
./setup.sh         # macOS / Linux
setup.bat          # Windows

# 或仅检查前置依赖
./setup.sh --check
```

`setup.sh` 会自动检查并安装以下依赖：

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Rust | stable | Tauri 2.0 编译需要 |
| Tauri CLI | latest | `cargo install tauri-cli` |
| Python | 3.12+ | 后端运行时 |
| uv | latest | Python 包管理 |
| pnpm | latest | 前端包管理 |

> Linux 用户还需要安装 `libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev` 等系统依赖。

### 桌面端运行命令

```bash
cd desktop

# 开发模式（热重载，前端运行在 8659 端口）
pnpm dev

# 构建生产版本
cargo tauri build

# 仅构建前端（Next.js 静态导出）
cd ../frontend
node scripts/desktop-build.mjs
```

开发模式下，桌面端会连接 `http://localhost:8659` 的前端开发服务器，同时自动启动后端 Gateway（端口 9987）。

### 桌面端特性

| 特性 | 说明 |
|------|------|
| 嵌入式后端 | Python 后端通过 PyInstaller 打包嵌入，开箱即用无需外部依赖 |
| 后端自启 | 应用启动时自动拉起嵌入式 Gateway，无需手动 `start.sh` |
| 系统托盘 | 关闭窗口时最小化到托盘，托盘菜单支持查看后端状态、重启后端、退出 |
| 全局快捷键 | `Cmd/Ctrl + Shift + O` 快速显示/隐藏主窗口 |
| 原生文件拖拽 | 支持从系统拖拽文件到聊天窗口直接上传 |
| 中文菜单栏 | macOS 原生菜单栏完全中文化（关于/编辑/视图/窗口/帮助） |
| 自适应图标 | 跟随系统主题的八角形 O-Claw 图标 |

### 桌面端自动更新

桌面客户端内置了基于 **GitHub Releases** 的自动更新功能：

- 应用启动 5 秒后自动检查新版本
- 发现新版本时弹出更新对话框，点击「立即更新」自动下载安装
- 更新包使用 Tauri 签名密钥验证，确保安全性

发布新版本时，维护者只需打一个 Git tag 即可触发 GitHub Actions 自动构建安装包。CI 会先通过 PyInstaller 打包 Python 后端，再编译 Tauri 应用，生成 macOS (ARM/x86)、Linux、Windows 四个平台的安装包并上传到 Release：

```bash
# 更新 tauri.conf.json 中的 version
git tag v0.x.0
git push origin main --tags
```

用户端会自动收到更新推送。

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

### Token 用量统计

KKOCLAW 内置了 Token 用量统计功能，帮你追踪和可视化每次 LLM 调用的 token 消耗。

**启用方式**：在 `config.yaml` 中设置：

```yaml
token_usage:
  enabled: true
```

启用后，KKOCLAW 会在每次模型调用后自动记录 input/output/total tokens，并在设置页面的「Token 用量」标签下展示以下内容：

- **总览卡片**：总 Token 用量、总运行次数、配置模型数
- **按模型分布**：每个模型的 API 调用次数、Token 用量，以及按日期的趋势图表（面积图 + 柱状图）
- **按调用方统计**：区分 Lead Agent、Sub-Agent、Middleware 三类调用方各自的 Token 消耗占比

统计数据按登录用户隔离——每个用户只能看到自己的用量。历史数据中模型名缺失的记录会在启动时自动回填为默认模型名。

## 项目 TODO

此处记录最近完成的工作和近期待办，详细清单见 `docs/TODO.md`。

### 今日已完成

- **配置面板与模型管理重构（2026-06-13）**
  - 新增统一配置面板：`config-settings-page.tsx` 可视化编辑 `config.yaml` 所有顶层配置项，替代手动编辑 YAML
  - 后端新增通用配置 CRUD API：`routers/config.py` 提供 `GET/PUT /api/config`（全量）和 `GET/PUT /api/config/{section}`（分区段）接口，敏感字段（api_key/secret/token）读取时自动脱敏
  - 模型管理整合到配置面板：删除独立的模型管理页面，模型列表 CRUD 统一在配置面板的「模型」标签页内完成
  - 10 个分区表单组件：日志级别、Token 用量、Sandbox、标题生成、摘要压缩、记忆、数据库、运行事件、定时任务、文件上传，均支持独立保存并显示后端返回的具体错误信息
  - YAML 原始编辑器：支持直接编辑 `config.yaml` 原始内容，适合高级用户批量修改
  - **统一「应用并重启」按钮**：配置保存后点击按钮即可重启后端使配置生效，桌面端通过 Tauri IPC `restart_backend` 管理，Web 端通过 `POST /api/config/restart`（detached watcher + `os._exit(0)` 自重启）+ 健康轮询实现
  - **修复表单保存错误提示**：所有表单 catch 块改为显示 `e.message` 而非通用的「保存失败」，方便定位问题
- **相关模块全面增强（2026-05-29）**
  - 用户隔离：`paths.py` + `agents_config.py` 新增 per-user agent 目录，兼容 legacy 共享布局
  - 路由同步：`agents.py`/`threads.py`/`runs.py`/`uploads.py`/`artifacts.py`/`auth.py`/`mcp.py` 全面对齐上游
  - 消息转换：`services.py` 使用 `convert_to_messages` 保留 attachments + `inject_authenticated_user_context` + model 验证
  - 安全增强：ZIP 炸弹防护、Origin 验证防 CSRF、MCP 密钥脱敏重构
  - 启动恢复：`deps.py` 自动恢复 Gateway 重启后的孤立运行
- 修复智谱 GLM-5 模型 1210 错误：创建 `PatchedChatZhipu` 适配器剥离不兼容的 `stream_options` 参数
- 工具循环中断前端提示：`LoopDetectionMiddleware` 触发 hard_stop 时通过 SSE custom 事件通知前端，前端以 toast 展示中断原因和「继续」操作指引
- `PatchedChatDeepSeek` 增加模型名别名映射机制（`_MODEL_NAME_ALIASES`），支持本地部署模型名（如 `deepseek_v4`）自动映射为 API 接受的名称（如 `deepseek-v4-flash`）
- 完成基于 `current_context` 的 TF-IDF 相似度检索与 memory facts 加权排序
- 为 memory retrieval 增加 facts 侧缓存、可查询统计与调试日志
- 增强 `tokenize_text()` 的中文与技术词切分能力
- 增加可配置的 subagent 父模型到子模型路由能力，支持候选模型与回退策略配置
- 支持将 `.kkoclaw/agents` 下的自定义 agent 直接桥接为可由 `task` 调度的 subagent
- subagent recursion_limit 公式可配置化（`recursion_limit_multiplier` × max_turns + `recursion_limit_base`），默认 `3*max_turns+20`
- 支持通过 `GATEWAY_WORKERS` 配置生产部署的 Gateway 并发数，缓解长任务期间的页面 503/504
- 修复 `MemoryMiddleware` 的 `runtime` 注入问题，并补充异步回归测试
- **Token 用量页面图表增强**：X 轴日期刻度智能倾斜+分级间隔避免重叠；API 调用次数图表升级为双纵轴面积图（左轴 API 调用 + 右轴任务完成次数）
- **Token 追踪精度提升**：RunJournal 引入去重机制（`_counted_llm_run_ids` 等），防止 LangChain callback 重复触发导致 token 重复计数；`record_external_llm_usage_records` 替代旧接口，基于 `source_run_id` 按调用粒度去重
- **运行进度持久化**：新增 `update_run_progress` + Progress Reporter 节流机制，长时间运行期间定期保存 token 快照，避免数据丢失
- **RunManager 可靠性增强**：引入 `PersistenceRetryPolicy` 对 SQLite 写入瞬态错误进行有界重试；`reconcile_orphaned_inflight_runs` 在网关重启后自动恢复孤立的 pending/running 记录
- **新增安全中间件**：`SafetyFinishReasonMiddleware` 检测 LLM 返回的 `stop_reason=SAFETY` 并自动终止运行，防止不安全内容泄露
- **新增动态上下文中间件**：`DynamicContextMiddleware` 在运行时根据配置动态注入上下文信息
- **新增工具输出预算中间件**：`ToolOutputBudgetMiddleware` 限制工具返回内容长度，防止超大输出挤占上下文窗口
- **MCP 会话池化**：新增 `session_pool` 模块，stdio MCP 工具按 `(server_name, thread_id)` 复用持久会话，保障有状态服务器（如 Playwright）的连续性
- **Sub-Agent token 收集器**：新增 `token_collector` 模块，集中采集 sub-agent 的 token 使用记录并上报至 RunJournal
- **技能权限系统**：新增 `permissions.py` + `tool_policy.py`，支持 SKILL.md 中声明所需权限，加载时自动校验
- **`RunRepository` SQL 实现完善**：补全 `update_model_name`、`list_inflight`、`update_run_progress` 方法，`put` 改为 upsert 模式（重试安全），`aggregate_tokens_by_thread` 支持 `include_active` 参数
- **Langfuse 追踪集成**：新增 `tracing/metadata.py`，构建 Langfuse trace-attribute metadata 并注入 RunnableConfig

### 后续待完成

- 池化 sandbox 资源以减少 sandbox 容器数量
- 添加认证 / 授权层
- 实现速率限制
- 添加指标和监控
- 支持更多上传文档格式
- 优化 IM 渠道多任务场景下 agent 热路径的异步并发

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

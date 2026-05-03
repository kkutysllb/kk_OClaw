# KKOCLAW

English | [中文](./README_zh.md)

[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](./Makefile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

KKOCLAW is an open-source **super agent harness** that orchestrates **sub-agents**, **memory**, and **sandboxes** to do almost anything — powered by **extensible skills**.

---

## Table of Contents

- [Quick Start](#quick-start)
  - [Configuration](#configuration)
  - [Running the Application](#running-the-application)
    - [Deployment Sizing](#deployment-sizing)
    - [Option 1: Docker (Recommended)](#option-1-docker-recommended)
    - [Option 2: Local Development](#option-2-local-development)
    - [Option 3: start.sh One-Click Script (Recommended for Local Dev)](#option-3-startsh-one-click-script-recommended-for-local-dev)
  - [Advanced](#advanced)
    - [Sandbox Mode](#sandbox-mode)
    - [MCP Server](#mcp-server)
    - [IM Channels](#im-channels)
    - [LangSmith Tracing](#langsmith-tracing)
    - [Langfuse Tracing](#langfuse-tracing)
- [Core Features](#core-features)
  - [Skills & Tools](#skills--tools)
  - [Sub-Agents](#sub-agents)
  - [Sandbox & File System](#sandbox--file-system)
  - [Context Engineering](#context-engineering)
  - [Long-Term Memory](#long-term-memory)
- [Recommended Models](#recommended-models)
- [Embedded Python Client](#embedded-python-client)
- [Documentation](#documentation)
- [Security Notice](#️-security-notice)
- [Contributing](#contributing)
- [License](#license)

## Quick Start

### Configuration

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd kk_OClaw
   ```

2. **Run the setup wizard**

   From the project root directory, run:

   ```bash
   make setup
   ```

   This launches an interactive wizard that guides you through choosing an LLM provider, optional web search, and execution/safety preferences such as sandbox mode, bash access, and file-write tools. It generates a minimal `config.yaml` and writes your keys to `.env`. Takes about 2 minutes.

   Run `make doctor` at any time to verify your setup and get actionable fix hints.

   > **Advanced / manual configuration**: If you prefer to edit `config.yaml` directly, run `make config` instead to copy the full template. See `config.example.yaml` for the complete reference.

   <details>
   <summary>Manual model configuration examples</summary>

   ```yaml
   models:
     - name: gpt-4o
       display_name: GPT-4o
       use: langchain_openai:ChatOpenAI
       model: gpt-4o
       api_key: $OPENAI_API_KEY

     - name: openrouter-gemini-2.5-flash
       display_name: Gemini 2.5 Flash (OpenRouter)
       use: langchain_openai:ChatOpenAI
       model: google/gemini-2.5-flash-preview
       api_key: $OPENROUTER_API_KEY
       base_url: https://openrouter.ai/api/v1

     - name: qwen3-32b-vllm
       display_name: Qwen3 32B (vLLM)
       use: kkoclaw.models.vllm_provider:VllmChatModel
       model: Qwen/Qwen3-32B
       api_key: $VLLM_API_KEY
       base_url: http://localhost:8000/v1
       supports_thinking: true
       when_thinking_enabled:
         extra_body:
           chat_template_kwargs:
             enable_thinking: true
   ```

   API keys can be set in `.env` (recommended) or exported in your shell:

   ```bash
   OPENAI_API_KEY=your-openai-api-key
   TAVILY_API_KEY=your-tavily-api-key
   ```

   </details>

### Running the Application

#### Deployment Sizing

Use the table below as a practical starting point:

| Deployment target | Starting point | Recommended | Notes |
|---------|-----------|------------|-------|
| Local evaluation / `make dev` | 4 vCPU, 8 GB RAM, 20 GB free SSD | 8 vCPU, 16 GB RAM | Good for one developer or one light session with hosted model APIs |
| Docker development / `make docker-start` | 4 vCPU, 8 GB RAM, 25 GB free SSD | 8 vCPU, 16 GB RAM | Image builds, bind mounts, and sandbox containers need more headroom |
| Long-running server / `make up` | 8 vCPU, 16 GB RAM, 40 GB free SSD | 16 vCPU, 32 GB RAM | Preferred for shared use, multi-agent runs, report generation |

- If you also host a local LLM, size that service separately.
- Linux plus Docker is the recommended deployment target for a persistent server.

#### Option 1: Docker (Recommended)

**Development** (hot-reload, source mounts):

```bash
make docker-init    # Pull sandbox image (only once or when image updates)
make docker-start   # Start services
```

**Production** (builds images locally, mounts runtime config and data):

```bash
make up     # Build images and start all production services
make down   # Stop and remove containers
```

Access: http://localhost:9191

#### Option 2: Local Development

Prerequisite: complete the "Configuration" steps above first (`make setup`).

1. **Check prerequisites**:
   ```bash
   make check  # Verifies Node.js 22+, pnpm, uv, nginx
   ```

2. **Install dependencies**:
   ```bash
   make install  # Install backend + frontend dependencies + pre-commit hooks
   ```

3. **(Optional) Pre-pull sandbox image**:
   ```bash
   make setup-sandbox
   ```

4. **Start services**:
   ```bash
   make dev
   ```

5. **Access**: http://localhost:9191

#### Option 3: start.sh One-Click Script (Recommended for Local Dev)

`start.sh` is a self-contained service management script that handles all three services (Gateway, Frontend, Nginx) with PID-file-based process isolation — it only manages its own processes, never affecting other KKOCLAW instances or projects.

**Quick Commands**:

```bash
./start.sh start              # Start all services (dev mode, hot-reload)
./start.sh start prod         # Start in production mode (optimized build)
./start.sh stop               # Stop all services
./start.sh restart dev        # Restart (dev mode)
./start.sh status             # Check service status
./start.sh logs               # View all service logs
./start.sh logs gateway       # View Gateway logs only
```

**Service Ports** (configurable via `.env`):

| Service  | Default Port | Env Variable     |
|----------|-------------|------------------|
| Nginx    | 9191        | `LANGGRAPH_PORT` |
| Frontend | 9192        | `FRONTEND_PORT`  |
| Gateway  | 9193        | `GATEWAY_PORT`   |

**Features**:
- **Process Isolation**: Uses per-service PID files (`.pids/`) — `stop` only kills its own processes, not other projects' services on the same machine.
- **Port-Aware Management**: Automatically detects and cleans up stale port bindings.
- **Health Checks**: Waits for each service port to be ready before starting the next.
- **Color-Coded Status**: `./start.sh status` shows green/yellow/red status with PIDs and log paths.
- **Env Configurable**: All ports, paths, and behavior can be customized via `.env`.

**Skip dependency sync** (faster startup when deps are already installed):

```bash
SKIP_INSTALL=true ./start.sh start
```

### Advanced

#### Sandbox Mode

KKOCLAW supports multiple sandbox execution modes:
- **Local Execution** (runs sandbox code directly on the host machine)
- **Docker Execution** (runs sandbox code in isolated Docker containers)
- **Docker Execution with Kubernetes** (runs sandbox code in Kubernetes pods via provisioner service)

#### MCP Server

KKOCLAW supports configurable MCP servers and skills to extend its capabilities. For HTTP/SSE MCP servers, OAuth token flows are supported (`client_credentials`, `refresh_token`).

#### IM Channels

KKOCLAW supports receiving tasks from messaging apps. Channels auto-start when configured — no public IP required for any of them.

| Channel | Transport | Difficulty |
|---------|-----------|------------|
| Telegram | Bot API (long-polling) | Easy |
| Slack | Socket Mode | Moderate |
| Feishu / Lark | WebSocket | Moderate |
| WeCom | WebSocket | Moderate |
| DingTalk | Stream Push (WebSocket) | Moderate |

**Configuration in `config.yaml`:**

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

**Commands**

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/status` | Show current thread info |
| `/models` | List available models |
| `/memory` | View memory |
| `/help` | Show help |

#### LangSmith Tracing

KKOCLAW has built-in [LangSmith](https://smith.langchain.com) integration for observability.

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=xxx
```

#### Langfuse Tracing

KKOCLAW also supports [Langfuse](https://langfuse.com) observability.

```bash
LANGFUSE_TRACING=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

## Core Features

### Skills & Tools

Skills are what make KKOCLAW do *almost anything*.

A standard Agent Skill is a structured capability module — a Markdown file that defines a workflow, best practices, and references to supporting resources. KKOCLAW ships with built-in skills for research, report generation, slide creation, web pages, image and video generation, and more. But the real power is extensibility: add your own skills, replace the built-in ones, or combine them into compound workflows.

Skills are loaded progressively — only when the task needs them, not all at once. This keeps the context window lean.

Tools follow the same philosophy. KKOCLAW comes with a core toolset — web search, web fetch, file operations, bash execution — and supports custom tools via MCP servers and Python functions.

```
# Paths inside the sandbox container
/mnt/skills/public
├── research/SKILL.md
├── report-generation/SKILL.md
├── slide-creation/SKILL.md
├── web-page/SKILL.md
└── image-generation/SKILL.md

/mnt/skills/custom
└── your-custom-skill/SKILL.md      ← yours
```

### Sub-Agents

Complex tasks rarely fit in a single pass. KKOCLAW decomposes them.

The lead agent can spawn sub-agents on the fly — each with its own scoped context, tools, and termination conditions. Sub-agents run in parallel when possible, report back structured results, and the lead agent synthesizes everything into a coherent output.

### Sandbox & File System

KKOCLAW doesn't just *talk* about doing things. It has its own computer.

Each task gets its own execution environment with a full filesystem view — skills, workspace, uploads, outputs. The agent reads, writes, and edits files. It can view images and, when configured safely, execute shell commands.

```
# Paths inside the sandbox container
/mnt/user-data/
├── uploads/          ← your files
├── workspace/        ← agents' working directory
└── outputs/          ← final deliverables
```

### Context Engineering

**Isolated Sub-Agent Context**: Each sub-agent runs in its own isolated context. This means that the sub-agent will not be able to see the context of the main agent or other sub-agents.

**Summarization**: Within a session, KKOCLAW manages context aggressively — summarizing completed sub-tasks, offloading intermediate results to the filesystem, compressing what's no longer immediately relevant.

### Long-Term Memory

Most agents forget everything the moment a conversation ends. KKOCLAW remembers.

Across sessions, KKOCLAW builds a persistent memory of your profile, preferences, and accumulated knowledge. The more you use it, the better it knows you — your writing style, your technical stack, your recurring workflows. Memory is stored locally and stays under your control.

## Recommended Models

KKOCLAW is model-agnostic — it works with any LLM that implements the OpenAI-compatible API. That said, it performs best with models that support:

- **Long context windows** (100k+ tokens) for deep research and multi-step tasks
- **Reasoning capabilities** for adaptive planning and complex decomposition
- **Multimodal inputs** for image understanding and video comprehension
- **Strong tool-use** for reliable function calling and structured outputs

## Embedded Python Client

KKOCLAW can be used as an embedded Python library without running the full HTTP services:

```python
from kkoclaw.client import KKOCLAWClient

client = KKOCLAWClient()

# Chat
response = client.chat("Analyze this paper for me", thread_id="my-thread")

# Streaming
for event in client.stream("hello"):
    if event.type == "messages-tuple" and event.data.get("type") == "ai":
        print(event.data["content"])

# Configuration & management
models = client.list_models()
skills = client.list_skills()
client.update_skill("web-search", enabled=True)
client.upload_files("thread-1", ["./report.pdf"])
```

## Documentation

- [Contributing Guide](CONTRIBUTING.md) - Development environment setup and workflow
- [Configuration Guide](backend/docs/项目说明.md) - Full project documentation (Chinese)
- [Backend Architecture](backend/README.md) - Backend architecture and API reference

## Security Notice

### Improper Deployment May Introduce Security Risks

KKOCLAW has key high-privilege capabilities including **system command execution, resource operations, and business logic invocation**, and is designed by default to be **deployed in a local trusted environment (accessible only via the 127.0.0.1 loopback interface)**. If you deploy the agent in untrusted environments without strict security measures, it may introduce security risks.

### Security Recommendations

We strongly recommend deploying KKOCLAW in a local trusted network environment. If you need cross-device or cross-network deployment, you must implement strict security measures, such as:

- **IP allowlist**: Use `iptables` or hardware firewalls to configure IP allowlist rules
- **Authentication gateway**: Configure a reverse proxy (e.g., nginx) and enable strong pre-authentication
- **Network isolation**: Place the agent and trusted devices in the same dedicated VLAN
- **Stay updated**: Continue to follow KKOCLAW's security feature updates

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, workflow, and guidelines.

## License

This project is open source and available under the [MIT License](./LICENSE).

# 配置指南

本指南说明如何为你的环境配置 KKOCLAW。

## 配置版本管理

`config.example.yaml` 包含一个 `config_version` 字段，用于跟踪 schema 变更。当示例版本高于你的本地 `config.yaml` 时，应用会在启动时发出警告：

```
WARNING - 你的 config.yaml（版本 0）已过时 — 最新版本为 1。
运行 `make config-upgrade` 将新字段合并到你的配置中。
```

- 配置中**缺少 `config_version`** 视为版本 0。
- 运行 `make config-upgrade` 自动合并缺失字段（你的现有值会被保留，会创建 `.bak` 备份）。
- 更改配置 schema 时，请在 `config.example.yaml` 中更新 `config_version`。

## 配置章节

### 模型

配置可供 Agent 使用的 LLM 模型：

```yaml
models:
  - name: gpt-4                    # 内部标识符
    display_name: GPT-4            # 人类可读名称
    use: langchain_openai:ChatOpenAI  # LangChain 类路径
    model: gpt-4                   # API 的模型标识符
    api_key: $OPENAI_API_KEY       # API 密钥（使用环境变量）
    max_tokens: 4096               # 每请求最大 token 数
    temperature: 0.7               # 采样温度
```

**支持的提供商**：
- OpenAI（`langchain_openai:ChatOpenAI`）
- Anthropic（`langchain_anthropic:ChatAnthropic`）
- DeepSeek（`langchain_deepseek:ChatDeepSeek`）
- Claude Code OAuth（`kkoclaw.models.claude_provider:ClaudeChatModel`）
- Codex CLI（`kkoclaw.models.openai_codex_provider:CodexChatModel`）
- 任何兼容 LangChain 的提供商

CLI 支持的提供商示例：

```yaml
models:
  - name: gpt-5.4
    display_name: GPT-5.4 (Codex CLI)
    use: kkoclaw.models.openai_codex_provider:CodexChatModel
    model: gpt-5.4
    supports_thinking: true
    supports_reasoning_effort: true

  - name: claude-sonnet-4.6
    display_name: Claude Sonnet 4.6 (Claude Code OAuth)
    use: kkoclaw.models.claude_provider:ClaudeChatModel
    model: claude-sonnet-4-6
    max_tokens: 4096
    supports_thinking: true
```

**CLI 支持提供商的认证行为**：
- `CodexChatModel` 从 `~/.codex/auth.json` 加载 Codex CLI 认证
- Codex Responses 端点当前拒绝 `max_tokens` 和 `max_output_tokens`，因此 `CodexChatModel` 不暴露请求级 token 上限
- `ClaudeChatModel` 接受 `CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`、`CLAUDE_CODE_CREDENTIALS_PATH` 或明文 `~/.claude/.credentials.json`
- 在 macOS 上，KKOCLAW 不会自动探测 Keychain。需要时使用 `scripts/export_claude_code_oauth.py` 显式导出 Claude Code 认证

要使用 OpenAI 的 `/v1/responses` 端点与 LangChain，继续使用 `langchain_openai:ChatOpenAI` 并设置：

```yaml
models:
  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
```

对于 OpenAI 兼容网关（例如 Novita 或 OpenRouter），继续使用 `langchain_openai:ChatOpenAI` 并设置 `base_url`：

```yaml
models:
  - name: novita-deepseek-v3.2
    display_name: Novita DeepSeek V3.2
    use: langchain_openai:ChatOpenAI
    model: deepseek/deepseek-v3.2
    api_key: $NOVITA_API_KEY
    base_url: https://api.novita.ai/openai
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled

  - name: minimax-m2.5
    display_name: MiniMax M2.5
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax 要求 temperature 在 (0.0, 1.0] 范围内
    supports_vision: true

  - name: minimax-m2.5-highspeed
    display_name: MiniMax M2.5 Highspeed
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5-highspeed
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax 要求 temperature 在 (0.0, 1.0] 范围内
    supports_vision: true
  - name: openrouter-gemini-2.5-flash
    display_name: Gemini 2.5 Flash (OpenRouter)
    use: langchain_openai:ChatOpenAI
    model: google/gemini-2.5-flash-preview
    api_key: $OPENAI_API_KEY
    base_url: https://openrouter.ai/api/v1
```

如果你的 OpenRouter 密钥在不同的环境变量名中，请显式将 `api_key` 指向该变量（例如 `api_key: $OPENROUTER_API_KEY`）。

**思考模型**：
某些模型支持"思考"模式以进行复杂推理：

```yaml
models:
  - name: deepseek-v3
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

**通过 OpenAI 兼容网关使用 Gemini 并启用思考**：

当通过 OpenAI 兼容代理（Vertex AI OpenAI 兼容端点、AI Studio 或第三方网关）路由 Gemini 并启用思考时，API 会在返回的每个工具调用对象上附加一个 `thought_signature`。后续重放这些助手消息的每个请求**必须**在工具调用条目上回显这些签名，否则 API 返回：

```
HTTP 400 INVALID_ARGUMENT: function call `<tool>` in the N. content block is
missing a `thought_signature`.
```

标准的 `langchain_openai:ChatOpenAI` 在序列化消息时会静默丢弃 `thought_signature`。使用 `kkoclaw.models.patched_openai:PatchedChatOpenAI` 代替 — 它会将工具调用签名（来源为 `AIMessage.additional_kwargs["tool_calls"]`）重新注入到每个出站负载中：

```yaml
models:
  - name: gemini-2.5-pro-thinking
    display_name: Gemini 2.5 Pro (Thinking)
    use: kkoclaw.models.patched_openai:PatchedChatOpenAI
    model: google/gemini-2.5-pro-preview   # 你的网关期望的模型名称
    api_key: $GEMINI_API_KEY
    base_url: https://<your-openai-compat-gateway>/v1
    max_tokens: 16384
    supports_thinking: true
    supports_vision: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

对于**未启用**思考的情况下访问 Gemini（例如通过未激活思考的 OpenRouter），使用普通的 `langchain_openai:ChatOpenAI` 并设置 `supports_thinking: false` 即可，无需补丁。

### 工具组

将工具组织到逻辑组中：

```yaml
tool_groups:
  - name: web          # 网页浏览和搜索
  - name: file:read    # 只读文件操作
  - name: file:write   # 写入文件操作
  - name: bash         # Shell 命令执行
```

### 工具

配置可供 Agent 使用的特定工具：

```yaml
tools:
  - name: web_search
    group: web
    use: kkoclaw.community.tavily.tools:web_search_tool
    max_results: 5
    # api_key: $TAVILY_API_KEY  # 可选
```

**内置工具**：
- `web_search` - 搜索网页（DuckDuckGo、Tavily、Exa、InfoQuest、Firecrawl）
- `web_fetch` - 获取网页内容（Jina AI、Exa、InfoQuest、Firecrawl）
- `ls` - 列出目录内容
- `read_file` - 读取文件内容
- `write_file` - 写入文件内容
- `str_replace` - 文件中的字符串替换
- `bash` - 执行 bash 命令

### 沙箱

KKOCLAW 支持多种沙箱执行模式。在 `config.yaml` 中配置首选模式：

**本地执行**（直接在宿主机上运行沙箱代码）：
```yaml
sandbox:
   use: kkoclaw.sandbox.local:LocalSandboxProvider # 本地执行
   allow_host_bash: false # 默认；除非显式重新启用，否则禁用主机 bash
```

**Docker 执行**（在隔离的 Docker 容器中运行沙箱代码）：
```yaml
sandbox:
   use: kkoclaw.community.aio_sandbox:AioSandboxProvider # 基于 Docker 的沙箱
```

**带 Kubernetes 的 Docker 执行**（通过 provisioner 服务在 Kubernetes pod 中运行沙箱代码）：

此模式在**宿主机集群**的隔离 Kubernetes Pod 中运行每个沙箱。需要 Docker Desktop K8s、OrbStack 或类似的本地 K8s 设置。

```yaml
sandbox:
   use: kkoclaw.community.aio_sandbox:AioSandboxProvider
   provisioner_url: http://provisioner:8002
```

使用 Docker 开发（`make docker-start`）时，KKOCLAW 仅在此 provisioner 模式已配置时启动 `provisioner` 服务。在本地或纯 Docker 沙箱模式下，会跳过 `provisioner`。

参见 [Provisioner 设置指南](../../docker/provisioner/README.md) 了解详细配置、前提条件和故障排查。

在本地执行或基于 Docker 的隔离之间选择：

**选项 1：本地沙箱**（默认，设置更简单）：
```yaml
sandbox:
  use: kkoclaw.sandbox.local:LocalSandboxProvider
  allow_host_bash: false
```

`allow_host_bash` 默认为 `false` 是有意为之的。KKOCLAW 的本地沙箱是宿主机端的便利模式，不是安全的 shell 隔离边界。如果你需要 `bash`，建议使用 `AioSandboxProvider`。仅对完全受信任的单用户本地工作流设置 `allow_host_bash: true`。

**选项 2：Docker 沙箱**（隔离，更安全）：
```yaml
sandbox:
  use: kkoclaw.community.aio_sandbox:AioSandboxProvider
  port: 8080
  auto_start: true
  container_prefix: kkoclaw-sandbox

  # 可选：额外挂载
  mounts:
    - host_path: /path/on/host
      container_path: /path/in/container
      read_only: false
```

当你配置 `sandbox.mounts` 时，KKOCLAW 会在 agent 提示词中暴露这些 `container_path` 值，以便 agent 可以直接发现和操作挂载的目录，而不是假定所有内容都必须在 `/mnt/user-data` 下。

对于使用 localhost 的裸机 Docker 沙箱运行，KKOCLAW 默认将沙箱 HTTP 端口绑定到 `127.0.0.1`，使其不会暴露在所有主机接口上。通过 `host.docker.internal` 连接的 Docker-outside-of-Docker 部署保持广泛的传统绑定以实现兼容。如果你的部署需要不同的绑定地址，请显式设置 `KKOCLAW_SANDBOX_BIND_HOST`。

### 技能

配置专门工作流的技能目录：

```yaml
skills:
  # 主机路径（可选，默认：../skills）
  path: /custom/path/to/skills

  # 容器挂载路径（默认：/mnt/skills）
  container_path: /mnt/skills
```

**技能工作原理**：
- 技能存储在 `kk-oclaw/skills/{public,custom}/`
- 每个技能有一个包含元数据的 `SKILL.md` 文件
- 技能会被自动发现和加载
- 通过路径映射在本地和 Docker 沙箱中均可用

**按 Agent 的技能过滤**：
自定义 agent 可以通过在其 `config.yaml`（位于 `workspace/agents/<agent_name>/config.yaml`）中定义 `skills` 字段来限制加载的技能：
- **省略或 `null`**：加载所有全局启用的技能（默认回退）。
- **`[]`（空列表）**：为此特定 agent 禁用所有技能。
- **`["skill-name"]`**：仅加载显式指定的技能。

### 标题生成

自动对话标题生成：

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null  # 使用列表中的第一个模型
```

### GitHub API Token（GitHub Deep Research 技能可选）

默认的 GitHub API 速率限制相当严格。对于频繁的项目研究，我们建议配置一个具有只读权限的个人访问令牌（PAT）。

**配置步骤**：
1. 取消 `.env` 文件中 `GITHUB_TOKEN` 行的注释，并添加你的个人访问令牌
2. 重启 KKOCLAW 服务以应用更改

## 环境变量

KKOCLAW 支持使用 `$` 前缀进行环境变量替换：

```yaml
models:
  - api_key: $OPENAI_API_KEY  # 从环境读取
```

**常用环境变量**：
- `OPENAI_API_KEY` - OpenAI API 密钥
- `ANTHROPIC_API_KEY` - Anthropic API 密钥
- `DEEPSEEK_API_KEY` - DeepSeek API 密钥
- `NOVITA_API_KEY` - Novita API 密钥（OpenAI 兼容端点）
- `TAVILY_API_KEY` - Tavily 搜索 API 密钥
- `KKOCLAW_PROJECT_ROOT` - 相对运行时路径的项目根目录
- `KKOCLAW_CONFIG_PATH` - 自定义配置文件路径
- `KKOCLAW_EXTENSIONS_CONFIG_PATH` - 自定义扩展配置文件路径
- `KKOCLAW_HOME` - 运行时状态目录（默认为项目根目录下的 `.kkoclaw`）
- `KKOCLAW_SKILLS_PATH` - 当省略 `skills.path` 时的技能目录
- `GATEWAY_ENABLE_DOCS` - 设置为 `false` 可禁用 Swagger UI（`/docs`）、ReDoc（`/redoc`）和 OpenAPI schema（`/openapi.json`）端点（默认：`true`）

## 配置位置

配置文件应放置在**项目根目录**（`kk-oclaw/config.yaml`）。当进程可能从其他工作目录启动时设置 `KKOCLAW_PROJECT_ROOT`，或设置 `KKOCLAW_CONFIG_PATH` 指向特定文件。

## 配置优先级

KKOCLAW 按此顺序搜索配置：

1. 代码中通过 `config_path` 参数指定的路径
2. 来自 `KKOCLAW_CONFIG_PATH` 环境变量的路径
3. `KKOCLAW_PROJECT_ROOT` 下的 `config.yaml`，或当 `KKOCLAW_PROJECT_ROOT` 未设置时当前工作目录下的 `config.yaml`
4. 用于单仓库兼容性的旧版 backend/repository-root 位置

## 最佳实践

1. **将 `config.yaml` 放在项目根目录** — 如果运行时从其他地方启动，设置 `KKOCLAW_PROJECT_ROOT`
2. **永不提交 `config.yaml`** — 它已在 `.gitignore` 中
3. **对环境变量使用环境变量** — 不要硬编码 API 密钥
4. **保持 `config.example.yaml` 更新** — 记录所有新选项
5. **在本地测试配置更改** — 然后再部署
6. **在生产环境中使用 Docker 沙箱** — 更好的隔离和安全性

## 故障排查

### "找不到配置文件"
- 确保 `config.yaml` 存在于**项目根**目录（`kk-oclaw/config.yaml`）
- 如果运行时在项目根目录外启动，设置 `KKOCLAW_PROJECT_ROOT`
- 或者，设置 `KKOCLAW_CONFIG_PATH` 环境变量指向自定义位置

### "无效的 API 密钥"
- 验证环境变量是否正确设置
- 检查环境变量引用是否使用了 `$` 前缀

### "技能未加载"
- 检查 `kk-oclaw/skills/` 目录是否存在
- 验证技能是否有有效的 `SKILL.md` 文件
- 如果使用自定义路径，检查 `skills.path` 或 `KKOCLAW_SKILLS_PATH`

### "Docker 沙箱启动失败"
- 确保 Docker 正在运行
- 检查端口 8080（或配置的端口）是否可用
- 验证 Docker 镜像是否可访问

## 示例

参见 `config.example.yaml` 获取所有配置选项的完整示例。

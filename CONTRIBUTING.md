# 贡献指南

感谢你对 KKOCLAW 的关注！本文档将帮助你搭建开发环境并了解开发工作流程。

## 开发环境搭建

我们提供两种开发环境，**推荐使用 Docker** 以获得最一致、最省心的体验。

### 方式一：Docker 开发（推荐）

Docker 提供了一致、隔离的环境，所有依赖都已预配置，无需在本地机器上安装 Node.js、Python 或 nginx。

#### 前置条件

- Docker Desktop 或 Docker Engine
- pnpm（用于缓存优化）

#### 设置步骤

1. **配置应用**：
   ```bash
   # 复制示例配置
   cp config.example.yaml config.yaml

   # 设置你的 API key
   export OPENAI_API_KEY="your-key-here"
   # 或直接编辑 config.yaml
   ```

2. **初始化 Docker 环境**（仅首次）：
   ```bash
   make docker-init
   ```
   该命令将：
   - 构建 Docker 镜像
   - 安装前端依赖（pnpm）
   - 安装后端依赖（uv）
   - 与宿主机共享 pnpm 缓存，加速后续构建

3. **启动开发服务**：
   ```bash
   make docker-start
   ```
   `make docker-start` 会读取 `config.yaml`，仅在 provisioner/Kubernetes sandbox 模式下启动 `provisioner` 服务。

   所有服务均以热重载模式启动：
   - 前端变更自动刷新
   - 后端变更自动触发重启
   - LangGraph 服务支持热重载

4. **访问应用**：
   - 网页界面：http://localhost:9191
   - API 网关：http://localhost:9191/api/*
   - LangGraph：http://localhost:9191/api/langgraph/*

#### Docker 命令

```bash
# 构建自定义 k3s 镜像（预缓存 sandbox 镜像）
make docker-init
# 启动 Docker 服务（模式感知，localhost:9191）
make docker-start
# 停止 Docker 开发服务
make docker-stop
# 查看 Docker 开发日志
make docker-logs
# 查看 Docker 前端日志
make docker-logs-frontend
# 查看 Docker 网关日志
make docker-logs-gateway
```

如果你的网络环境 Docker 构建较慢，可以在运行 `make docker-init` 或 `make docker-start` 之前覆盖默认包注册表：

```bash
export UV_INDEX_URL=https://pypi.org/simple
export NPM_REGISTRY=https://registry.npmjs.org
```

#### 推荐主机资源

以下是开发和审查环境的实际起步参考：

| 场景 | 起步配置 | 推荐配置 | 说明 |
|---------|-----------|------------|-------|
| `make dev` 单机开发 | 4 vCPU、8 GB 内存 | 8 vCPU、16 GB 内存 | 使用托管模型 API 时效果最佳。 |
| `make docker-start` 审查环境 | 4 vCPU、8 GB 内存 | 8 vCPU、16 GB 内存 | Docker 镜像构建和 sandbox 容器需要更多空间。 |
| 共享 Linux 测试服务器 | 8 vCPU、16 GB 内存 | 16 vCPU、32 GB 内存 | 适合较重度的多 agent 运行或多审查者场景。 |

`2 vCPU / 4 GB` 的环境通常无法可靠启动，或在正常 KKOCLAW 负载下变得无响应。

#### Linux：Docker 守护进程权限被拒

如果在 Linux 上 `make docker-init`、`make docker-start` 或 `make docker-stop` 失败，并出现类似以下错误，说明当前用户可能没有访问 Docker 守护进程套接字的权限：

```text
unable to get image 'kkoclaw-dev-langgraph': permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

推荐的修复方法：将当前用户添加到 `docker` 组，使 Docker 命令无需 `sudo` 即可运行。

1. 确认 `docker` 组存在：
   ```bash
   getent group docker
   ```
2. 将当前用户添加到 `docker` 组：
   ```bash
   sudo usermod -aG docker $USER
   ```
3. 应用新的组成员身份。最可靠的方法是完全注销然后重新登录。如果你想刷新当前 shell 会话，可以运行：
   ```bash
   newgrp docker
   ```
4. 验证 Docker 访问：
   ```bash
   docker ps
   ```
5. 重试 KKOCLAW 命令：
   ```bash
   make docker-stop
   make docker-start
   ```

如果执行 `usermod` 后 `docker ps` 仍报告权限错误，请先完全注销再重新登录后重试。

#### Docker 架构

```
宿主机
  ↓
Docker Compose (kkoclaw-dev)
  ├→ nginx（端口 9191）← 反向代理
  ├→ frontend（端口 9192）← 前端，支持热重载
  ├→ gateway（端口 9193）← 网关 API，支持热重载
   └→ provisioner（可选，端口 9194）← 仅在 provisioner/K8s sandbox 模式下启动
```

**Docker 开发的优势**：
- ✅ 跨机器的一致环境
- ✅ 无需在本地安装 Node.js、Python 或 nginx
- ✅ 隔离的依赖和服务
- ✅ 易于清理和重置
- ✅ 所有服务均支持热重载
- ✅ 类似生产的环境

### 方式二：本地开发

如果你更倾向于在宿主机上直接运行服务：

#### 前置条件

检查所有必需工具是否已安装：

```bash
make check
```

必需工具：
- Node.js 22+
- pnpm
- uv（Python 包管理器）
- nginx

#### 设置步骤

1. **配置应用**（与上面 Docker 方式相同）

2. **安装依赖**（同时会设置 pre-commit 钩子）：
   ```bash
   make install
   ```

3. **运行开发服务器**（通过 nginx 启动所有服务）：
   ```bash
   make dev
   ```

4. **访问应用**：
   - 网页界面：http://localhost:9191
   - 所有 API 请求都会自动通过 nginx 代理

#### 手动服务控制

如果你需要单独启动服务：

1. **启动后端服务**：
   ```bash
   # 终端 1：启动网关 API（端口 9193）
   cd backend
   make dev

   # 终端 2：启动前端（端口 9192）
   cd frontend
   pnpm dev
   ```

2. **启动 nginx**：
   ```bash
   make nginx
   # 或直接：nginx -c $(pwd)/docker/nginx/nginx.local.conf -g 'daemon off;'
   ```

3. **访问应用**：
   - 网页界面：http://localhost:9191

#### Nginx 配置

nginx 配置提供以下功能：
- 统一的入口端口 9191
- 将 `/api/langgraph/*` 路由到网关 API（9193）
- 将其他 `/api/*` 端点路由到网关 API（9193）
- 将非 API 请求路由到前端（9192）
- 集中式 CORS 处理
- 对 agent 实时响应提供 SSE/流式支持
- 为长时间运行操作优化超时设置

## 项目结构

```
kkoclaw/
├── config.example.yaml              # 配置模板
├── extensions_config.example.json   # MCP 和 Skills 配置模板
├── Makefile                         # 构建和开发命令
├── scripts/
│   └── docker.sh                   # Docker 管理脚本
├── docker/
│   ├── docker-compose-dev.yaml     # Docker Compose 配置
│   └── nginx/
│       ├── nginx.conf              # Docker 版 Nginx 配置
│       └── nginx.local.conf        # 本地开发版 Nginx 配置
├── backend/                        # 后端应用
│   ├── src/
│   │   ├── gateway/                # 网关 API（端口 9193）
│   │   ├── mcp/                    # Model Context Protocol 集成
│   │   ├── skills/                 # 技能系统
│   │   └── sandbox/                # Sandbox 执行
│   ├── docs/                       # 后端文档
│   └── Makefile                    # 后端命令
├── frontend/                       # 前端应用
│   └── Makefile                    # 前端命令
└── skills/                         # Agent 技能
    ├── public/                     # 公共技能
    └── custom/                     # 自定义技能
```

## 架构

```
浏览器
  ↓
Nginx（端口 9191）← 统一入口
  ├→ 前端（端口 9192）← /（非 API 请求）
  ├→ 网关 API（端口 9193）← /api/models、/api/mcp、/api/skills、/api/threads/*/artifacts
  └→ 网关运行时（端口 9193）← /api/langgraph/*（agent 交互）
```

## 开发工作流程

1. **创建功能分支**：
   ```bash
   git checkout -b feature/你的功能名称
   ```

2. **修改代码**（支持热重载）

3. **格式化与代码检查**（CI 会拒绝未格式化的代码）：
   ```bash
   # 后端
   cd backend
   make format   # ruff check --fix + ruff format

   # 前端
   cd frontend
   pnpm format:write   # Prettier
   ```

4. **充分测试你的修改**

5. **提交修改**：
   ```bash
   git add .
   git commit -m "feat: 描述你的修改"
   ```

6. **推送并创建 Pull Request**：
   ```bash
   git push origin feature/你的功能名称
   ```

## 测试

```bash
# 后端测试
cd backend
make test

# 前端单元测试
cd frontend
make test

# 前端 E2E 测试（需要 Chromium；构建并自动启动 Next.js 生产服务器）
cd frontend
make test-e2e
```

### PR 回归检查

每个 Pull Request 都会触发以下 CI 工作流：

- **后端单元测试** — [.github/workflows/backend-unit-tests.yml](.github/workflows/backend-unit-tests.yml)
- **前端单元测试** — [.github/workflows/frontend-unit-tests.yml](.github/workflows/frontend-unit-tests.yml)
- **前端 E2E 测试** — [.github/workflows/e2e-tests.yml](.github/workflows/e2e-tests.yml)（仅在 `frontend/` 目录变更时触发）

## 代码风格

- **后端（Python）**：我们使用 `ruff` 进行代码检查和格式化。提交前请运行 `make format`。
- **前端（TypeScript）**：我们使用 ESLint 和 Prettier。提交前请运行 `pnpm format:write`。
- CI 会强制检查代码格式 — 未格式化的代码将导致 lint 检查失败。

## 文档

- [配置指南](backend/docs/CONFIGURATION.md) — 设置与配置
- [架构概览](backend/CLAUDE.md) — 技术架构
- [MCP 设置指南](backend/docs/MCP_SERVER.md) — Model Context Protocol 配置

## 需要帮助？

- 查看已有的 [Issues](https://github.com/KKOCLAW/kkoclaw/issues)
- 阅读[文档](backend/docs/)
- 在[讨论区](https://github.com/KKOCLAW/kkoclaw/discussions)提问

## 许可证

向 KKOCLAW 贡献代码，即表示你同意你的贡献将按照 [MIT 许可证](./LICENSE) 进行许可。

# Apple Container 支持

KKOCLAW 现在支持 Apple Container 作为 macOS 上的首选容器运行时，并自动回退到 Docker。

## 概述

从本版本开始，KKOCLAW 在 macOS 上自动检测并使用 Apple Container（可用时），在以下情况回退到 Docker：
- 未安装 Apple Container
- 在非 macOS 平台上运行

这在 Apple Silicon Mac 上提供更好的性能，同时保持跨平台兼容性。

## 优势

### 在配备 Apple Container 的 Apple Silicon Mac 上：
- **更好的性能**：原生 ARM64 执行，无需 Rosetta 2 转译
- **更低的资源使用**：比 Docker Desktop 更轻量
- **原生集成**：使用 macOS Virtualization.framework

### 回退到 Docker：
- 完全向后兼容
- 在所有平台上工作（macOS、Linux、Windows）
- 无需更改配置

## 要求

### 对于 Apple Container（仅 macOS）：
- macOS 15.0 或更高版本
- Apple Silicon（M1/M2/M3/M4）
- 已安装 Apple Container CLI

### 安装：
```bash
# 从 GitHub releases 下载
# https://github.com/apple/container/releases

# 验证安装
container --version

# 启动服务
container system start
```

### 对于 Docker（所有平台）：
- Docker Desktop 或 Docker Engine

## 工作原理

### 自动检测

`AioSandboxProvider` 自动检测可用的容器运行时：

1. 在 macOS 上：尝试 `container --version`
   - 成功 → 使用 Apple Container
   - 失败 → 回退到 Docker

2. 在其他平台上：直接使用 Docker

### 运行时差异

两种运行时使用几乎相同的命令语法：

**容器启动：**
```bash
# Apple Container
container run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image

# Docker
docker run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image
```

**容器清理：**
```bash
# Apple Container（使用 --rm 标志）
container stop <id>  # 由于 --rm 自动移除

# Docker（使用 --rm 标志）
docker stop <id>     # 由于 --rm 自动移除
```

### 实现细节

实现在 `backend/packages/harness/kkoclaw/community/aio_sandbox/aio_sandbox_provider.py` 中：

- `_detect_container_runtime()`：启动时检测可用运行时
- `_start_container()`：使用检测到的运行时，为 Apple Container 跳过 Docker 特定选项
- `_stop_container()`：使用适合运行时的停止命令

## 配置

无需更改配置！系统自动工作。

但是，你可以通过检查日志来验证正在使用的运行时：

```
INFO:kkoclaw.community.aio_sandbox.aio_sandbox_provider:Detected Apple Container: container version 0.1.0
INFO:kkoclaw.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using container: ...
```

或对于 Docker：
```
INFO:kkoclaw.community.aio_sandbox.aio_sandbox_provider:Apple Container not available, falling back to Docker
INFO:kkoclaw.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using docker: ...
```

## 容器镜像

两种运行时都使用 OCI 兼容镜像。默认镜像适用于两者：

```yaml
sandbox:
  use: kkoclaw.community.aio_sandbox:AioSandboxProvider
  image: enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest  # 默认镜像
```

确保你的镜像适用于相应的架构：
- Apple Container 在 Apple Silicon 上使用 ARM64
- Docker 在 Intel Mac 上使用 AMD64
- 多架构镜像两者都适用

### 预拉取镜像（推荐）

**重要**：容器镜像通常很大（500MB+），首次使用时会被拉取，可能会导致长时间等待而缺乏明确的反馈。

**最佳实践**：在设置期间预拉取镜像：

```bash
# 从项目根目录
make setup-sandbox
```

此命令将：
1. 从 `config.yaml` 读取配置的镜像（或使用默认值）
2. 检测可用运行时（Apple Container 或 Docker）
3. 拉取镜像并显示进度
4. 验证镜像已准备好使用

**手动预拉取**：

```bash
# 使用 Apple Container
container image pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest

# 使用 Docker
docker pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest
```

如果跳过预拉取，镜像将在首次 agent 执行时自动拉取，根据你的网络速度可能需要几分钟。

## 清理脚本

项目包含一个统一的清理脚本，可处理两种运行时：

**脚本：** `scripts/cleanup-containers.sh`

**用法：**
```bash
# 清理所有 KKOCLAW 沙箱容器
./scripts/cleanup-containers.sh kkoclaw-sandbox

# 自定义前缀
./scripts/cleanup-containers.sh my-prefix
```

**Makefile 集成：**

`Makefile` 中的所有清理命令自动处理两种运行时：
```bash
make stop   # 停止所有服务并清理容器
make clean  # 完整清理，包括日志
```

## 测试

测试容器运行时检测：

```bash
cd backend
python test_container_runtime.py
```

这将：
1. 检测可用运行时
2. 可选启动测试容器
3. 验证连接性
4. 清理

## 故障排查

### macOS 上未检测到 Apple Container

1. 检查是否已安装：
   ```bash
   which container
   container --version
   ```

2. 检查服务是否正在运行：
   ```bash
   container system start
   ```

3. 检查日志中的检测信息：
   ```bash
   # 在应用程序日志中查找检测消息
   grep "container runtime" logs/*.log
   ```

### 容器未清理

1. 手动检查运行中的容器：
   ```bash
   # Apple Container
   container list

   # Docker
   docker ps
   ```

2. 手动运行清理脚本：
   ```bash
   ./scripts/cleanup-containers.sh kkoclaw-sandbox
   ```

### 性能问题

- Apple Container 在 Apple Silicon 上应更快
- 如果遇到问题，可以通过临时重命名 `container` 命令来强制使用 Docker：
   ```bash
   # 临时解决方法 - 不建议永久使用
   sudo mv /opt/homebrew/bin/container /opt/homebrew/bin/container.bak
   ```

## 参考

- [Apple Container GitHub](https://github.com/apple/container)
- [Apple Container 文档](https://github.com/apple/container/blob/main/docs/)
- [OCI 镜像规范](https://github.com/opencontainers/image-spec)

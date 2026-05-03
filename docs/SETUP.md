# 安装指南

KKOCLAW 快速安装说明。

## 配置设置

KKOCLAW 使用一个 YAML 配置文件，应放置在**项目根目录**中。

### 操作步骤

1. **进入项目根目录**：
   ```bash
   cd /path/to/kk-oclaw
   ```

2. **复制示例配置**：
   ```bash
   cp config.example.yaml config.yaml
   ```

3. **编辑配置**：
   ```bash
   # 方式 A：设置环境变量（推荐）
   export OPENAI_API_KEY="your-key-here"

   # 可选：从其他目录运行时指定项目根目录
   export KKOCLAW_PROJECT_ROOT="/path/to/kk-oclaw"

   # 方式 B：直接编辑 config.yaml
   vim config.yaml  # 或你喜欢的编辑器
   ```

4. **验证配置**：
   ```bash
   cd backend
   python -c "from kkoclaw.config import get_app_config; print('✓ Config loaded:', get_app_config().models[0].name)"
   ```

## 重要说明

- **位置**：`config.yaml` 应放在 `kk-oclaw/`（项目根目录）
- **Git**：`config.yaml` 会被 git 自动忽略（包含密钥）
- **运行时根目录**：如果 KKOCLAW 可能从项目根目录外启动，请设置 `KKOCLAW_PROJECT_ROOT`
- **运行时数据**：状态默认保存在项目根目录下的 `.kkoclaw` 目录中；设置 `KKOCLAW_HOME` 可更改位置
- **技能目录**：技能默认位于项目根目录下的 `skills/` 目录；设置 `KKOCLAW_SKILLS_PATH` 或 `skills.path` 可更改

## 配置文件查找顺序

后端按以下顺序查找 `config.yaml`：

1. 代码中显式传入的 `config_path` 参数
2. `KKOCLAW_CONFIG_PATH` 环境变量（如果设置了）
3. `KKOCLAW_PROJECT_ROOT` 下的 `config.yaml`，或在 `KKOCLAW_PROJECT_ROOT` 未设置时查找当前工作目录
4. 为单体仓库兼容性保留的后端/仓库根目录旧位置

**推荐**：将 `config.yaml` 放在项目根目录（`kk-oclaw/config.yaml`）

## Sandbox 设置（可选但推荐）

如果你计划使用 Docker/容器 sandbox（在 `config.yaml` 中配置 `sandbox.use: kkoclaw.community.aio_sandbox:AioSandboxProvider`），强烈建议提前拉取容器镜像：

```bash
# 从项目根目录执行
make setup-sandbox
```

**为什么要提前拉取？**
- Sandbox 镜像（~500MB+）会在首次使用时拉取，导致长时间等待
- 提前拉取可以显示清晰的进度指示
- 避免首次使用 agent 时的困惑

如果跳过此步骤，镜像将在首次 agent 执行时自动拉取，根据你的网络速度可能需要几分钟。

## 故障排查

### 找不到配置文件

```bash
# 检查后端在哪里查找
cd kk-oclaw/backend
python -c "from kkoclaw.config.app_config import AppConfig; print(AppConfig.resolve_config_path())"
```

如果找不到配置：
1. 确保已将 `config.example.yaml` 复制为 `config.yaml`
2. 确认你位于项目根目录，或已设置 `KKOCLAW_PROJECT_ROOT`
3. 检查文件是否存在：`ls -la config.yaml`

### 权限拒绝

```bash
chmod 600 ../config.yaml  # 保护敏感配置
```

## 相关文档

- [配置指南](CONFIGURATION.md) - 详细配置选项
- [架构概述](../CLAUDE.md) - 系统架构

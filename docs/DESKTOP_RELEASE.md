# OClaw 桌面端发布流程

本文档说明如何把 OClaw 桌面端（`desktop-electron/`）通过 GitHub Actions 自动构建、签名、公证并发布到 GitHub Release，配合 `electron-updater` 实现客户端自动更新。

## 整体流程

```text
维护者打 tag     GitHub Actions      electron-builder      Apple 公证服务
    │                  │                      │                    │
    │ git tag v0.x.0   │                      │                    │
    ├─────────────────▶│  1. 拉代码           │                    │
    │   git push --tags│  2. pnpm install     │                    │
    │                  │  3. uv 装 Python 3.12│                    │
    │                  │  4. PyInstaller 打包 │                    │
    │                  │     oclaw-gateway    │                    │
    │                  │  5. tsc 编译主进程   │                    │
    │                  │  6. electron-builder │──sign──▶           │
    │                  │                      │   .app + .dmg     │
    │                  │                      │──notarize──▶──────▶│
    │                  │                      │   公证 + Staple   │
    │                  │                      │◀───ticket─────────┤
    │                  │  7. --publish always │                    │
    │                  │     上传到 GitHub    │                    │
    │                  │     Release + 写     │                    │
    │                  │     latest-*.yml     │                    │
    │                  ▼                      │                    │
    │       GitHub Release (draft)            │                    │
    │       含 dmg/zip/exe/deb/rpm             │                    │
    │       + *.blockmap                       │                    │
    │       + latest-mac.yml                   │                    │
    │       + latest-linux.yml                 │                    │
    │       + latest.yml                       │                    │
    │                                          │                    │
    │  维护者点 "Publish release"              │                    │
    │                                          │                    │
    │       终端用户                            │                    │
    │          │                               │                    │
    │          │ 启动桌面端                     │                    │
    │          ▼                               │                    │
    │  electron-updater 读 latest-*.yml        │                    │
    │  发现新版本 → 弹更新对话框                │                    │
    │  用户点 "立即更新" → 后台下载 .dmg/.exe   │                    │
    │  blockmap 校验完整性 → 重启安装           │                    │
```

## 必填的 GitHub Secrets

打开仓库 `Settings → Secrets and variables → Actions → New repository secret`，依次添加：

| Secret 名 | 取值 | 说明 | 必填 |
|----------|------|------|:----:|
| `MACOS_CERT_P12_BASE64` | Developer ID Application `.p12` 文件的 base64 编码 | macOS 代码签名证书 | ✅ |
| `MACOS_CERT_PASSWORD` | `.p12` 文件的导出密码 | 证书私钥保护密码 | ✅ |
| `APPLE_ID` | Apple ID 邮箱（例如 `13609247807@139.com`） | Apple 开发者账号 | ✅ |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码（例如 `xndw-omoo-ltap-tqgd`） | 用于 `notarytool` 提交公证 | ✅ |
| `APPLE_TEAM_ID` | 10 位 Apple Developer Team ID（例如 `DHV5D72JNF`） | 标识开发者团队 | ✅ |
| `WINDOWS_CERT_PFX_BASE64` | Windows 代码签名 `.pfx`/`p12` 的 base64 编码 | Windows 代码签名 | ❌ |
| `WINDOWS_CERT_PASSWORD` | `.pfx` 文件的导出密码 | Windows 证书私钥保护密码 | ❌ |

> 标记 ✅ 的是发布 macOS 安装包必须的；标记 ❌ 的只在需要 Windows 签名时才填，不填也能正常出包，但用户会看到 SmartScreen 警告。

## 怎么准备 macOS 签名证书

### 1. 在 Apple Developer 后台申请证书

1. 打开 <https://developer.apple.com/account/resources/certificates/list>
2. 点 `+` 新建证书，选 **Developer ID Application**（不是 Development、不是 Distribution）
3. 按提示在本地 Keychain Access 生成 CSR（Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority）
4. 上传 CSR，下载生成的 `.cer`
5. 双击 `.cer` 安装到 Keychain Access

### 2. 导出 `.p12` 文件

```bash
# 打开 Keychain Access → 登录 → 我的证书
# 找到 "Developer ID Application: <Your Name> (<TeamID>)"
# 右键 → 导出 "Developer ID Application: ..." → 保存为 .p12
# 设置一个强密码（这就是 MACOS_CERT_PASSWORD 的值）
```

### 3. base64 编码并上传到 GitHub

```bash
# 在本地终端
base64 -i /path/to/DeveloperID.p12 | pbcopy

# 然后到 GitHub repo → Settings → Secrets → New repository secret
# Name: MACOS_CERT_P12_BASE64
# Value: 粘贴刚才复制的 base64 字符串
```

### 4. 生成 App 专用密码

1. 打开 <https://appleid.apple.com/account/manage>
2. 登录（用你的 Apple ID，例如 `13609247807@139.com`）
3. `App-Specific Passwords` → `+` 生成一个新密码
4. 标签随便填（例如 `GitHub Actions Notarization`）
5. 把生成的密码（形如 `xxxx-xxxx-xxxx-xxxx`）复制出来
6. 在 GitHub Secrets 添加：
   - `APPLE_ID` = `13609247807@139.com`
   - `APPLE_APP_SPECIFIC_PASSWORD` = `xxxx-xxxx-xxxx-xxxx`
   - `APPLE_TEAM_ID` = `DHV5D72JNF`

## 怎么触发一次发布

1. **修改 `desktop-electron/package.json` 里的 `version`**（不要带 `v` 前缀）：

   ```json
   {
     "name": "kkoclaw-desktop",
     "version": "0.1.1"
   }
   ```

2. **提交并打 tag**：

   ```bash
   git add desktop-electron/package.json
   git commit -m "chore(desktop): bump version to 0.1.1"
   git tag v0.1.1
   git push origin main --tags
   ```

3. **GitHub Actions 自动开始**：进入仓库的 `Actions` 标签页能看到 `Release Desktop App` workflow 启动。4 个 matrix job 并行跑：
   - `macOS (arm64)` — 签名 + 公证 + 出 `.dmg` + `.zip`
   - `macOS (x64)` — 签名 + 公证 + 出 `.dmg` + `.zip`
   - `Linux (deb + rpm)` — 出 `.deb` + `.rpm`
   - `Windows (NSIS)` — 出 `.exe` + 块映射

4. **Release 自动建好但为 draft**：每个 job 用 `electron-builder --publish always` 把自己的产物直接推到 GitHub Release，所有 job 都跑完后，Release 页面会看到所有平台的安装包 + `latest-mac.yml` / `latest-linux.yml` / `latest.yml`。

5. **人工 review 并发布**：
   - 打开 GitHub Release 页面，确认每个平台都有产物
   - 可以下载 `.dmg` 抽测一下（特别注意「打开方式 → 任何来源」是否需要，因为已经公证 + staple，Gatekeeper 直接放行）
   - 点 **Publish release**

## electron-updater 自动更新怎么工作

桌面端代码（`desktop-electron/src/updater.ts` + 前端 `update-checker.tsx`）已经在 `app.whenReady()` 后 5 秒发起一次 `autoUpdater.checkForUpdates()`：

- `autoUpdater` 读 `package.json` 里的 `publish` 段（已经指向 `kkutysllb/kk_OClaw` 这个 GitHub repo）
- 拉取最新 release 对应的 `latest-*.yml`（例如 `latest-mac.yml`）
- 如果 `yml` 里的 `version` 大于当前 app 的 `version`：
  - 弹一个原生对话框
  - 用户点「立即更新」→ 后台下载 dmg/zip/exe
  - 用 `*.blockmap` 做差分下载 + SHA512 校验
  - 下载完成后退出当前进程、启动安装器
- 公证过的 macOS 安装包会跳过 Gatekeeper；未签名的会弹「未知开发者」警告

> 用户端不需要任何额外配置。只要发布出去的 Release 是公开的（不是 draft），所有已安装的桌面端都会在 5 秒后看到更新提示。

## 本地验证

在 push tag 之前，可以在本地先跑一遍构建做烟雾测试：

```bash
cd desktop-electron

# 仅做 TS 编译（最快）
pnpm run build

# 完整构建（PyInstaller + 前端 + electron-builder）
pnpm run build:app
```

如果要本地签名 + 公证，把 GitHub Secrets 里那几个值临时 export 到环境变量再跑：

```bash
export CSC_LINK="$(cat ~/DeveloperID.p12 | base64)"
export CSC_KEY_PASSWORD="…"
export APPLE_ID="13609247807@139.com"
export APPLE_APP_SPECIFIC_PASSWORD="xndw-omoo-ltap-tqgd"
export APPLE_TEAM_ID="DHV5D72JNF"
pnpm exec electron-builder --mac --arm64 --publish never
```

## 常见问题

### macOS 公证失败：``The signature is invalid` 或 `The binary is not signed`

- 检查 `MACOS_CERT_P12_BASE64` 是否完整（注意 GitHub Secret 多行粘贴时可能截断）。可以用 `echo "$MACOS_CERT_P12_BASE64" | base64 -d | head -c 4` 验证前 4 字节是不是 `0x30 0x82`（PKCS#12 文件头）。
- 确认证书类型是 **Developer ID Application**，不是 Apple Development 或 Mac App Store。
- 确认 `CSC_KEY_PASSWORD` 是 `.p12` 的导出密码，不是 Apple ID 密码。

### macOS 公证失败：``Unable to authenticate with Apple` 或 HTTP 401/403`

- `APPLE_APP_SPECIFIC_PASSWORD` 必须是 App 专用密码（`xxxx-xxxx-xxxx-xxxx`），不是 Apple ID 登录密码。
- 重新生成一次 App 专用密码试试。
- 确认 `APPLE_TEAM_ID` 是 10 位大写字母数字，例如 `DHV5D72JNF`（在 Apple Developer 后台右上角 `Membership` 页面能看到）。

### electron-builder 上传 403 / 404

- 确认 `GITHUB_TOKEN` 有 `contents: write` 权限（workflow 里已经声明 `permissions: contents: write`）。
- 确认 `electron-builder.yml` 里的 `publish.owner` / `publish.repo` 跟实际仓库一致。

### Linux 任务 `libfuse` / `libnss3` 报错

- electron-builder 在 Linux 平台运行需要图形栈，但 `ubuntu-22.04` 自带的 `actions/runner-images` 镜像已经预装了。极少数情况下需要补包：

  ```yaml
  - name: Install Linux build deps
    if: matrix.os == 'ubuntu-22.04'
    run: |
      sudo apt-get update
      sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \
        libgtk-3-0 libgbm1 libasound2
  ```

### Windows SmartScreen 警告

- 没有 Windows 代码签名证书时，Windows 会在用户双击 `.exe` 时弹「Windows protected your PC」。
- 用户需要点 `More info` → `Run anyway`。
- 解决方案：申请 EV 代码签名证书（约 $300-700/年），把 `.pfx` 编码后填到 `WINDOWS_CERT_PFX_BASE64` / `WINDOWS_CERT_PASSWORD`。

## 工具链版本一览

| 组件 | 版本 |
|------|------|
| Node.js | 22+ |
| pnpm | 10+ |
| Python | 3.12（固定） |
| uv | latest |
| Electron | 33.x |
| electron-builder | 25.x |
| PyInstaller | 6.x |
| macOS Runner | macos-14（arm64）、macos-13（x64） |
| Linux Runner | ubuntu-22.04 |
| Windows Runner | windows-latest |

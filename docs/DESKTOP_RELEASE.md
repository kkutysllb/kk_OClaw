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

**也可以用 `openssl` 在终端生成 CSR（更可控）**：

```bash
# 生成 RSA-2048 私钥 + CSR（Common Name 必须用 Apple Developer 注册的名字）
openssl req -new -newkey rsa:2048 -nodes \
  -keyout DeveloperID.key \
  -out DeveloperID.csr \
  -subj "/emailAddress=you@example.com,CN=Developer ID Application: Your Name,O=Your Company"
```

> CSR 文件给 Apple 之后 Apple 会返回 `.cer`，**私钥 `.key` 文件要保留好**——下一步导出 `.p12` 时会用到。

### 1.5 验证 Keychain 里的代码签名证书

```bash
# 列出所有可用的代码签名身份
security find-identity -p codesigning -v

# 期望看到类似：
#   1) ABC123... "Developer ID Application: Your Name (DHV5D72JNF)"
#   2) XYZ789... "Apple Development: your@email.com (XXXXXXXXXX)"

# 查看具体证书的详细信息
security find-certificate -c "Developer ID Application" -p | openssl x509 -text -noout | head -30
# 重点检查：
#   Subject: CN=Developer ID Application: Your Name, O=Your Company, ...
#   Issuer:  CN=Developer ID Certification Authority, ...
#   Validity: Not Before / Not After  证书有效期（默认 5 年）

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

## 发布前自检

在 `git tag && git push --tags` 之前先在本地跑一遍下面 6 步自检，可以避免 80% 的发布踩坑：

```bash
# 1. package.json version 已更新、且和上一次 tag 不冲突
grep '"version"' desktop-electron/package.json
# 例： "version": "0.1.0",
git tag -l 'v*' | grep "^v$(grep '"version"' desktop-electron/package.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')$" \
  && echo "⚠ 这个版本已经打过 tag 了，别重复发" || echo "✓ version 未冲突"

# 2. macOS 代码签名证书已经在 Keychain 里
security find-identity -p codesigning -v
# 期望看到 "Developer ID Application: ... (DHV5D72JNF)"

# 3. Apple Developer 凭据本地能正确读取（模拟 GitHub Secrets 环境）
export MACOS_CERT_P12_BASE64="$(base64 -i ~/DeveloperID.p12 | tr -d '\n')"
export MACOS_CERT_PASSWORD="你的 p12 密码"
export APPLE_ID="13609247807@139.com"
export APPLE_APP_SPECIFIC_PASSWORD="xndw-omoo-ltap-tqgd"
export APPLE_TEAM_ID="DHV5D72JNF"
echo "APPLE_ID: $APPLE_ID"; echo "TEAM_ID:  $APPLE_TEAM_ID"
echo "PWD 前 4 字符: ${APPLE_APP_SPECIFIC_PASSWORD:0:4}"

# 4. .p12 base64 解码能拿到完整文件（魔数 0x30 0x82 = PKCS#12）
echo "$MACOS_CERT_P12_BASE64" | base64 -d | head -c 4 | xxd
# 期望输出：00000000: 3082 .... （如果是 0000 说明 secret 被截断或粘贴丢了换行）

# 5. .p12 私钥能解开（确认 password 正确）
echo "$MACOS_CERT_P12_BASE64" | base64 -d | \
  openssl pkcs12 -info -nokeys -passin "pass:$MACOS_CERT_PASSWORD" 2>&1 | head -10
# 期望看到 "subject=CN = Developer ID Application: ..."，且 "MAC verified OK"

# 6. 干净构建（不发布，只验证链路通）
rm -rf desktop-electron/release desktop-electron/dist
rm -rf desktop-electron/resources/gateway/*
pnpm --dir desktop-electron run build:app
# 期望 release/ 目录里有 .dmg/.zip/.deb/.rpm/.exe 等产物
```

6 步全部 ✓ 才建议 push tag。任何一步 ✗ 先修，不要带着问题发。

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

3. **GitHub Actions 自动开始**：进入仓库的 `Actions` 标签页能看到 `Release Desktop App` workflow 启动。3 个 matrix job 并行跑：
   - `macOS (arm64)` — 签名 + 公证 + 出 `.dmg` + `.zip`
   - `Linux (deb + rpm)` — 出 `.deb` + `.rpm`
   - `Windows (NSIS)` — 出 `.exe` + 块映射

   > macOS x86_64 故意不出。Apple Silicon 自 2021 年起就是 Mac 默认架构，Rosetta 2 覆盖老设备，省一个 macos-13 job 可以节省 ~30 min CI 时间 + 一次额外公证轮询。如果有 Intel Mac 用户报需要，请联系我们重新加上。

4. **Release 自动建好但为 draft**：每个 job 用 `electron-builder --publish always` 把自己的产物直接推到 GitHub Release，所有 job 都跑完后，Release 页面会看到所有平台的安装包 + `latest-mac.yml` / `latest-linux.yml` / `latest.yml`。

5. **人工 review 并发布**：
   - 打开 GitHub Release 页面，确认每个平台都有产物
   - 可以下载 `.dmg` 抽测一下（特别注意「打开方式 → 任何来源」是否需要，因为已经公证 + staple，Gatekeeper 直接放行）
   - 点 **Publish release**

## 发布后验证

Release 创建为 draft 后，**不要**直接点 Publish，先做以下 5 步检查。全部通过再公开：

### 1. 看 GitHub Actions 4 个 matrix job 是否都成功

```bash
# 看最近 1 次 Release Desktop App workflow run
gh run list --workflow="Release Desktop App" --limit 1
# 期望：4 个 job 都为 "completed" / "success"
# 状态含义：
#   queued     — 排队中
#   in_progress — 跑中
#   completed  — 结束
#   success / failure / cancelled

# 看某个 job 的完整日志（排查公证失败等）
gh run view <run-id> --log | tail -200
```

或者浏览器打开 <https://github.com/kkutysllb/kk_OClaw/actions>，进 `Release Desktop App` → 选最新 run → 展开 `Build macOS (arm64)` 看 `Build Electron app` 步骤的输出。

### 2. 下载 .dmg 验证签名、公证、staple

```bash
# 下载 draft release 的 macOS 安装包（只下载 arm64，x64 不出）
gh release download v0.1.0 \
  --pattern 'OClaw-*-arm64.dmg' \
  --dir /tmp/verify
ls -la /tmp/verify

# (a) 验证代码签名
codesign -dv --verbose=4 /tmp/verify/OClaw-0.1.0-arm64.dmg 2>&1 | head -20
# 期望看到：
#   Authority=Developer ID Application: Your Name (DHV5D72JNF)
#   Timestamp=...

# 严格验证（任何篡改都会报错）
codesign --verify --deep --strict --verbose=2 /tmp/verify/OClaw-0.1.0-arm64.dmg
# 期望输出 "valid on disk" + "satisfies its Designated Requirement"

# (b) 验证 Gatekeeper 评估（macOS 本机运行）
spctl --assess --verbose --type install /tmp/verify/OClaw-0.1.0-arm64.dmg
# 期望输出 "accepted"（如果看到 "rejected" 则是签名或公证失败）

# (c) 验证公证票据已 staple
xcrun stapler validate /tmp/verify/OClaw-0.1.0-arm64.dmg
# 期望输出 "The validate action worked!"
# 如果输出 "The validate action failed!" 则是公证成功但未 staple（用户在线也能跳过 Gatekeeper，离线不行）
```

### 3. 验证 electron-updater manifest

```bash
# 拉取所有平台的 latest-*.yml，看字段是否齐全
for plat in mac linux win; do
  echo "=== latest-${plat}.yml ==="
  curl -sL "https://github.com/kkutysllb/kk_OClaw/releases/download/v0.1.0/latest-${plat}.yml" \
    || echo "(not found)"
done

# 期望看到（例 latest-mac.yml，x64 不出所以只剩 arm64）：
# version: 0.1.0
# files:
#   - url: OClaw-0.1.0-arm64.dmg
#     sha512: <base64>
#     size: <bytes>
# path: OClaw-0.1.0-arm64.dmg
# sha512: <base64>
# releaseDate: 2026-06-16T...
```

### 4. 抽样双击 .dmg 安装

```bash
# 挂载 .dmg（如果 macOS 不让开 Gatekeeper，可强制开任何来源）
hdiutil attach /tmp/verify/OClaw-0.1.0-arm64.dmg -mountpoint /tmp/oclaw-mount
ls -la "/tmp/oclaw-mount/OClaw.app/Contents/MacOS/"
# 期望看到 "OClaw" 可执行文件
hdiutil detach /tmp/oclaw-mount

# 手动启动验证
open /tmp/verify/OClaw-0.1.0-arm64.dmg
# 按提示拖入 Applications，首次启动确认：
#   - 不会弹 "未识别开发者" 警告
#   - 能正常拉起 Gateway、登录、发送聊天
```

### 5. Linux / Windows 产物验证

```bash
# Linux deb/rpm：看是否生成了
gh release download v0.1.0 --pattern '*.deb' --pattern '*.rpm' --dir /tmp/verify-linux
ls -la /tmp/verify-linux
# 期望看到 oclaw-desktop_0.1.0_amd64.deb / oclaw-desktop-0.1.0.x86_64.rpm

# Windows exe：看是否生成了
gh release download v0.1.0 --pattern '*.exe' --dir /tmp/verify-win
ls -la /tmp/verify-win
# 期望看到 OClaw-0.1.0-x64.exe

# 确认 blockmap 也生成了（用于差分更新）
gh release download v0.1.0 --pattern '*.blockmap' --dir /tmp/verify-bm
ls -la /tmp/verify-bm
```

5 步全部通过后，去 GitHub Releases 页面把 draft release 点 **Publish release**。

## 撤回 / 修复错误的发布

### 场景 A：打错了 tag（例：想发 v0.1.0 结果打了 v0.1.1）

```bash
# 1. 删除本地 + 远程的错误 tag
git tag -d v0.1.1
git push origin :refs/tags/v0.1.1

# 2. 把正确的 tag 移到目标 commit（force-update）
git tag -f v0.1.0 <commit-sha>
git push --force origin v0.1.0

# 3. 如果错误 tag 已经触发了 workflow，去 GitHub Actions UI 取消
gh run list --workflow="Release Desktop App" --limit 3
gh run cancel <run-id>

# 4. 删除可能已经创建的 draft release
gh release delete v0.1.1 --yes
```

### 场景 B：想 re-trigger 一次发布（workflow 没自动重跑）

```bash
# 方法 A：本地空 commit + 重新打 tag（推荐，能保证 commit + tag 原子性）
git commit --allow-empty -m "chore(desktop): re-release v0.1.0"
git tag -f v0.1.0 HEAD
git push origin main --force
git push --force origin v0.1.0

# 方法 B：用 gh CLI 手动触发 workflow（workflow 需要有 workflow_dispatch 触发器）
gh workflow run release-desktop.yml

# 方法 C：在 GitHub Actions UI 找到失败的 run → Re-run all jobs
```

### 场景 C：签名 / 公证失败，但 tag 已经推上去了

```bash
# 1. 修正代码（修复签名问题、补充缺失的 secret、修复 spec 文件等）

# 2. commit + 重新 force-push tag
git commit --amend --no-edit
git tag -f v0.1.0 HEAD
git push --force origin main
git push --force origin v0.1.0

# 3. 失败留下的 draft release 删掉
gh release delete v0.1.0 --yes

# 4. GitHub Actions 会重新跑 4 个 matrix job
```

### 场景 D：发布了一个 broken 版本，希望回退

```bash
# 1. 删掉 draft / 已发布的 release（连同所有 assets）
gh release delete v0.1.0 --yes

# 2. 删掉本地 + 远程 tag
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0

# 3. 客户端 electron-updater 会自动检测到 latest-*.yml 不再存在，停止推送更新
#    （已安装的用户不会被打扰，正在更新的用户会收到错误提示）
```

### 场景 E：只想清掉 draft assets，保留 release 页面

```bash
# 列出现有 assets
gh release view v0.1.0 --json assets --jq '.assets[].name'

# 删掉某个 asset
gh release delete-asset v0.1.0 OClaw-0.1.0-arm64.dmg --yes
```

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

在 push tag 之前，可以在本地先跑一遍构建做烟雾测试。

### 1. 最快的烟测：只跑 TS 编译

```bash
cd desktop-electron
pnpm run build
# 产出：dist/main.js + dist/preload.cjs
```

### 2. 完整构建（PyInstaller + 前端 + electron-builder，不发布）

```bash
cd desktop-electron
pnpm run build:app
# 产出在 release/：
#   OClaw-0.1.0-arm64.dmg   ~310 MB
#   OClaw-0.1.0-arm64-mac.zip
#   oclaw-desktop_0.1.0_amd64.deb
#   oclaw-desktop-0.1.0.x86_64.rpm
#   OClaw-0.1.0-x64.exe
#   latest-mac.yml / latest-linux.yml / latest.yml
```

### 3. 本地签名 + 公证（不发布）

把 GitHub Secrets 里那几个值临时 export 到环境变量再跑：

```bash
export CSC_LINK="$(cat ~/DeveloperID.p12 | base64 | tr -d '\n')"
export CSC_KEY_PASSWORD="你的 p12 密码"
export APPLE_ID="13609247807@139.com"
export APPLE_APP_SPECIFIC_PASSWORD="xndw-omoo-ltap-tqgd"
export APPLE_TEAM_ID="DHV5D72JNF"

cd desktop-electron
pnpm exec electron-builder --mac --arm64 --publish never
# 会自动：
#   1. 把 .p12 导入临时 keychain
#   2. codesign --deep --options runtime
#   3. xcrun notarytool submit --wait
#   4. xcrun stapler staple
```

如果只想构建但跳过签名（快速看 UI）：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --mac --arm64 --publish never
# 产物会未签名，macOS 上首次启动会弹 "未识别开发者"
```

### 4. 验证本地产物的签名、公证、staple

```bash
# (a) 验证 .app 签名
codesign -dv --verbose=4 desktop-electron/release/mac-arm64/OClaw.app 2>&1 | head -20
# 期望看到 Authority=Developer ID Application: ...

# 严格验证
codesign --verify --deep --strict --verbose=2 desktop-electron/release/mac-arm64/OClaw.app

# (b) 验证 .dmg（公证后的产物）
codesign -dv --verbose=4 desktop-electron/release/OClaw-0.1.0-arm64.dmg
spctl --assess --verbose --type install desktop-electron/release/OClaw-0.1.0-arm64.dmg
xcrun stapler validate desktop-electron/release/OClaw-0.1.0-arm64.dmg

# (c) 手动查询公证状态（如果用 xcrun altool 而不是 notarytool）
xcrun altool --notarization-info <RequestUUID> \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
# Package List 里看到 "Package Status: accepted" 才算成功
```

### 5. 干净重建（一切从零开始）

```bash
cd desktop-electron
rm -rf release dist
rm -rf resources/gateway/*    # PyInstaller 产出
pnpm run build:app
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

## 常用操作速查

### Git tag 操作

```bash
# 列出所有本地 tag
git tag -l 'v*'

# 列出所有远程 tag
git ls-remote --tags origin 'v*'

# 查看 tag 指向的 commit
git rev-parse v0.1.0
git log --oneline -1 v0.1.0

# 验证 tag 与 main HEAD 一致
[ "$(git rev-parse v0.1.0)" = "$(git rev-parse main)" ] \
  && echo "✓ Tag matches main HEAD" \
  || echo "✗ Tag does NOT match main HEAD"

# 创建本地 tag
git tag v0.1.0

# 推送 tag 到远程
git push origin v0.1.0
git push origin --tags      # 推送所有本地 tag

# 强制推送 tag（覆盖远程同名 tag）
git push --force origin v0.1.0
# 或 等价的两步写法
git push origin :refs/tags/v0.1.0
git push origin v0.1.0

# 删除 tag
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

### GitHub Release 操作（需先 `gh auth login`）

```bash
# 登录
gh auth login

# 列出所有 release
gh release list

# 查看某个 release 的详情
gh release view v0.1.0

# 查看 release 所有 asset
gh release view v0.1.0 --json assets --jq '.assets[].name'

# 删除一个 release（连同 tag + assets）
gh release delete v0.1.0 --yes

# 只删某个 asset
gh release delete-asset v0.1.0 OClaw-0.1.0-arm64.dmg --yes

# 手动上传额外 asset
gh release upload v0.1.0 ./local-file.dmg

# 创建一个 release（不依赖 workflow）
gh release create v0.1.0 \
  --title "OClaw v0.1.0" \
  --notes "Release notes here" \
  ./OClaw-0.1.0-arm64.dmg \
  --draft
```

### GitHub Actions workflow 操作

```bash
# 列出最近 10 次 run（跨 workflow）
gh run list --limit 10

# 列出指定 workflow 的 run
gh run list --workflow="Release Desktop App" --limit 10

# 看某个 run 的详情
gh run view <run-id>

# 看某个 run 的完整日志（排查公证失败等）
gh run view <run-id> --log
gh run view <run-id> --log | grep -A 30 -i "notariz\|error"

# 取消正在跑的 run
gh run cancel <run-id>

# 重跑失败的 run
gh run rerun <run-id>
gh run rerun <run-id> --failed-only    # 只重跑失败的 job

# 手动触发 workflow
gh workflow run release-desktop.yml

# 手动触发 + 传参
gh workflow run release-desktop.yml -f tag=v0.1.0

# 看 workflow 列表
gh workflow list
```

### macOS 代码签名 / 公证验证

```bash
# 列出 Keychain 里的代码签名身份
security find-identity -p codesigning -v

# 查看具体证书的 PEM 内容
security find-certificate -c "Developer ID Application" -p

# 验证 .app 签名
codesign -dv --verbose=4 path/to/App.app
codesign --verify --deep --strict --verbose=2 path/to/App.app

# 验证 .dmg Gatekeeper 评估
spctl --assess --verbose --type install path/to/OClaw.dmg

# 验证 .dmg / .app 是否已 staple 公证票据
xcrun stapler validate path/to/OClaw.dmg
xcrun stapler validate path/to/App.app

# 手动提交公证（electron-builder 已自动处理，这个仅在排查问题时用）
xcrun altool --notarize-app \
  --primary-bundle-id com.oclaw.desktop \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --file path/to/OClaw.dmg
# 拿到 RequestUUID 后查询状态：
xcrun altool --notarization-info <RequestUUID> \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"

# 手动 staple（如果 notarytool 没自动 staple）
xcrun stapler staple path/to/OClaw.dmg

# 查看 Keychain 里的所有证书（不仅仅是代码签名）
security find-identity -v

# 删除 Keychain 里的某个证书
security delete-certificate -c "Developer ID Application: Your Name" login.keychain
```

### electron-builder 调试

```bash
# 看 electron-builder 帮助
pnpm exec electron-builder --help

# 单平台构建
pnpm exec electron-builder --mac --arm64 --publish never
pnpm exec electron-builder --linux deb rpm --publish never
pnpm exec electron-builder --win nsis     --publish never

# 跳过代码签名（本地开发）
CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --mac --arm64 --publish never

# 开启 debug 日志（详细到能看每个文件的处理）
DEBUG="electron-builder,electron-builder:*" \
  pnpm exec electron-builder --mac --arm64 --publish never

# 干净重建
rm -rf desktop-electron/release desktop-electron/dist
rm -rf desktop-electron/resources/gateway/*
pnpm --dir desktop-electron run build:app
```

### electron-updater manifest 验证

```bash
# 拉取最新 macOS manifest
curl -sL https://github.com/kkutysllb/kk_OClaw/releases/latest/download/latest-mac.yml

# 拉取所有平台的 manifest
for plat in mac linux win; do
  echo "=== latest-${plat}.yml ==="
  curl -sL "https://github.com/kkutysllb/kk_OClaw/releases/latest/download/latest-${plat}.yml" \
    || echo "(not found)"
done

# 验证 sha512（从 yml 里拿到 hash，跟下载下来的 .dmg 算的对比）
shasum -a 512 -b path/to/OClaw-0.1.0-arm64.dmg | awk '{print $1}' | xxd -r -p | base64
```

### 环境变量 dump 脚本

如果某个 job 失败了，调试时把整个 env dump 出来能快速定位缺失的 secret：

```yaml
# 在出问题的 step 之前加一个临时 step
- name: Dump env (debug)
  if: failure()
  env:
    ALL_VARS: ${{ toJson(env) }}
  run: |
    echo "=== env (masked) ==="
    echo "$ALL_VARS" | jq .
```

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
| macOS Runner | macos-14（arm64） |
| Linux Runner | ubuntu-22.04 |
| Windows Runner | windows-latest |

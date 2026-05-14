# Cover Background Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `assets/cover.svg` 中实现“中心星云能量场 + 轻量 HUD 点缀”的背景升级，并保持标题、文案和整体布局不变。

**Architecture:** 直接在现有 SVG 结构上做最小增强：在 `defs` 中补充少量新的渐变与滤镜，然后重构背景层级，新增星云、能量环、分层粒子和边缘 HUD 元素，并弱化当前斜向光束。验证方式以 XML 解析校验和人工结构检查为主，不引入额外工程依赖。

**Tech Stack:** SVG, XML, Python 3 (`xml.etree.ElementTree`)

---

## Task 1: 建立可验证的基线

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 读取当前 SVG 并确认背景相关区块边界**

阅读以下关键区块，确认后续改动位置：

```xml
<defs>
  ...
</defs>

<!-- Background -->
<rect width="1200" height="640" fill="url(#bgGradient)"/>

<!-- Light beam effects -->
...

<!-- Particle bursts -->
...

<!-- Main title -->
...
```

目的：

- `defs`：新增渐变、滤镜和可能的遮罩定义
- 背景与光束区：替换为新的深空底层与更弱的斜向光束
- 粒子区：调整为分层粒子系统
- 标题前区域：避免新增元素破坏可读性

- [ ] **Step 2: 运行解析校验，确认当前文件是可解析基线**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("baseline parse OK")
PY
```

Expected:

```text
baseline parse OK
```

- [ ] **Step 3: 记录本次改动边界**

只允许改动以下类别：

```text
1. defs 中新增渐变/滤镜
2. 背景底层与光束层
3. 粒子层
4. 新增星云/能量环/HUD 点缀层
```

禁止改动：

```text
1. 主标题文案
2. 副标题文案
3. 功能标签文字与位置
4. 底部技术栈文字与位置
```

- [ ] **Step 4: 提交基线说明**

```bash
git status --short
```

Expected:

```text
显示已有工作区改动，但不新增与计划无关的文件修改
```

## Task 2: 升级底层深空背景与星云雾面

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 在 `defs` 中加入新的背景和星云渐变/滤镜定义**

在现有 `defs` 末尾追加类似下面的结构：

```xml
<radialGradient id="coreGlow" cx="50%" cy="42%" r="42%">
  <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.28"/>
  <stop offset="35%" stop-color="#3b82f6" stop-opacity="0.18"/>
  <stop offset="70%" stop-color="#1e3a8a" stop-opacity="0.06"/>
  <stop offset="100%" stop-color="#071526" stop-opacity="0"/>
</radialGradient>

<radialGradient id="nebulaBlue" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.22"/>
  <stop offset="45%" stop-color="#60a5fa" stop-opacity="0.12"/>
  <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/>
</radialGradient>

<radialGradient id="nebulaViolet" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#818cf8" stop-opacity="0.16"/>
  <stop offset="55%" stop-color="#4f46e5" stop-opacity="0.08"/>
  <stop offset="100%" stop-color="#312e81" stop-opacity="0"/>
</radialGradient>

<filter id="nebulaBlur" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="24"/>
</filter>
```

- [ ] **Step 2: 将背景底层从单一渐变扩展为深空 + 中心辉光 + 边角压暗**

把背景区替换为更分层的结构：

```xml
<!-- Background -->
<rect width="1200" height="640" fill="url(#bgGradient)"/>
<rect width="1200" height="640" fill="url(#coreGlow)"/>
<ellipse cx="600" cy="250" rx="460" ry="210" fill="url(#nebulaViolet)" filter="url(#nebulaBlur)" opacity="0.7"/>
<ellipse cx="600" cy="270" rx="360" ry="170" fill="url(#nebulaBlue)" filter="url(#nebulaBlur)" opacity="0.75"/>
```

要求：

- 边角仍保持足够暗
- 中心提亮集中在标题周围
- 不覆盖后续标题的可读区域

- [ ] **Step 3: 新增 2 到 3 层星云雾面**

在背景层之后、光束层之前加入星云分层，例如：

```xml
<!-- Nebula layers -->
<ellipse cx="430" cy="250" rx="220" ry="120" fill="url(#nebulaBlue)" filter="url(#nebulaBlur)" opacity="0.45"/>
<ellipse cx="760" cy="255" rx="260" ry="135" fill="url(#nebulaViolet)" filter="url(#nebulaBlur)" opacity="0.36"/>
<ellipse cx="600" cy="330" rx="300" ry="110" fill="url(#nebulaBlue)" filter="url(#nebulaBlur)" opacity="0.22"/>
```

- [ ] **Step 4: 运行解析校验**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("background parse OK")
PY
```

Expected:

```text
background parse OK
```

- [ ] **Step 5: 提交底层视觉升级**

```bash
git add assets/cover.svg
git commit -m "feat: enhance cover base nebula background"
```

## Task 3: 引入能量环并弱化旧光束

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 在 `defs` 中加入轨迹线渐变**

补充弧线与能量环需要的渐变：

```xml
<linearGradient id="arcStroke" x1="0%" y1="0%" x2="100%" y2="0%">
  <stop offset="0%" stop-color="#67e8f9" stop-opacity="0"/>
  <stop offset="50%" stop-color="#60a5fa" stop-opacity="0.5"/>
  <stop offset="100%" stop-color="#818cf8" stop-opacity="0"/>
</linearGradient>
```

- [ ] **Step 2: 将旧光束降权**

把现有光束调整为更弱的辅助层，例如：

```xml
<line x1="100" y1="100" x2="1100" y2="540" stroke="url(#beamGradient)" stroke-width="42" filter="url(#beamGlow)" opacity="0.24"/>
<line x1="220" y1="160" x2="980" y2="480" stroke="#60a5fa" stroke-width="18" opacity="0.07"/>
```

并删除最弱但冗余的一条斜线，避免继续强调“穿场感”。

- [ ] **Step 3: 在标题周围增加半环和弧形轨迹**

在标题前但不遮挡文字的层中加入：

```xml
<!-- Energy arcs -->
<path d="M 320 300 A 300 130 0 0 1 880 300" fill="none" stroke="url(#arcStroke)" stroke-width="2.2" opacity="0.34"/>
<path d="M 360 230 A 240 90 0 0 1 840 230" fill="none" stroke="url(#arcStroke)" stroke-width="1.4" opacity="0.22"/>
<path d="M 395 360 A 205 70 0 0 0 805 360" fill="none" stroke="url(#arcStroke)" stroke-width="1.2" opacity="0.18"/>
```

约束：

- 弧线只做包围和聚能暗示
- 不穿过 `OClaw` 字体主干
- 不在副标题后方叠加过亮线条

- [ ] **Step 4: 重新验证可解析**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("arc parse OK")
PY
```

Expected:

```text
arc parse OK
```

- [ ] **Step 5: 提交能量环与光束调整**

```bash
git add assets/cover.svg
git commit -m "feat: add cover energy arcs"
```

## Task 4: 重建粒子层级并加入边缘 HUD 点缀

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 将粒子按远景、中景、前景重新分层**

把当前大段粒子整理为 3 个分组，结构类似：

```xml
<!-- Background particles -->
<g filter="url(#particleBlur)" opacity="0.55">
  ...
</g>

<!-- Mid particles -->
<g filter="url(#particleBlur)" opacity="0.75">
  ...
</g>

<!-- Foreground spark particles -->
<g opacity="0.9">
  ...
</g>
```

调整原则：

- 远景粒子更小、更暗、更分散
- 中景粒子保留当前主数量
- 前景粒子数量很少，但更亮，可带极短拖尾

- [ ] **Step 2: 为少量前景粒子增加短拖尾**

示例结构：

```xml
<line x1="260" y1="182" x2="272" y2="176" stroke="#67e8f9" stroke-width="1" opacity="0.28"/>
<circle cx="260" cy="182" r="1.2" fill="#93c5fd" opacity="0.88"/>
```

要求：

- 拖尾数量极少
- 长度很短
- 只作为轻微运动暗示

- [ ] **Step 3: 在边缘加入 HUD 点缀**

示例结构：

```xml
<!-- Edge HUD accents -->
<path d="M 80 110 A 120 120 0 0 1 170 40" fill="none" stroke="#67e8f9" stroke-width="1" opacity="0.12"/>
<path d="M 1030 70 L 1110 70" stroke="#60a5fa" stroke-width="1" opacity="0.10"/>
<path d="M 1045 86 L 1110 86" stroke="#60a5fa" stroke-width="1" opacity="0.08"/>
<path d="M 70 560 L 130 560 L 130 590" fill="none" stroke="#67e8f9" stroke-width="1" opacity="0.10"/>
```

约束：

- 仅分布在边角和边缘
- 避开副标题和功能标签
- 可见但不能抢眼

- [ ] **Step 4: 运行最终解析校验**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("final parse OK")
PY
```

Expected:

```text
final parse OK
```

- [ ] **Step 5: 检查视觉约束并提交**

人工检查以下内容是否仍满足：

```text
1. 标题最醒目
2. 副标题清晰
3. 功能标签未被遮挡
4. 底部技术栈仍可读
5. 背景比原先更有纵深和科技感
```

提交：

```bash
git add assets/cover.svg
git commit -m "feat: refine cover particles and HUD accents"
```

## Task 5: 最终验证与交付

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 输出最终差异检查**

Run:

```bash
git diff -- assets/cover.svg
```

Expected:

```text
只包含背景增强相关改动，不包含标题文案或布局位移类修改
```

- [ ] **Step 2: 再次执行解析验证**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("delivery parse OK")
PY
```

Expected:

```text
delivery parse OK
```

- [ ] **Step 3: 检查诊断**

Run:

```text
GetDiagnostics(file:///Users/libing/kk_Projects/kk_OClaw/assets/cover.svg)
```

Expected:

```text
无新的诊断错误
```

- [ ] **Step 4: 汇总交付结果**

交付说明需要覆盖：

```text
1. 改了哪些背景层
2. 如何保证标题可读性
3. 解析校验是否通过
4. 是否保留了原布局与文案
```

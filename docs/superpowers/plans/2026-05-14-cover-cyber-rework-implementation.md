# Cover Cyber Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `assets/cover.svg` 从柔和星云风重做为“中轴主控台”赛博风，并显著增强 `OClaw` 标题清晰度与压场感。

**Architecture:** 直接在现有 SVG 上重构视觉层级：弱化星云和粒子，强化中轴主控框、标题背板、双层标题高光和更克制但更硬朗的 HUD 结构。验证以 XML 解析、诊断检查和差异检查为主。

**Tech Stack:** SVG, XML, Python 3 (`xml.etree.ElementTree`)

---

## Task 1: 重构视觉骨架

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 弱化当前星云和柔光背景**

把以下元素整体降权：

```xml
<ellipse ... fill="url(#nebulaViolet)" ... opacity="0.78"/>
<ellipse ... fill="url(#nebulaBlue)" ... opacity="0.8"/>
<ellipse ... fill="url(#particleGlow)" .../>
```

目标：

```text
1. 保留少量氛围
2. 不再让雾面主导画面
3. 让中间主控轴成为第一结构
```

- [ ] **Step 2: 新增中轴主控台框体**

加入纵向中轴框、切片线、辅助刻度，形式类似：

```xml
<rect x="455" y="95" width="290" height="250" rx="18" .../>
<rect x="500" y="70" width="200" height="18" rx="9" .../>
<line .../>
<path .../>
```

- [ ] **Step 3: 运行解析校验**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("cyber frame parse OK")
PY
```

Expected:

```text
cyber frame parse OK
```

## Task 2: 重做标题系统

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 为标题增加背板和暗槽**

加入深色背板与发光底座，确保标题从背景里被抠出来。

- [ ] **Step 2: 把标题改成多层结构**

保留 `OClaw` 文案不变，但重做为：

```text
1. 底层投影/背光
2. 中层主体字形
3. 上层描边/高光切片
```

- [ ] **Step 3: 控制副标题和分割线**

让副标题可读但退后于主标题，分割线服务于中轴结构。

- [ ] **Step 4: 运行解析校验**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("title parse OK")
PY
```

Expected:

```text
title parse OK
```

## Task 3: 收敛装饰并完成验证

**Files:**

- Modify: `assets/cover.svg`
- Test: `assets/cover.svg`

- [ ] **Step 1: 减少粒子和装饰噪声**

保留少量高亮粒子与边缘 HUD，不再让零散粒子抢画面。

- [ ] **Step 2: 做最终差异和诊断检查**

Run:

```bash
git diff -- assets/cover.svg
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse("assets/cover.svg")
print("delivery parse OK")
PY
```

Expected:

```text
1. diff 只包含背景和标题视觉相关改动
2. 输出 delivery parse OK
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

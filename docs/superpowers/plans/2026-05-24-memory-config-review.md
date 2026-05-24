# Memory Config Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不扩大范围的前提下，小幅更新 `config.yaml` 的 `memory:` 配置，并同步 `docs/TODO.md` 记录最近已完成的 memory 系统能力。

**Architecture:** 只修改两个文件：`config.yaml` 和 `docs/TODO.md`。配置侧仅调整 `memory.fact_confidence_threshold`，其余 retrieval 相关配置保持不变；文档侧只补记忆系统近期已完成事项，不重写 roadmap。通过读文件核对、必要时做轻量配置验证和最终 git 状态检查完成交付。

**Tech Stack:** YAML, Markdown, Python config schema compatibility, git

---

## 文件结构

### Modify

- `config.yaml`：只更新 `memory.fact_confidence_threshold`
- `docs/TODO.md`：补充已完成的 memory 系统能力

## Task 1: 先锁定当前配置与文档变更目标

**Files:**

- Modify: `config.yaml`
- Modify: `docs/TODO.md`

- [ ] **Step 1: 先人工核对当前 memory 配置片段和 TODO 现状**

```yaml
memory:
  enabled: true
  storage_path: memory.json
  debounce_seconds: 30
  model_name: glm-5.1
  max_facts: 100
  fact_confidence_threshold: 0.75
  injection_enabled: true
  max_injection_tokens: 2000
  retrieval:
    enabled: true
    strategy: tfidf
    context_max_turns: 4
    context_max_chars: 4000
    similarity_weight: 0.6
    confidence_weight: 0.4
    min_similarity: 0.0
```

```md
## 已完成功能

- [x] 在首个文件系统或 bash 工具被调用后才启动 sandbox
- [x] 为整个流程添加澄清过程
- [x] 实现上下文摘要机制，避免上下文爆炸
...
```

- [ ] **Step 2: 确认本次变更只包含一个配置数值和一组 TODO 状态补充**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git diff -- config.yaml docs/TODO.md`

Expected: 当前无差异，准备进入最小改动

- [ ] **Step 3: 提交这一小步说明不需要，因为此任务仅做范围确认**

```bash
# No commit in Task 1
```

## Task 2: 更新 `config.yaml` 的 memory 阈值

**Files:**

- Modify: `config.yaml`

- [ ] **Step 1: 先写出目标配置片段**

```yaml
memory:
  enabled: true
  storage_path: memory.json
  debounce_seconds: 30
  model_name: glm-5.1
  max_facts: 100
  fact_confidence_threshold: 0.7
  injection_enabled: true
  max_injection_tokens: 2000
  retrieval:
    enabled: true # Whether to rank facts using current conversation context
    strategy: tfidf # Current supported retrieval strategy
    context_max_turns: 4 # Number of recent user/final-assistant turns used as current context
    context_max_chars: 4000 # Max characters retained when building current context
    similarity_weight: 0.6 # Weight for TF-IDF similarity in final ranking
    confidence_weight: 0.4 # Weight for stored fact confidence in final ranking
    min_similarity: 0.0 # Lower similarity floor before weighted ranking
```

- [ ] **Step 2: 将 `fact_confidence_threshold` 从 `0.75` 改为 `0.7`**

```yaml
-  fact_confidence_threshold: 0.75
+  fact_confidence_threshold: 0.7
```

- [ ] **Step 3: 重新读取 `config.yaml` 的 memory 片段，确认只改了目标字段**

Run: `python - <<'PY'\nfrom pathlib import Path\ntext = Path('/Users/libing/kk_Projects/kk_OClaw/config.yaml').read_text()\nstart = text.index('memory:')\nend = text.index('agents_api:')\nprint(text[start:end])\nPY`

Expected: 仅 `fact_confidence_threshold` 变为 `0.7`，其余 memory/retrieval 字段保持原样

- [ ] **Step 4: 提交这一小步**

```bash
git add config.yaml
git commit -m "chore: tune memory fact confidence threshold"
```

## Task 3: 更新 `docs/TODO.md` 的已完成 memory 能力

**Files:**

- Modify: `docs/TODO.md`

- [ ] **Step 1: 在“已完成功能”中追加已完成 memory 条目**

```md
## 已完成功能

- [x] 在首个文件系统或 bash 工具被调用后才启动 sandbox
- [x] 为整个流程添加澄清过程
- [x] 实现上下文摘要机制，避免上下文爆炸
- [x] 集成 MCP（模型上下文协议）以扩展工具
- [x] 添加文件上传支持，自动文档转换
- [x] 实现自动线程标题生成
- [x] 添加计划模式及 TodoList 中间件
- [x] 添加视觉模型支持及 ViewImageMiddleware
- [x] 技能系统及 SKILL.md 格式
- [x] 将 `packages/harness/kkoclaw/tools/builtins/task_tool.py` 中的 `time.sleep(5)` 替换为 `asyncio.sleep()`（子智能体轮询）
- [x] 实现基于 `current_context` 的 TF-IDF 相似度检索
- [x] 实现按相似度 + 置信度的 memory facts 加权排序
- [x] 为 memory retrieval 引入 facts 侧文档集签名缓存
- [x] 增强 `tokenize_text()` 的中文/技术词切分能力
```

- [ ] **Step 2: 检查 `docs/TODO.md` 没有误改其他 roadmap 项**

Run: `python - <<'PY'\nfrom pathlib import Path\nprint(Path('/Users/libing/kk_Projects/kk_OClaw/docs/TODO.md').read_text())\nPY`

Expected: 仅“已完成功能”区新增 4 条 memory 条目；“计划功能”和“已解决问题”保持原样

- [ ] **Step 3: 提交这一小步**

```bash
git add docs/TODO.md
git commit -m "docs: update memory progress in todo"
```

## Task 4: 最终验证与收尾

**Files:**

- Modify: `config.yaml`
- Modify: `docs/TODO.md`

- [ ] **Step 1: 重新检查两个文件的最终 diff**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git diff HEAD~2..HEAD -- config.yaml docs/TODO.md`

Expected: 只出现一个配置阈值调整，以及 TODO 中 4 条已完成 memory 条目

- [ ] **Step 2: 确认工作区干净且提交顺序正确**

Run: `cd /Users/libing/kk_Projects/kk_OClaw && git status --short && git log --oneline -2`

Expected: `git status --short` 无输出；最近两条提交分别对应 config 调整和 TODO 更新

- [ ] **Step 3: 如需额外稳妥验证，可重新读取 memory 文档与 TODO**

Run: `python - <<'PY'\nfrom pathlib import Path\nfor path in ['config.yaml', 'docs/TODO.md']:\n    print(f'===== {path} =====')\n    print(Path('/Users/libing/kk_Projects/kk_OClaw', path).read_text())\nPY`

Expected: 内容与 spec 一致，没有扩大到 memory 范围以外的更改

- [ ] **Step 4: 无额外代码提交，本任务只做最终核对**

```bash
# No commit in Task 4
```

## 自检

- spec 中要求的“仅更新 `memory:` 段、只小幅调整 `fact_confidence_threshold`、保留 retrieval 配置、同步 `docs/TODO.md` 已完成项”都已映射到任务
- 计划没有使用 `TODO`、`TBD` 或含糊占位内容
- 文件范围保持一致：只涉及 `config.yaml` 与 `docs/TODO.md`

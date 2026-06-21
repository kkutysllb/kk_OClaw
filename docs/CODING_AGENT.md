# Coding Agent 实现说明

Coding Agent 是 KKOCLAW 面向真实代码项目的独立 coding 工作台。它不是把普通聊天任务简单接入项目目录，而是在 OClaw 内部新增了一条独立的 Qiongqi 运行边界：独立 session、独立 memory、独立 scratch workspace、独立 skills、独立 diff/review/ROI 事件链路。

本文档说明当前前后端实现、数据边界、核心工作流和已知边界。

## 设计目标

Coding Agent 的目标是让 agent 可以在不污染普通 OClaw 任务、不污染用户项目根目录的前提下完成工程任务：

- 项目感知：绑定本地项目路径，浏览文件、查看代码、读取 Git diff。
- 运行隔离：Coding 的 session、active skills、事件、ROI 和中间文件与普通任务隔离。
- 工程闭环：从需求、设计、实现、验证、审查到交付形成可复用工作流。
- 变更可见：前端能看到项目 diff、任务变更、Qiongqi 事件、ROI 和 code review 结论。
- 审查可执行：Code Review 基于项目 diff、任务变更、Qiongqi 事件和 PR 上下文，而不是只做文本建议。

## 总体架构

```text
frontend/src/app/workspace/coding
        |
        v
frontend/src/components/workspace/coding
        |
        v
frontend/src/core/projects/api.ts
        |
        v
backend/app/gateway/routers/*
        |
        v
backend/app/gateway/coding_*_services.py
        |
        v
backend/packages/harness/kkoclaw/coding_core
        |
        v
~/.oclaw-coding/{thread_id}
```

核心边界分为三层：

- **Gateway API 层**：项目、文件、diff、session、events、changes、ROI、skills、review 等 HTTP 接口。
- **Qiongqi 核心层**：`coding_core` 负责 runtime context、skills、session store、change tracking、events 和 ROI telemetry。
- **Coding Agent 适配层**：`agents/coding_agent` 把 Qiongqi runtime 接入现有 agent graph 和 middleware。

## 后端实现

### 核心目录

主要实现文件：

- `backend/packages/harness/kkoclaw/coding_core/`
  - `qiongqi.py`：QiongqiEngine 核心运行边界（stable prompt + dynamic context + 阶段完成探针 + 项目遥测）。
  - `context.py`：CodingRuntimeContext 和 scratch workspace 解析。
  - `session_store.py`：独立 session、events、ROI、change summary 持久化。
  - `skills.py`：Coding-only skill registry 和启用状态（含语义激活：同义词映射 + 描述 token 重叠）。
  - `change_tracking.py`：按 thread/task 汇总文件变更。
  - `edit_snapshots.py`：编辑事务快照存储（append-only jsonl，支持 undo）。
  - `delivery_stages.py`：7 阶段交付工作流定义和 completion_signals。
  - `events.py`：Qiongqi 事件记录格式。
  - `roi_telemetry.py`：ROI 报告记录和汇总。
- `backend/packages/harness/kkoclaw/agents/coding_agent/`
  - `agent.py`：Coding Agent 图适配（中间件链注册 PostEditVerifyMiddleware 等）。
  - `runtime.py`：运行时上下文装配。
  - `skills_middleware.py`：Coding skills 注入。
  - `tool_policy_middleware.py`：工具策略注入。
  - `roi_middleware.py`：ROI telemetry 采集。
  - `prompt.py`：Coding prompt 装配。
- `backend/packages/harness/kkoclaw/agents/middlewares/`
  - `post_edit_verify_middleware.py`：改→验证闭环中间件，检测 mutation 后无 verification 则注入提醒。
- `backend/packages/harness/kkoclaw/tools/coding/`
  - `file_read.py`、`file_edit.py`、`git_tools.py`、`pr_tools.py`、`test_tools.py`（结构化解析 + 多语言 linter）、`worktree.py`。
  - `symbol_tools.py`：符号级导航（find_symbols / read_symbol，支持 Python/JS-TS/Go/Rust）。
  - `refactor_tools.py`：结构化重构（rename_symbol / extract_function）。
  - `undo_tools.py`：编辑事务回滚（undo_last_edit / list_edit_snapshots）。

Gateway 服务：

- `backend/app/gateway/coding_services.py`：项目文件、内容、Git diff。
- `backend/app/gateway/coding_session_services.py`：Qiongqi session 查询。
- `backend/app/gateway/coding_event_services.py`：Qiongqi events 查询。
- `backend/app/gateway/coding_change_services.py`：任务变更查询。
- `backend/app/gateway/coding_roi_services.py`：ROI 报告和汇总。
- `backend/app/gateway/coding_skill_services.py`：Coding skills 发现和启用状态。
- `backend/app/gateway/coding_review_services.py`：项目 diff / PR review / 自动修复。

对应路由：

- `backend/app/gateway/routers/projects.py`
- `backend/app/gateway/routers/coding_sessions.py`
- `backend/app/gateway/routers/coding_events.py`
- `backend/app/gateway/routers/coding_changes.py`
- `backend/app/gateway/routers/coding_roi.py`
- `backend/app/gateway/routers/coding_skills.py`
- `backend/app/gateway/routers/coding_review.py`

### QiongqiEngine

`QiongqiEngine` 是 Coding Agent 的核心边界。它负责把 coding 任务需要的稳定系统提示词、动态项目上下文、Coding skills、工具目录 fingerprint 和 ROI 元数据组织成一个独立 runtime。

当前能力：

- 根据 `project_root`、`thread_id`、`scratch_root` 构建 `CodingRuntimeContext`。
- 发现项目级、用户级和内置 Coding skills。
- 根据任务文本激活匹配的 skills，并加载对应 `SKILL.md`。
- 构建稳定 system prompt 和动态 context。
- 生成 `stable_prompt_fingerprint`、`tool_catalog_fingerprint`、`immutable_prefix_fingerprint`。
- 输出 Qiongqi ROI metadata，包括 full/visible/hidden tool count。

Qiongqi 的稳定提示词（`_STABLE_QIONGQI_PROMPT`）强调：

**Runtime Contract（运行时边界）**：

- 项目路径、active skills、任务细节、工具结果属于动态上下文。
- 临时分析文件应写入 scratch workspace。
- 只有明确需要修改用户项目时，才写入项目根目录。
- 对代码、路径、命令、错误信息保持精确。

**Core Operating Principles（核心操作准则）**：

- 先理解再动手：修改前必先读文件、看上下文、看测试。
- 最小精确变更：一处变更只做一件事，避免连带重写。
- **改→验证强制闭环**：任何代码变更后，必须调用 run_tests/run_linter/bash 验证后才能报告完成。
- Git 卫生：频繁小提交；变更前 pull；冲突优先手工解决。
- 安全与权限：遵守 tool policy；不跳过 sandbox；路径校验。
- 失败恢复纪律：同一方式连续失败 3 次时停止重试，向用户求助。

**Workflow Patterns（工作流模式）**：Feature 实现 / Bug 修复 / 重构 / Code Review 四种模式。

**PostEditVerifyMiddleware** 在运行时强制执行「改→验证闭环」：检测 mutation 工具成功调用后若无 verification 工具调用，在下一轮自动注入提醒，幂等设计避免循环。

**Dynamic Context（动态上下文）** 除项目路径/技能/任务细节外，现在还自动注入：

- **阶段完成探针**：按 7 阶段客观检查（requirements.md 是否存在、测试文件、git 变更数、CI 配置、部署文档）。
- **项目遥测**：技术栈指纹（pyproject/package.json/go.mod/Cargo.toml 推断语言/框架/测试/linter）+ git 状态（branch/dirty count/ahead-behind）。

## Session、Memory 与 Scratch 隔离

Coding Agent 不复用普通 OClaw 任务 memory。Qiongqi session store 使用用户家目录下的独立目录：

```text
~/.oclaw-coding/{thread_id}/
├── session.json
├── events.jsonl
├── roi.jsonl
├── changes/
├── reviews/
│   └── {review_id}.json
└── workspace/
```

关键规则：

- `session.json` 保存 thread、project_root、scratch_root、skills、active skills、tool policy、ROI、change summary。
- `events.jsonl` 保存 Qiongqi 运行事件，使用递增 `seq`。
- `workspace/` 是 Coding Agent 默认中间文件目录。
- 项目根目录只用于读取项目和执行明确的代码修改。
- `thread_id` 会做安全校验，避免任意路径写入。

这解决了两个问题：

- Coding 任务的记忆不会和普通聊天、研究、报告等任务混淆。
- Agent 分析代码时产生的临时文件不会散落到用户项目根目录。

## Coding Skills

Coding skills 与 OClaw 全局 skills 分离，由 `CodingSkillRegistry` 独立发现和管理。

发现顺序：

```text
{project_root}/.oclaw-coding/skills
~/.oclaw-coding/skills
skills/public/coding
```

当前内置 Coding skills 位于 `skills/public/coding/`，数量为 59 个。它们覆盖从需求分析到交付的完整工程链路，例如：

- 需求与产品：`requirements-analysis`、`product-spec`、`acceptance-criteria`
- 设计与初始化：`technical-design`、`project-scaffolding`、`environment-setup`
- 实现与验证：`implement`、`test-driven-development`、`systematic-debugging`、`verification-before-completion`
- 工程质量：`code-review`、`security-review`、`diff-analysis`、`patch-authoring`
- 项目交付：`project-delivery-workflow`、`deployment`、`operations-runbook`、`handoff-docs`
- Agent 工程：`using-superpowers`、`subagent-orchestration`、`context-management`、`agent-memory-isolation`、`scratch-workspace`、`qiongqi-roi`
- 技术栈：`react-nextjs`、`fastapi-backend`、`webapp-testing`、`playwright-verification`

前端当前只展示技能简介、分类/搜索和启用开关，不提供新建/编辑技能入口。后续如果需要开放项目私有 skill，也应继续保持 Coding-only 边界。

## API Surface

前端通过 `frontend/src/core/projects/api.ts` 访问后端。主要接口能力如下：

| 能力 | API |
|------|-----|
| 项目列表/创建/删除 | `/api/projects` |
| 文件树 | `/api/projects/{project_id}/files` |
| 文件内容 | `/api/projects/{project_id}/file` |
| 项目 diff | `/api/projects/{project_id}/diff` |
| 丢弃单文件变更 | `/api/projects/{project_id}/diff/discard` |
| Worktree 管理 | `/api/projects/{project_id}/worktrees` |
| Qiongqi session | `/api/coding/sessions/{thread_id}` |
| Qiongqi events | `/api/coding/sessions/{thread_id}/events` |
| 任务变更 | `/api/coding/sessions/{thread_id}/changes` |
| ROI 汇总 | `/api/coding/sessions/{thread_id}/roi/summary` |
| ROI 报告列表 | `/api/coding/sessions/{thread_id}/roi` |
| Coding skills | `/api/coding/skills` |
| Code Review | `/api/coding/reviews` |
| 最新 Review | `/api/coding/sessions/{thread_id}/review` |
| 应用 Review 修复 | `/api/coding/reviews/fixes/apply` |

## Project Diff、Task Changes、Events 与 ROI

Coding Agent 的前端不是只展示聊天结果，而是把任务运行过程拆成几个可审计视角：

- **Project Diff**：来自 Git diff，展示当前项目所有未提交变更。
- **Task Changes**：来自 Qiongqi change tracker，按 thread/task 汇总 Agent 本轮记录到的文件修改。
- **Events**：来自 Qiongqi event stream，展示运行时事件、工具策略、测试信号等上下文。
- **ROI**：记录 prompt/tool fingerprint、provider token usage、tool output、token economy 等信息。

这些数据最终服务于两个目标：

- 让用户知道 agent 到底改了什么、为什么改、是否验证过。
- 让 Code Review 可以基于真实 diff、任务变更和运行事件生成结论。

## Code Review 与 PR Review

`CodingReviewService` 当前支持两种审查范围：

- `project_diff`：审查工作区当前 Git diff。
- `pr`：基于本地 Git 仓库计算 merge-base、commit list 和 `merge_base..HEAD` diff。

PR review 的上下文包括：

- requested base ref
- resolved base ref
- merge base
- head
- commits
- aggregate diff

审查输入会同时合并：

- 项目 diff 文件列表
- Qiongqi task changes
- Qiongqi events
- PR context

当前内置规则包括：

- 检测疑似硬编码 secret/token/password。
- 标记认证、权限、配置、路由、数据库、支付等高风险路径。
- 标记单文件大变更导致的审查成本和回归风险。
- 如果看不到测试文件变更或 Qiongqi 测试事件，则提示测试缺口。
- 检测变更中的行尾空白/缺失末尾换行（可一键规范化）。
- 检测项目根 `.env` 未被 `.gitignore` 忽略（可一键追加）。
- 检测新增/修改的 Python 源文件缺少对应测试文件（可一键生成 skip 骨架）。

审查结论使用 `decision` 表示：

- `request_changes`：存在 critical finding。
- `needs_review`：存在 major finding。
- `pass`：没有 critical/major finding。

## 一键修复安全模型

当前一键修复是确定性、保守的安全修复，不是任意自动改代码。

已支持的自动修复：

- **硬编码 secret**（`replace_python_secret_with_env`）：Python 文件中单行硬编码 secret/token/password/API key 赋值，替换为 `os.environ.get("ENV_NAME", "")`，如缺少 `import os` 则自动插入。
- **简单 lint**（`normalize_whitespace`）：去除行尾空白并补齐文件末尾换行符，对齐 ruff W291/W292/W293；整文件确定性规范化。
- **配置风险**（`gitignore_dotenv`）：检测到项目根存在 `.env` 但 `.gitignore` 未忽略时，一键追加 `.env` 忽略规则。
- **测试缺口**（`create_test_skeleton`）：新增/修改的 Python 源文件若无对应 `tests/test_<module>.py`，一键创建含 `@pytest.mark.skip` 占位的骨架文件，供用户补充断言后移除 skip。

安全约束：

- 修复目标必须位于 `project_root` 内（拒绝路径穿越）。
- 现有文件修复：应用前检查 review 中记录的 expected 内容仍存在，避免 stale patch 覆盖用户新改动。
- 新建文件修复（如测试骨架）：检查目标文件不存在才创建，拒绝覆盖已有文件。
- 修复后更新 review JSON 中的 applied 状态。

当前边界：

- 不做跨文件自动重构。
- 不自动修复复杂安全问题。
- 不对非 Python secret 赋值做自动替换。
- 不自动编写真实测试逻辑（仅生成 skip 骨架）。

## 前端 Workbench

主要文件：

- `frontend/src/app/workspace/coding/page.tsx`
- `frontend/src/app/workspace/coding/[projectId]/page.tsx`
- `frontend/src/components/workspace/coding/coding-workbench.tsx`
- `frontend/src/components/workspace/coding/agent-panel.tsx`
- `frontend/src/components/workspace/coding/file-explorer.tsx`
- `frontend/src/components/workspace/coding/code-viewer.tsx`
- `frontend/src/components/workspace/coding/coding-diff-panel.tsx`
- `frontend/src/components/workspace/coding/coding-task-changes-panel.tsx`
- `frontend/src/components/workspace/coding/coding-results-panel.tsx`
- `frontend/src/components/workspace/coding/review-panel.tsx`
- `frontend/src/components/workspace/coding/diff-view.tsx`

当前 UI 是三栏工作台：

- **左侧**：项目文件树，支持文件/目录拖放到右侧对话栏。
- **中间**：代码、任务变更、项目 Diff、结果、Code Review。
- **右侧**：Agent Inspector，包含对话、事件、Session、ROI、流程、Skills。

关键交互：

- 结果文件不再弹出到最右侧挤压布局，而是在中间结果 tab 内展示。
- 右侧 `AgentPanel` 持久挂载，切换事件、Session、ROI、流程、Skills 不会卸载对话组件，也不会中断当前任务。
- Code Review 已从左上角工具组迁移到中间/右侧工作流中，避免和浏览器按钮组混杂。
- Workflow 面板从 Skills 面板中拆出，Skills 面板只展示技能简介和启用状态。

## Diff 与 Review 联动

中间代码区域支持：

- 单文件 diff 和全量 diff。
- side-by-side / unified 模式。
- 从 review finding 聚焦到对应文件、任务和行。
- 高亮 review 指向的变更行。
- Task Changes 与 Project Diff 在文件维度联动。

这使 Coding Agent 的核心界面从“看代码”升级为“看 agent 对项目造成的具体影响”。

## Workflow 面板

Workflow 面板用于把从零开始落地项目的过程拆成可执行阶段：

- 需求
- 设计
- 初始化
- 实现
- 验证
- 审查
- 交付

每个阶段包含目标、状态和可复制提示词。它不再混在 Skills 面板中，避免技能说明和任务流程混淆。

**冷启动**：当 Agent 首次为某 project 构建 dynamic context 且 `current_stage` 仍为空时，`_build_delivery_stage_section` 会自动把项目初始化到「需求」阶段（`source=agent_accepted`），用户无需手动点击即可开始。后续的顺向转移（如需求→设计）在 `auto_accept_forward_stage=true` 时同样自动推进；回退、跳级、进入「交付」阶段仍需人工确认。

## 验证覆盖

后端相关测试：

- `backend/tests/test_qiongqi_engine.py`
- `backend/tests/test_qiongqi_session_persistence.py`
- `backend/tests/test_qiongqi_change_tracking.py`
- `backend/tests/test_qiongqi_events_contract.py`
- `backend/tests/test_qiongqi_roi_telemetry.py`
- `backend/tests/test_qiongqi_skill_runtime_v2.py`
- `backend/tests/test_coding_core_skills.py`
- `backend/tests/test_coding_skills_router.py`
- `backend/tests/test_coding_project_diff.py`
- `backend/tests/test_coding_review.py`
- `backend/tests/test_coding_agent_isolation.py`

前端相关测试：

- `frontend/tests/unit/core/coding-workbench-layout.test.ts`
- `frontend/tests/unit/core/coding-inspector-api.test.ts`
- `frontend/tests/unit/core/coding-diff.test.ts`
- `frontend/tests/unit/core/coding-task-changes.test.ts`
- `frontend/tests/unit/core/coding-code-viewer.test.ts`
- `frontend/tests/unit/core/coding-artifacts-layout.test.ts`
- `frontend/tests/unit/core/coding-drag-drop.test.ts`

常用验证命令：

```bash
uv run pytest tests/test_coding_review.py tests/test_coding_core_skills.py tests/test_coding_skills_router.py -q
pnpm --dir frontend exec vitest run tests/unit/core/coding-workbench-layout.test.ts tests/unit/core/coding-inspector-api.test.ts tests/unit/core/coding-diff.test.ts tests/unit/core/coding-task-changes.test.ts
pnpm --dir frontend run typecheck
```

## 当前边界与后续方向

当前已经完成的核心能力：

- 独立 QiongqiEngine（含 stable prompt 核心操作准则 + dynamic context 阶段探针 + 项目遥测）。
- Coding session/memory/scratch 隔离。
- Coding-only skills registry（含语义激活：同义词映射 + 描述 token 重叠）。
- 59 个内置 Coding skills。
- 项目文件浏览、代码查看、项目 diff。
- **符号级语义导航**（find_symbols / read_symbol，tree-sitter AST 后端 + 增强正则回退，支持 Python/JS-TS/Go/Rust）。
- **结构化重构工具**（rename_symbol token-boundary / extract_function，多语言函数语法：Python `def` / JS-TS `function` / Go `func` / Rust `fn`，**参数与返回值自动推断**：Python 用 `ast` 模块精确分析 Load/Store，JS-TS/Go/Rust 用启发式正则）。
- **编辑事务回滚**（EditSnapshotStore + undo_last_edit / list_edit_snapshots）。
- **PostEditVerifyMiddleware**（改→验证闭环）。
- **测试结果结构化解析**（pytest --json-report 优先 + jest + 多语言 linter 检测）。
- Qiongqi events、task changes、ROI。
- 基于 diff/task/events/PR context 的 Code Review。
- Python secret 场景的一键安全修复。
- 前端三栏 workbench、持久 AgentPanel、Workflow/Skills 分离。
- **项目交付阶段状态机**（7 阶段 `ProjectStageStore` 持久化 + `completion_signals` 驱动的 `suggest_delivery_stage` 主动提议 + 冷启动自动进入「需求」阶段 + `StageSuggestionBanner` 人工确认 / 可选 `auto_accept_forward_stage` 顺向自动确认 + `StageHistoryEntry` 携带 `thread_id`/`run_outcome` 可追溯 + auto-accept 路径自动从 `test_results` 提取 lint/test outcome 填充 + 前端「阶段流转历史」Timeline 可视化）。

后续可继续增强：

- 跨提交/跨分支的更复杂 PR 审查策略。
- Review finding 的精确行号映射和更细粒度 evidence。
- 项目私有 skills 的治理策略和导入/导出能力。
- rename_symbol 扩展为跨文件跨项目重命名（当前仅单文件）。

# 顶部任务标签无缝切换与任务不中断改造说明

## 背景

当前问题发生在 OClaw 整个系统顶部的任务标签栏，也就是 `WorkspaceTaskTabs` 管理的任务级标签之间切换。这里的标签不是 Coding Agent 工作台内部的面板 tab；Coding Agent 内部的 workflow、changes、review、ROI 等局部 tab 切换目前运行正常，不属于本计划要解决的问题。

顶部任务标签切换的典型场景包括：

- 一个 Coding 任务和一个普通对话任务之间来回切换。
- 两个普通对话任务之间来回切换。
- 一个 Agent 对话任务和一个 Coding 任务之间来回切换。
- 多个正在运行或刚运行结束的任务之间频繁切换。

当前 Web 端和桌面端的顶部任务标签，本质上仍然是路由切换。用户点击顶部任务标签时，Next.js 会切换到新的页面路由，原任务页面组件通常会卸载，新任务页面组件重新挂载。对于普通 Chat、Agent Chat、Coding Agent 这些不同任务实例，这会带来几个体验问题：

- 消息区可能短暂空白，需要重新从后端读取历史状态。
- 流式任务的前端连接会随页面卸载而断开，再依赖重连逻辑恢复。
- 与当前任务页面绑定的查询会重新发起，切换体验不够连续。
- 输入框草稿、消息滚动位置、任务页面局部状态等纯前端状态容易丢失。

已有的 `thread-state-store` 缓存桥接可以在组件重新挂载时恢复最近一次显示的消息状态，避免桌面端切顶部任务标签时明显白屏。但它仍是局部补丁：它只覆盖 thread 消息显示层，不能让后台任务流真正脱离页面生命周期，也不能覆盖不同任务类型各自的页面级查询和 UI 状态。

## 目标

改造目标是让用户在 Web 端和桌面端切换顶部任务标签时，感觉每个任务一直“停留在原处”：

- 切换到已打开的任务标签时，立即显示该任务最后一次可见状态。
- 正在运行的任务不因页面卸载或切换而中断。
- 切回运行中的任务时，页面展示最新进展，而不是重新冷启动。
- 后端仍作为最终事实来源，前端缓存只用于即时恢复和过渡展示。
- 普通 Chat、Agent Chat、Coding Agent 作为不同任务类型接入同一套任务级 runtime 设计，避免局部修补造成新的串线问题。

## 当前状态

### 已有能力

- `useThreadStream` 已支持 `reconnectOnMount` 和本地缓存桥接。
- 桌面端提交任务时使用 `onDisconnect: "continue"`，后端任务可以在前端连接断开后继续执行。
- `thread-state-store` 保存最近显示的 thread messages、values、isLoading 和 error。
- React Query 已经管理了部分数据缓存，例如 thread list、coding session 相关查询。
- `WorkspaceTaskTabs` 已有本地和远端持久化能力。

### 主要缺口

- stream 生命周期仍绑定在任务页面组件上，页面卸载会让 stream hook 销毁。
- 当前缓存主要覆盖消息区，不覆盖任务页面级查询和局部 UI 状态。
- 切换顶部任务标签时缺少统一的 task runtime snapshot，部分任务页面仍表现为重新加载。
- reconnect 是补救机制，不是主路径。用户切换频繁时仍会看到状态回补延迟。
- 各任务页面分别管理局部状态，缺少以 `taskId/threadId/projectId` 为 key 的全局运行态。

## 推荐架构

采用“即时快照恢复 + 全局运行时流管理”的两层方案。

### 第一层：Runtime Snapshot

为每个顶部任务标签对应的 workspace task 保存最近一次稳定展示状态。任务切换回来时，优先同步展示 snapshot，然后后台静默校验后端状态。

建议保存内容：

- thread display messages
- thread values、isLoading、error、lastRunId、lastUpdatedAt
- 任务类型特有的页面级查询结果，例如 Coding 任务的 session/events/changes/review/ROI，普通 Chat 的上传列表、artifact 列表等
- UI 本地状态：消息滚动位置、输入框草稿、任务页面局部选择状态
- 状态来源标记：`cache`、`live`、`revalidated`

这层主要解决“切换瞬间不白屏、不抖动、不像重新加载”。

### 第二层：Thread Runtime Hub

将 stream 连接从具体任务页面组件中提升到 workspace 级别的全局 runtime provider。任务页面组件只订阅某个 `taskId/threadId` 的状态，不直接拥有 stream 的生命周期。

概念结构：

```text
WorkspaceRuntimeProvider
  ├─ TaskRuntimeStore
  │   ├─ taskId -> task kind / href / visible snapshot
  │   ├─ taskId -> active route subscription
  │   └─ taskId -> local UI state
  ├─ ThreadRuntimeStore
  │   ├─ threadId -> display state
  │   ├─ threadId -> stream controller
  │   ├─ threadId -> active run metadata
  │   └─ threadId -> subscribers
  └─ TaskTypeSnapshotStore
      ├─ chat task -> uploads/artifacts/message UI state
      ├─ agent task -> agent context/query state
      └─ coding task -> session/events/changes/review/roi
```

页面切换时：

1. 当前任务页面取消可见订阅，但不销毁 task/thread runtime。
2. 新任务页面订阅目标 `taskId/threadId/projectId`。
3. runtime store 立即返回 snapshot。
4. 如果该 thread 有 active run，继续接收或恢复 stream。
5. 后台用后端状态静默校验 snapshot，并将差异合并到 UI。

这层主要解决“任务运行不依赖当前页面是否挂载”。

## 分阶段改造计划

### 阶段 1：补齐任务级快照层

目标：在不大改 stream 架构的前提下，先明显改善切换体验。

工作项：

- 为顶部任务标签建立稳定 `taskId` 到 runtime snapshot 的映射，避免只依赖组件实例状态。
- 扩展 `thread-state-store` 为 thread display snapshot，明确按 `threadId` 隔离。
- 为不同任务类型增加 snapshot adapter，例如 Chat、Agent Chat、Coding。
- 对任务页面级查询使用 `placeholderData` 或等效机制，切回任务时先展示上次数据，再静默刷新。
- 保存每个任务的消息滚动位置和输入框草稿。
- 标记 snapshot 是否 stale，但避免用显眼 loading 覆盖旧内容。

验收标准：

- 两个普通 Chat 任务标签来回切换不出现空消息区。
- Chat 与 Coding 任务标签来回切换时，各自优先展示上次任务状态。
- 切换到无缓存的新任务标签时仍走正常加载态。
- 不再出现跨任务显示上一条历史需求。

### 阶段 2：引入 Task/Thread Runtime Hub

目标：让运行中任务的前端 stream 脱离具体任务页面生命周期。

工作项：

- 新建 `WorkspaceRuntimeProvider`，挂在 workspace layout 内。
- 抽象 `TaskRuntime`：负责顶部任务标签的可见订阅、snapshot、local UI state。
- 抽象 `ThreadRuntime`：负责 submit、joinStream、reconnect、message merge、active run 状态。
- 将 `useThreadStream` 改造为订阅 runtime，而不是直接拥有 stream。
- 对运行中的 thread 保持 runtime controller；任务标签关闭或 TTL 到期后再清理。
- 为 web 和 desktop 分别处理页面隐藏、窗口后台、网络恢复事件。

验收标准：

- 正在运行的任务切到另一个顶部任务标签后，runtime 仍保持 active。
- 切回原任务标签时，消息已经更新到最新状态或立即开始补齐。
- 前端页面卸载不再是 stream 中断的主因。
- 任务失败、取消、完成状态能正确同步到所有订阅者。

### 阶段 3：补齐任务类型适配器

目标：让不同任务类型都能接入同一套顶部任务标签 runtime，而不是只优化某一种页面。

工作项：

- Chat adapter：消息、上传文件、artifact 状态、滚动位置、草稿。
- Agent Chat adapter：普通 Chat 状态 + agent context。
- Coding adapter：消息、coding session、events、changes、stage、review、ROI、项目到 thread 的映射。
- 对各任务类型的后台事件使用事件驱动刷新，减少切换时盲目 refetch。

验收标准：

- Chat/Agent/Coding 任意两种任务之间切换时，都能立即展示对应任务的上一帧状态。
- 后台任务产生新输出或文件变化时，切回后能看到最新变化，不需要手动刷新。
- 同一 Coding 项目不会出现多个组件持有不同 coding threadId 的状态分裂。

### 阶段 4：资源管理与清理策略

目标：避免全局 runtime 长期持有过多任务造成内存和连接压力。

建议策略：

- 最多保留最近 N 个 task runtime，默认 30（`thread-runtime-store.ts` 中的 `config.maxSnapshots`），略高于顶部 workspace task tabs 上限，为频繁切换留出余量。
- 已完成任务保留 snapshot，但释放 stream controller。
- 已关闭标签进入短 TTL，TTL 内可快速恢复，过期后只保留轻量 snapshot。
- 运行中任务不因标签关闭立刻取消，除非用户明确停止任务。
- 桌面端应用退出前尽量持久化 snapshot；任务继续交给后端运行和下次 reconnect。

## 风险与注意事项

- 必须严格按 `taskId`、`threadId`、`projectId` 隔离缓存，禁止组件实例级缓存跨任务复用。
- snapshot 只能作为过渡展示，后端状态仍是最终事实来源。
- stream hub 需要处理重复 submit、重复 join、409 active run 冲突等情况。
- Coding 任务的文件变化和 review/ROI 数据不能只靠定时刷新，最好由事件触发更新。
- Web 端浏览器标签页进入后台时，SSE 可能被浏览器节流，需要恢复策略。
- 桌面端窗口后台、系统休眠、App Nap 都可能导致连接断开，必须保持 runId 和 active run 发现能力。

## 测试计划

单元测试：

- thread snapshot 按 `threadId` 隔离，不串消息。
- task snapshot 按 `taskId` 隔离，不串任务页面状态。
- 切换顶部任务标签时，runtime subscriber 收到对应状态。
- active run 状态和 cached display state 合并顺序正确。
- 各任务类型 snapshot adapter 的数据按任务隔离。

集成测试：

- 普通 Chat：A/B 两个顶部任务标签来回切换，A 的消息不出现在 B。
- Agent Chat：带 `agent_name` 的路径和普通 chat 路径互不串线。
- Chat + Coding：Coding 任务运行时切到 Chat 任务，再切回 Coding，两个任务状态都不白屏、不串线。
- 运行中任务断开连接后，重新进入页面可以自动 join active run。

端到端测试：

- Web 端：打开两个顶部任务标签，任务 A 运行中切到任务 B，等待一段时间后切回 A，验证 A 有最新输出。
- 桌面端：切顶部 workspace task tab、最小化窗口、恢复窗口，验证任务不中断。
- 网络恢复：模拟 SSE 断开后恢复，验证 UI 能补齐状态且不重复消息。

## 当前实施状态

短期建议先完成阶段 1，成本低且能快速改善顶部任务标签切换的用户体感。中期推进阶段 2，将 stream 生命周期提升到全局 runtime，真正解决任务不中断和切换不重载。阶段 3 补齐 Chat、Agent Chat、Coding 三类任务适配器，确保不是只优化单一页面。阶段 4 用于控制长期运行后的资源占用。

第一轮修复已经落地以下内容：

- 所有 Web/桌面任务提交都使用 `onDisconnect: "continue"`，顶部任务标签切换导致页面卸载时，后端 run 不应被前端断连取消。
- 全局 React Query 增加短暂 `staleTime` 和较长 `gcTime`，任务标签来回切换时优先复用内存数据，减少每次点击都重新读后端状态。
- `useThreadStream` 在已有 thread display snapshot 时延迟自动历史拉取，先用本地快照恢复界面，用户需要更早历史时再触发加载。
- 修复 thread display snapshot 随 `threadId` 切换同步刷新，避免顶部任务之间串出上一条历史需求。
- Web 端切回任务时，如果 SDK 试图 join 一个已不在当前 worker 可订阅的旧 run，后端会返回 `HTTP 409: Run ... is not active on this worker and cannot be streamed`。前端现在会将其识别为过期 stream 重连 key，清理 `lg:stream:<threadId>` 并静默刷新任务状态，不再把它作为用户可见错误弹出。

第二阶段第一批基础设施已经落地以下内容：

- 新增 workspace 级 `WorkspaceRuntimeProvider`，挂载在 workspace 根内容区域，作为后续 Task/Thread Runtime Hub 的稳定生命周期边界。
- 新增 `ThreadRuntimeStore`，按 `threadId` 保存和发布 thread display snapshot，并通过 `useSyncExternalStore` 让不同页面实例订阅同一份运行态快照。
- `useThreadStream` 现在会优先读取 runtime snapshot，再退回本地 `thread-state-store` 缓存；每次 display state 更新时，同时发布到 runtime store 和本地缓存。
- runtime store 对 snapshot 做内容签名去重，避免 React 外部 store 因相同 display state 重复发布而触发渲染循环。
- 已补充单元测试覆盖 runtime snapshot 的按 `threadId` 隔离、订阅通知，以及 `useThreadStream` 将 display snapshot 发布到 workspace runtime store。

第二阶段后续增强已经落地以下内容：

- `WorkspaceRuntimeProvider` 现在会在 workspace 生命周期内后台扫描顶部任务标签，按任务解析出 runtime target。
- 对每个 runtime target，provider 会发现 active run，并从后端 run messages API 拉取最新消息，写入 workspace runtime snapshot。这样任务页面即使已经卸载，切回时也能优先看到后台 watcher 刷新的最新快照。
- 后台 watcher 在窗口 focus、页面 visibilitychange、定时刷新时都会运行，Web 端和桌面端都能在恢复可见时尽快补齐状态。
- 当前前台页面仍保留 `useStream` 作为 live stream 主路径；后台 watcher 负责页面卸载期间的状态追赶和切换恢复。这样避免一次性重写 SDK stream controller，同时解决顶部任务切换时最影响体验的冷启动和状态落后问题。

第三阶段任务类型适配已经落地以下内容：

- Chat/Agent 任务通过顶部任务标签中的 `threadId` 直接接入 runtime target。
- Coding 任务通过 `projectId` 和 `coding:thread:<projectId>` 持久化映射解析 runtime target；Coding Agent 创建或恢复 threadId 后会通知顶部任务标签同步当前 coding tab。
- Runtime refresh 会按任务类型刷新相关查询：Chat/Agent 刷新 thread run 和 thread list；Coding 额外刷新 project files、file、diff、coding projects、coding sessions，保证切回 Coding 任务时文件树、diff、stage、session 面板能尽快追上后端状态。

第四阶段资源管理已经落地以下内容：

- Thread runtime store 支持最大 snapshot 数量，超过容量时清理最旧的 snapshot。
- 已完成任务 snapshot 支持 TTL 过期清理；运行中的 snapshot 不会因 TTL 被清理。
- 顶部任务标签关闭时，会同步清理对应 thread runtime snapshot，避免关闭任务后仍长期占用内存。
- 相关行为已有单元测试覆盖，包括 thread 隔离、容量淘汰、TTL 清理、task adapter、后台 runtime refresh。

后续更激进的优化可以继续把 SDK `useStream` controller 完全迁入 workspace runtime，使前台页面只作为订阅者存在。但当前阶段二到四已经形成可用闭环：页面挂载时走 live stream，页面卸载时由 workspace runtime watcher 追赶 active run 状态，切回任务时优先展示最新 runtime snapshot，并按任务类型刷新派生 UI。

# TODO 列表

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
- [x] 为 memory retrieval 增加可查询统计与调试日志
- [x] 支持将 `.kkoclaw/agents/<name>` 自定义 agent 桥接为可由 `task` 调度的 subagent
- [x] 支持通过 `GATEWAY_WORKERS` 配置生产部署的 Gateway 并发数

## 计划功能

- [ ] 池化 sandbox 资源以减少 sandbox 容器数量
- [ ] 添加认证/授权层
- [ ] 实现速率限制
- [ ] 添加指标和监控
- [ ] 支持更多上传文档格式
- [ ] 技能市场/远程技能安装
- [ ] 优化 IM 渠道多任务场景下 agent 热路径的异步并发
- [ ] 将 `packages/harness/kkoclaw/sandbox/local/local_sandbox.py` 中的 `subprocess.run()` 替换为 `asyncio.create_subprocess_shell()`
  - 将社区工具（tavily、jina_ai、firecrawl、infoquest、image_search）中的同步 `requests` 替换为 `httpx.AsyncClient`
  - [x] 将 title_middleware 和 memory updater 中的同步 `model.invoke()` 替换为异步 `model.ainvoke()`
  - 考虑对剩余的阻塞文件 I/O 使用 `asyncio.to_thread()` 包装
  - 对于生产环境：使用 `langgraph up`（多 worker）替代 `langgraph dev`（单 worker）

## 已解决问题

- [x] 确保 `state.artifacts` 中没有重复文件
- [x] 思考过长但内容为空（答案在思考过程中）

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
- [x] 为 memory facts 增加 scope-aware 隔离，coding agent 仅注入 `global` + 当前 `coding_project` facts，普通对话保持 user-level 行为
- [x] 支持将 `.kkoclaw/agents/<name>` 自定义 agent 桥接为可由 `task` 调度的 subagent
- [x] 支持通过 `GATEWAY_WORKERS` 配置生产部署的 Gateway 并发数
- [x] subagent recursion_limit 公式可配置化（`recursion_limit_multiplier` × max_turns + `recursion_limit_base`，默认 `3*max_turns+20`）
- [x] 上游 DeerFlow `backend/app/` 模块全面同步（2025-05-29）
  - **用户隔离**：`paths.py` 新增 `user_agents_dir`/`user_agent_dir` 方法；`agents_config.py` 新增 `resolve_agent_dir()` 按用户优先解析 agent 目录，兼容 legacy 共享布局
  - **路由模块**：`agents.py` 完整支持 per-user agent 目录 + legacy 回退；`threads.py` 新增 metadata 过滤器验证（`InvalidMetadataFilterError`）；`runs.py` 使用 `wait_for_run_completion` 替代直接 `await task`
  - **上传安全**：`uploads.py` 新增 `_make_file_sandbox_readable`（Docker sandbox 文件可读性）+ `claim_unique_filename` 重复文件名去重
  - **安全增强**：`artifacts.py` 新增 `_read_skill_archive_member` ZIP 炸弹防护（16MB 限制）；`csrf_middleware.py` 新增 Origin 验证防 CSRF 登录攻击
  - **MCP 密钥脱敏**：`mcp.py` 重构为 `_mask_server_config` + `_merge_preserving_secrets`，保留 raw JSON `$VAR` 占位符
  - **auth 状态缓存**：`auth.py` setup-status 改为 TTL 缓存 + asyncio 去重，避免多标签页 429
  - **消息转换**：`services.py` 使用 `convert_to_messages` 保留 attachments 等字段，新增 `inject_authenticated_user_context` + model 验证 + `resolve_root_run_name`
  - **启动恢复**：`deps.py` 新增 `_mark_latest_recovered_threads_error`，Gateway 重启后自动恢复孤立运行并标记线程状态

## 计划功能
- [ ] Workflow 真正一键驱动 agent、复杂进度计算、更多浏览器截图验证，可以放到后续版本迭代
- [ ] 池化 sandbox 资源以减少 sandbox 容器数量
- [ ] 添加认证/授权层
- [ ] 实现速率限制
- [ ] 添加指标和监控
- [ ] 支持更多上传文档格式
- [ ] 技能市场/远程技能安装
- [ ] 优化 IM 渠道多任务场景下 agent 热路径的异步并发
- [ ] 将 `user/history` 摘要升级为 scope-aware 结构，避免项目级摘要继续写入全局用户背景
- [ ] 将 `packages/harness/kkoclaw/sandbox/local/local_sandbox.py` 中的 `subprocess.run()` 替换为 `asyncio.create_subprocess_shell()`
  - 将社区工具（tavily、jina_ai、firecrawl、infoquest、image_search）中的同步 `requests` 替换为 `httpx.AsyncClient`
  - [x] 将 title_middleware 和 memory updater 中的同步 `model.invoke()` 替换为异步 `model.ainvoke()`
  - 考虑对剩余的阻塞文件 I/O 使用 `asyncio.to_thread()` 包装
  - 对于生产环境：使用 `langgraph up`（多 worker）替代 `langgraph dev`（单 worker）

## 已解决问题

- [x] 确保 `state.artifacts` 中没有重复文件
- [x] 思考过长但内容为空（答案在思考过程中）

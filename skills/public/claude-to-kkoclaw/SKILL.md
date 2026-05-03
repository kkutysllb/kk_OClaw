---
name: claude-to-kkoclaw
description: "与 KKOCLAW AI 智能体平台通过 HTTP API 进行交互。当用户想要向 KKOCLAW 发送消息或问题进行研究和分析、启动 KKOCLAW 对话线程、检查 KKOCLAW 状态或健康、列出 KKOCLAW 中可用的模型/技能/智能体、管理 KKOCLAW 记忆、上传文件到 KKOCLAW 线程，或委托复杂研究任务时使用此技能。"
---

# KKOCLAW 技能

通过 HTTP API 与运行中的 KKOCLAW 实例进行通信。KKOCLAW 是一个基于 LangGraph 构建的 AI 智能体平台，
可编排子智能体进行研究、代码执行、网页浏览等任务。

## 架构

KKOCLAW 在 Nginx 反向代理后面暴露两个 API 接口：

| 服务          | 直接端口 | 通过代理                          | 用途                              |
|---------------|----------|-----------------------------------|-----------------------------------|
| Gateway API   | 8001     | `$KKOCLAW_GATEWAY_URL`           | REST 端点（模型、技能、记忆、上传）|
| LangGraph API | 2024     | `$KKOCLAW_LANGGRAPH_URL`         | 智能体线程、运行、流式传输         |

## 环境变量

所有 URL 可通过环境变量配置。**在发起任何请求之前先读取这些环境变量。**

| 变量                    | 默认值                                    | 描述                              |
|-------------------------|------------------------------------------|-----------------------------------|
| `KKOCLAW_URL`           | `http://localhost:9191`                  | 统一代理基础 URL                   |
| `KKOCLAW_GATEWAY_URL`   | `${KKOCLAW_URL}`                        | Gateway API 基础（模型、技能、记忆、上传）|
| `KKOCLAW_LANGGRAPH_URL` | `${KKOCLAW_URL}/api/langgraph`          | LangGraph API 基础（线程、运行）   |

进行 curl 调用时，始终按以下方式解析 URL：

```bash
# 从环境变量解析基础 URL（在任何 API 调用之前先执行此操作）
KKOCLAW_URL="${KKOCLAW_URL:-http://localhost:9191}"
KKOCLAW_GATEWAY_URL="${KKOCLAW_GATEWAY_URL:-$KKOCLAW_URL}"
KKOCLAW_LANGGRAPH_URL="${KKOCLAW_LANGGRAPH_URL:-$KKOCLAW_URL/api/langgraph}"
```

## 可用操作

### 1. 健康检查

验证 KKOCLAW 是否正在运行：

```bash
curl -s "$KKOCLAW_GATEWAY_URL/health"
```

### 2. 发送消息（流式传输）

这是主要操作。它创建一个线程并流式传输智能体的响应。

**步骤 1：创建线程**

```bash
curl -s -X POST "$KKOCLAW_LANGGRAPH_URL/threads" \
  -H "Content-Type: application/json" \
  -d '{}'
```

响应：`{"thread_id": "<uuid>", ...}`

**步骤 2：流式运行**

```bash
curl -s -N -X POST "$KKOCLAW_LANGGRAPH_URL/threads/<thread_id>/runs/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        {
          "type": "human",
          "content": [{"type": "text", "text": "你的消息内容"}]
        }
      ]
    },
    "stream_mode": ["values", "messages-tuple"],
    "stream_subgraphs": true,
    "config": {
      "recursion_limit": 1000
    },
    "context": {
      "thinking_enabled": true,
      "is_plan_mode": true,
      "subagent_enabled": true,
      "thread_id": "<thread_id>"
    }
  }'
```

响应是 SSE 流。每个事件格式如下：
```
event: <event_type>
data: <json_data>
```

关键事件类型：
- `metadata` — 运行元数据，包括 `run_id`
- `values` — 完整状态快照，包含 `messages` 数组
- `messages-tuple` — 增量消息更新（AI 文本块、工具调用、工具结果）
- `end` — 流结束

**上下文模式**（通过 `context` 设置）：
- 闪电模式：`thinking_enabled: false, is_plan_mode: false, subagent_enabled: false`
- 标准模式：`thinking_enabled: true, is_plan_mode: false, subagent_enabled: false`
- 专业模式：`thinking_enabled: true, is_plan_mode: true, subagent_enabled: false`
- 超级模式：`thinking_enabled: true, is_plan_mode: true, subagent_enabled: true`

### 3. 继续对话

要发送后续消息，复用步骤 2 中的同一个 `thread_id`，并用新消息 POST 另一个运行。

### 4. 列出模型

```bash
curl -s "$KKOCLAW_GATEWAY_URL/api/models"
```

返回：`{"models": [{"name": "...", "provider": "...", ...}, ...]}`

### 5. 列出技能

```bash
curl -s "$KKOCLAW_GATEWAY_URL/api/skills"
```

返回：`{"skills": [{"name": "...", "enabled": true, ...}, ...]}`

### 6. 启用/禁用技能

```bash
curl -s -X PUT "$KKOCLAW_GATEWAY_URL/api/skills/<skill_name>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### 7. 列出智能体

```bash
curl -s "$KKOCLAW_GATEWAY_URL/api/agents"
```

返回：`{"agents": [{"name": "...", ...}, ...]}`

### 8. 获取记忆

```bash
curl -s "$KKOCLAW_GATEWAY_URL/api/memory"
```

返回用户上下文、事实和对话历史摘要。

### 9. 上传文件到线程

```bash
curl -s -X POST "$KKOCLAW_GATEWAY_URL/api/threads/<thread_id>/uploads" \
  -F "files=@/path/to/file.pdf"
```

支持 PDF、PPTX、XLSX、DOCX — 自动转换为 Markdown。

### 10. 列出已上传文件

```bash
curl -s "$KKOCLAW_GATEWAY_URL/api/threads/<thread_id>/uploads/list"
```

### 11. 获取线程历史

```bash
curl -s "$KKOCLAW_LANGGRAPH_URL/threads/<thread_id>/history"
```

### 12. 列出线程

```bash
curl -s -X POST "$KKOCLAW_LANGGRAPH_URL/threads/search" \
  -H "Content-Type: application/json" \
  -d '{"limit": 20, "sort_by": "updated_at", "sort_order": "desc"}'
```

## 使用脚本

要发送消息并收集完整响应，使用辅助脚本：

```bash
bash /path/to/skills/claude-to-kkoclaw/scripts/chat.sh "你的问题"
```

参见 `scripts/chat.sh` 了解实现。该脚本：
1. 检查健康状态
2. 创建线程
3. 流式运行并收集最终 AI 响应
4. 打印结果

## 解析 SSE 输出

流返回 SSE 事件。要从 `values` 事件中提取最终 AI 响应：
- 查找最后一个 `event: values` 块
- 解析其 `data` JSON
- `messages` 数组包含所有消息；最后一条 `type: "ai"` 的是响应
- 该消息的 `content` 字段是 AI 的文本回复

## 错误处理

- 如果健康检查失败，KKOCLAW 未运行。通知用户需要启动它。
- 如果流返回错误事件，提取并显示错误消息。
- 常见问题：端口未开放、服务仍在启动中、配置错误。

## 提示

- 快速问题使用闪电模式（最快，无规划）。
- 研究任务使用专业或超级模式（启用规划和子智能体）。
- 可以先上传文件，然后在消息中引用。
- 线程 ID 持久存在 — 你可以稍后返回继续对话。

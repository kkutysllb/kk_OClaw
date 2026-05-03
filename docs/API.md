# API 参考

本文档提供了 KKOCLAW 后端 API 的完整参考。

## 概述

KKOCLAW 后端提供两组 API：

1. **LangGraph API** - Agent 交互、线程和流式传输（`/api/langgraph/*`）
2. **网关 API** - 模型、MCP、技能、上传和制品（`/api/*`）

所有 API 均可通过 Nginx 反向代理（端口 2026）访问。

## LangGraph API

基础 URL：`/api/langgraph`

LangGraph API 由 LangGraph 服务器提供，遵循 LangGraph SDK 约定。

### 线程

#### 创建线程

```http
POST /api/langgraph/threads
Content-Type: application/json
```

**请求体：**
```json
{
  "metadata": {}
}
```

**响应：**
```json
{
  "thread_id": "abc123",
  "created_at": "2024-01-15T10:30:00Z",
  "metadata": {}
}
```

#### 获取线程状态

```http
GET /api/langgraph/threads/{thread_id}/state
```

**响应：**
```json
{
  "values": {
    "messages": [...],
    "sandbox": {...},
    "artifacts": [...],
    "thread_data": {...},
    "title": "对话标题"
  },
  "next": [],
  "config": {...}
}
```

### 运行

#### 创建运行

使用输入执行 Agent。

```http
POST /api/langgraph/threads/{thread_id}/runs
Content-Type: application/json
```

**请求体：**
```json
{
  "input": {
    "messages": [
      {
        "role": "user",
        "content": "你好，能帮我吗？"
      }
    ]
  },
  "config": {
    "recursion_limit": 100,
    "configurable": {
      "model_name": "gpt-4",
      "thinking_enabled": false,
      "is_plan_mode": false
    }
  },
  "stream_mode": ["values", "messages-tuple", "custom"]
}
```

**流模式兼容性：**
- 可用模式：`values`、`messages-tuple`、`custom`、`updates`、`events`、`debug`、`tasks`、`checkpoints`
- 请勿使用：`tools`（在当前版本 `langgraph-api` 中已弃用/无效，会触发架构验证错误）

**递归限制：**

`config.recursion_limit` 限制了 LangGraph 在单次运行中执行的图步数上限。`/api/langgraph/*` 端点直接访问 LangGraph 服务器，因此继承 LangGraph 原生默认值 **25**，这对于计划模式或子 Agent 密集型运行来说过低——Agent 通常在子 Agent 结果返回后的第一轮交互中因 `GraphRecursionError` 而报错，主 Agent 还没来得及综合最终答案。

KKOCLAW 自己的网关和 IM 通道路径通过在 `build_run_config` 中默认设置为 `100`（参见 `backend/app/gateway/services.py`）来缓解此问题，但直接调用 LangGraph API 的客户端必须在请求体中显式设置 `recursion_limit`。`100` 与网关默认值一致，是一个安全的起点；如果运行深度嵌套的子 Agent 图，可以适当增加该值。

**可配置选项：**
- `model_name`（字符串）：覆盖默认模型
- `thinking_enabled`（布尔值）：为支持的模型启用扩展思考
- `is_plan_mode`（布尔值）：启用 TodoList 中间件进行任务跟踪

**响应：** 服务器推送事件（SSE）流

```
event: values
data: {"messages": [...], "title": "..."}

event: messages
data: {"content": "你好！我很乐意帮忙。", "role": "assistant"}

event: end
data: {}
```

#### 获取运行历史

```http
GET /api/langgraph/threads/{thread_id}/runs
```

**响应：**
```json
{
  "runs": [
    {
      "run_id": "run123",
      "status": "success",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### 流式运行

实时流式传输响应。

```http
POST /api/langgraph/threads/{thread_id}/runs/stream
Content-Type: application/json
```

请求体与创建运行相同。返回 SSE 流。

---

## 网关 API

基础 URL：`/api`

### 模型

#### 列出模型

获取配置中所有可用的 LLM 模型。

```http
GET /api/models
```

**响应：**
```json
{
  "models": [
    {
      "name": "gpt-4",
      "display_name": "GPT-4",
      "supports_thinking": false,
      "supports_vision": true
    },
    {
      "name": "claude-3-opus",
      "display_name": "Claude 3 Opus",
      "supports_thinking": false,
      "supports_vision": true
    },
    {
      "name": "deepseek-v3",
      "display_name": "DeepSeek V3",
      "supports_thinking": true,
      "supports_vision": false
    }
  ]
}
```

#### 获取模型详情

```http
GET /api/models/{model_name}
```

**响应：**
```json
{
  "name": "gpt-4",
  "display_name": "GPT-4",
  "model": "gpt-4",
  "max_tokens": 4096,
  "supports_thinking": false,
  "supports_vision": true
}
```

### MCP 配置

#### 获取 MCP 配置

获取当前的 MCP 服务器配置。

```http
GET /api/mcp/config
```

**响应：**
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "***"
      },
      "description": "GitHub 操作"
    },
    "filesystem": {
      "enabled": false,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "description": "文件系统访问"
    }
  }
}
```

#### 更新 MCP 配置

更新 MCP 服务器配置。

```http
PUT /api/mcp/config
Content-Type: application/json
```

**请求体：**
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      },
      "description": "GitHub 操作"
    }
  }
}
```

**响应：**
```json
{
  "success": true,
  "message": "MCP 配置已更新"
}
```

### 技能

#### 列出技能

获取所有可用的技能。

```http
GET /api/skills
```

**响应：**
```json
{
  "skills": [
    {
      "name": "pdf-processing",
      "display_name": "PDF 处理",
      "description": "高效处理 PDF 文档",
      "enabled": true,
      "license": "MIT",
      "path": "public/pdf-processing"
    },
    {
      "name": "frontend-design",
      "display_name": "前端设计",
      "description": "设计和构建前端界面",
      "enabled": false,
      "license": "MIT",
      "path": "public/frontend-design"
    }
  ]
}
```

#### 获取技能详情

```http
GET /api/skills/{skill_name}
```

**响应：**
```json
{
  "name": "pdf-processing",
  "display_name": "PDF 处理",
  "description": "高效处理 PDF 文档",
  "enabled": true,
  "license": "MIT",
  "path": "public/pdf-processing",
  "allowed_tools": ["read_file", "write_file", "bash"],
  "content": "# PDF 处理\n\nAgent 指令..."
}
```

#### 启用技能

```http
POST /api/skills/{skill_name}/enable
```

**响应：**
```json
{
  "success": true,
  "message": "技能 'pdf-processing' 已启用"
}
```

#### 禁用技能

```http
POST /api/skills/{skill_name}/disable
```

**响应：**
```json
{
  "success": true,
  "message": "技能 'pdf-processing' 已禁用"
}
```

#### 安装技能

从 `.skill` 文件安装技能。

```http
POST /api/skills/install
Content-Type: multipart/form-data
```

**请求体：**
- `file`：要安装的 `.skill` 文件

**响应：**
```json
{
  "success": true,
  "message": "技能 'my-skill' 安装成功",
  "skill": {
    "name": "my-skill",
    "display_name": "我的技能",
    "path": "custom/my-skill"
  }
}
```

### 文件上传

#### 上传文件

向线程上传一个或多个文件。

```http
POST /api/threads/{thread_id}/uploads
Content-Type: multipart/form-data
```

**请求体：**
- `files`：要上传的一个或多个文件

**响应：**
```json
{
  "success": true,
  "files": [
    {
      "filename": "document.pdf",
      "size": 1234567,
      "path": ".kkoclaw/threads/abc123/user-data/uploads/document.pdf",
      "virtual_path": "/mnt/user-data/uploads/document.pdf",
      "artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf",
      "markdown_file": "document.md",
      "markdown_path": ".kkoclaw/threads/abc123/user-data/uploads/document.md",
      "markdown_virtual_path": "/mnt/user-data/uploads/document.md",
      "markdown_artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.md"
    }
  ],
  "message": "成功上传 1 个文件"
}
```

**支持的文档格式**（自动转换为 Markdown）：
- PDF（`.pdf`）
- PowerPoint（`.ppt`、`.pptx`）
- Excel（`.xls`、`.xlsx`）
- Word（`.doc`、`.docx`）

#### 列出已上传文件

```http
GET /api/threads/{thread_id}/uploads/list
```

**响应：**
```json
{
  "files": [
    {
      "filename": "document.pdf",
      "size": 1234567,
      "path": ".kkoclaw/threads/abc123/user-data/uploads/document.pdf",
      "virtual_path": "/mnt/user-data/uploads/document.pdf",
      "artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf",
      "extension": ".pdf",
      "modified": 1705997600.0
    }
  ],
  "count": 1
}
```

#### 删除文件

```http
DELETE /api/threads/{thread_id}/uploads/{filename}
```

**响应：**
```json
{
  "success": true,
  "message": "已删除 document.pdf"
}
```

### 线程清理

在删除 LangGraph 线程后，移除 `.kkoclaw/threads/{thread_id}` 下的 KKOCLAW 管理的本地线程文件。

```http
DELETE /api/threads/{thread_id}
```

**响应：**
```json
{
  "success": true,
  "message": "已删除 abc123 的本地线程数据"
}
```

**错误行为：**
- 无效的线程 ID 返回 `422`
- `500` 返回通用 `{"detail": "删除本地线程数据失败。"}` 响应，完整异常详情保留在服务器日志中

### 制品

#### 获取制品

下载或查看 Agent 生成的制品。

```http
GET /api/threads/{thread_id}/artifacts/{path}
```

**路径示例：**
- `/api/threads/abc123/artifacts/mnt/user-data/outputs/result.txt`
- `/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf`

**查询参数：**
- `download`（布尔值）：如果为 `true`，强制下载并添加 Content-Disposition 头

**响应：** 文件内容及相应的 Content-Type

---

## 错误响应

所有 API 以统一格式返回错误：

```json
{
  "detail": "描述出错信息的错误消息"
}
```

**HTTP 状态码：**
- `400` - 错误请求：无效输入
- `404` - 未找到：资源不存在
- `422` - 校验错误：请求校验失败
- `500` - 服务器内部错误：服务端错误

---

## 认证

目前，KKOCLAW 未实现认证机制。所有 API 无需凭据即可访问。

注意：这里是指 KKOCLAW API 认证。MCP 出站连接仍可为配置的 HTTP/SSE MCP 服务器使用 OAuth。

对于生产环境部署，建议：
1. 使用 Nginx 实现基本认证或 OAuth 集成
2. 部署在 VPN 或私有网络后
3. 实现自定义认证中间件

---

## 速率限制

默认情况下未实现速率限制。对于生产环境部署，请在 Nginx 中配置速率限制：

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://backend;
}
```

---

## WebSocket 支持

LangGraph 服务器支持 WebSocket 连接，用于实时流式传输。连接到：

```
ws://localhost:2026/api/langgraph/threads/{thread_id}/runs/stream
```

---

## SDK 使用

### Python（LangGraph SDK）

```python
from langgraph_sdk import get_client

client = get_client(url="http://localhost:2026/api/langgraph")

# 创建线程
thread = await client.threads.create()

# 运行 Agent
async for event in client.runs.stream(
    thread["thread_id"],
    "lead_agent",
    input={"messages": [{"role": "user", "content": "你好"}]},
    config={"configurable": {"model_name": "gpt-4"}},
    stream_mode=["values", "messages-tuple", "custom"],
):
    print(event)
```

### JavaScript/TypeScript

```typescript
// 使用 fetch 调用网关 API
const response = await fetch('/api/models');
const data = await response.json();
console.log(data.models);

// 使用 EventSource 进行流式传输
const eventSource = new EventSource(
  `/api/langgraph/threads/${threadId}/runs/stream`
);
eventSource.onmessage = (event) => {
  console.log(JSON.parse(event.data));
};
```

### cURL 示例

```bash
# 列出模型
curl http://localhost:2026/api/models

# 获取 MCP 配置
curl http://localhost:2026/api/mcp/config

# 上传文件
curl -X POST http://localhost:2026/api/threads/abc123/uploads \
  -F "files=@document.pdf"

# 启用技能
curl -X POST http://localhost:2026/api/skills/pdf-processing/enable

# 创建线程并运行 Agent
curl -X POST http://localhost:2026/api/langgraph/threads \
  -H "Content-Type: application/json" \
  -d '{}'

curl -X POST http://localhost:2026/api/langgraph/threads/abc123/runs \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"messages": [{"role": "user", "content": "你好"}]},
    "config": {
      "recursion_limit": 100,
      "configurable": {"model_name": "gpt-4"}
    }
  }'
```

> `/api/langgraph/*` 端点绕过 KKOCLAW 的网关，直接继承 LangGraph 原生的 `recursion_limit` 默认值 25，这对于计划模式或子 Agent 运行来说过低。请显式设置 `config.recursion_limit`——详见[创建运行](#创建运行)部分。

# MCP（模型上下文协议）配置

KKOCLAW 支持可配置的 MCP 服务器和技能来扩展其能力，它们从项目根目录中的专用 `extensions_config.json` 文件加载。

## 设置

1. 将 `extensions_config.example.json` 复制到项目根目录的 `extensions_config.json`。
   ```bash
   # 复制示例配置
   cp extensions_config.example.json extensions_config.json
   ```

2. 通过设置 `"enabled": true` 启用所需的 MCP 服务器或技能。
3. 根据需要配置每个服务器的命令、参数和环境变量。
4. 重启应用程序以加载和注册 MCP 工具。

## OAuth 支持（HTTP/SSE MCP 服务器）

对于 `http` 和 `sse` MCP 服务器，KKOCLAW 支持 OAuth token 获取和自动 token 刷新。

- 支持的授权模式：`client_credentials`、`refresh_token`
- 在 `extensions_config.json` 中配置每个服务器的 `oauth` 块
- 密钥应通过环境变量提供（例如：`$MCP_OAUTH_CLIENT_SECRET`）

示例：

```json
{
   "mcpServers": {
      "secure-http-server": {
         "enabled": true,
         "type": "http",
         "url": "https://api.example.com/mcp",
         "oauth": {
            "enabled": true,
            "token_url": "https://auth.example.com/oauth/token",
            "grant_type": "client_credentials",
            "client_id": "$MCP_OAUTH_CLIENT_ID",
            "client_secret": "$MCP_OAUTH_CLIENT_SECRET",
            "scope": "mcp.read",
            "refresh_skew_seconds": 60
         }
      }
   }
}
```

## 自定义工具拦截器

你可以注册在每次 MCP 工具调用前运行的自定义拦截器。这对注入每请求头部（例如来自 LangGraph 执行上下文的用户认证 token）、日志记录或指标收集非常有用。

使用 `mcpInterceptors` 字段在 `extensions_config.json` 中声明拦截器：

```json
{
  "mcpInterceptors": [
    "my_package.mcp.auth:build_auth_interceptor"
  ],
  "mcpServers": { ... }
}
```

每个条目是一个 `module:variable` 格式的 Python 导入路径（通过 `resolve_variable` 解析）。该变量必须是一个**无参构建函数**，返回与 `MultiServerMCPClient` 的 `tool_interceptors` 接口兼容的异步拦截器，或返回 `None` 以跳过。

从 LangGraph 元数据注入认证头部的示例拦截器：

```python
def build_auth_interceptor():
    async def interceptor(request, handler):
        from langgraph.config import get_config
        metadata = get_config().get("metadata", {})
        headers = dict(request.headers or {})
        if token := metadata.get("auth_token"):
            headers["X-Auth-Token"] = token
        return await handler(request.override(headers=headers))
    return interceptor
```

- 单个字符串值会被接受并标准化为单元素列表。
- 无效路径或构建函数失败会记录警告，不会阻塞其他拦截器。
- 构建函数返回值必须是 `callable`；非 callable 值会被跳过并发出警告。

## 工作原理

MCP 服务器公开的工具会在运行时自动发现并集成到 KKOCLAW 的 Agent 系统中。启用后，这些工具无需额外代码变更即可供 Agent 使用。

## 能力示例

MCP 服务器可以提供以下访问能力：

- **文件系统**
- **数据库**（例如 PostgreSQL）
- **外部 API**（例如 GitHub、Brave Search）
- **浏览器自动化**（例如 Puppeteer）
- **自定义 MCP 服务器实现**

## 了解更多

有关模型上下文协议的详细文档，请访问：
https://modelcontextprotocol.io

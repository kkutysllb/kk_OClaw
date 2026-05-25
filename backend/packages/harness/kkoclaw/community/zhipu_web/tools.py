"""
Zhipu Web Search & Fetch Tools - Search and fetch web content via Zhipu MCP gateway.

Uses ZHIPU_API_KEY to authenticate with Zhipu's MCP gateway (open.bigmodel.cn),
which provides web_search_prime and webReader tools powered by domestic Chinese
search infrastructure.

Requires ZHIPU_API_KEY environment variable.
"""

import json
import logging
import os
import re
import time
from typing import Any

import httpx
from langchain.tools import tool

logger = logging.getLogger(__name__)

# Zhipu MCP gateway endpoints
_SEARCH_MCP_URL = "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"
_READER_MCP_URL = "https://open.bigmodel.cn/api/mcp/web_reader/mcp"

# Session cache: {url: (session_id, expire_time)}
_session_cache: dict[str, tuple[str, float]] = {}
_SESSION_TTL = 300  # 5 minutes


def _get_api_key() -> str | None:
    """Get Zhipu API key from environment."""
    return os.getenv("ZHIPU_API_KEY")


def _parse_sse_data(response_text: str) -> dict[str, Any]:
    """Parse SSE (Server-Sent Events) response from MCP gateway.

    The response format is:
        id:1
        event:message
        data:{"jsonrpc":"2.0",...}
    """
    for line in response_text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            json_str = line[5:].strip()
            if json_str:
                return json.loads(json_str)
    raise ValueError("No data line found in SSE response")


def _init_mcp_session(mcp_url: str, api_key: str) -> str:
    """Initialize an MCP session and return the session ID.

    Caches sessions for _SESSION_TTL seconds to avoid repeated initialization.
    """
    now = time.time()
    cached = _session_cache.get(mcp_url)
    if cached and cached[1] > now:
        return cached[0]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    payload = {
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "kkoclaw", "version": "1.0"},
        },
        "id": 0,
    }

    response = httpx.post(mcp_url, headers=headers, json=payload, timeout=15)
    response.raise_for_status()

    # Extract session ID from response headers
    session_id = response.headers.get("mcp-session-id", "")
    if not session_id:
        raise ValueError("MCP gateway did not return a session ID")

    _session_cache[mcp_url] = (session_id, now + _SESSION_TTL)
    logger.debug(f"MCP session initialized for {mcp_url}: {session_id[:8]}...")
    return session_id


def _mcp_tool_call(
    mcp_url: str,
    tool_name: str,
    arguments: dict[str, Any],
    api_key: str,
    timeout: int = 30,
) -> dict[str, Any]:
    """Call an MCP tool and return the parsed result.

    Handles session initialization transparently.
    """
    session_id = _init_mcp_session(mcp_url, api_key)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Session-Id": session_id,
    }
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
        "id": 1,
    }

    response = httpx.post(mcp_url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()

    result = _parse_sse_data(response.text)

    if "error" in result:
        error = result["error"]
        raise RuntimeError(f"MCP error {error.get('code')}: {error.get('message')}")

    # Check for isError flag
    rpc_result = result.get("result", {})
    if rpc_result.get("isError"):
        error_text = ""
        for content in rpc_result.get("content", []):
            if content.get("type") == "text":
                error_text += content.get("text", "")
        raise RuntimeError(f"MCP tool error: {error_text}")

    return rpc_result


def _extract_text(result: dict[str, Any]) -> str:
    """Extract text content from MCP tool result."""
    for content in result.get("content", []):
        if content.get("type") == "text":
            return content.get("text", "")
    return ""


def _search_web(query: str, count: int = 10, location: str = "cn") -> list[dict]:
    """Execute web search using Zhipu's web_search_prime MCP tool.

    Args:
        query: Search query string.
        count: Maximum number of results.
        location: Search region, default "cn" for China.

    Returns:
        List of search result dicts with title, url, snippet.
    """
    api_key = _get_api_key()
    if not api_key:
        logger.error("ZHIPU_API_KEY not set. Cannot perform web search.")
        return []

    try:
        result = _mcp_tool_call(
            _SEARCH_MCP_URL,
            "web_search_prime",
            {"search_query": query, "location": location},
            api_key,
            timeout=30,
        )

        text = _extract_text(result)
        if not text:
            logger.warning("Empty response from web_search_prime")
            return []

        # The text is a JSON-encoded string (double-encoded)
        # First strip surrounding quotes if present
        raw_text = text.strip()
        if raw_text.startswith('"') and raw_text.endswith('"'):
            raw_text = json.loads(raw_text)

        search_results = json.loads(raw_text)

        # Normalize results to standard format
        normalized = []
        for item in search_results[:count]:
            normalized.append({
                "title": item.get("title", ""),
                "url": item.get("link", item.get("url", "")),
                "snippet": item.get("content", item.get("snippet", "")),
            })
        return normalized

    except Exception as e:
        logger.error(f"Zhipu web search failed: {e}")
        # Clear cached session on error (might be expired)
        _session_cache.pop(_SEARCH_MCP_URL, None)
        return []


@tool("web_search", parse_docstring=True)
def web_search_tool(
    query: str,
    max_results: int = 5,
) -> str:
    """Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.

    Args:
        query: Search keywords describing what you want to find. Be specific for better results.
        max_results: Maximum number of results to return. Default is 5.
    """
    config = get_app_config().get_tool_config("web_search")

    location = "cn"
    if config is not None and "location" in config.model_extra:
        location = config.model_extra.get("location", location)
    if config is not None and "max_results" in config.model_extra:
        max_results = config.model_extra.get("max_results", max_results)

    results = _search_web(query=query, count=max_results, location=location)

    if not results:
        return json.dumps({
            "error": "No results found",
            "query": query,
            "suggestion": "Web search may be temporarily unavailable. Try rephrasing your query.",
        }, ensure_ascii=False)

    output = {
        "query": query,
        "total_results": len(results),
        "results": results,
    }

    return json.dumps(output, indent=2, ensure_ascii=False)


@tool("web_fetch", parse_docstring=True)
async def web_fetch_tool(url: str) -> str:
    """Fetch the contents of a web page at a given URL.
    Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.
    This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.
    Do NOT add www. to URLs that do NOT have them.
    URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.

    Args:
        url: The URL to fetch the contents of.
    """
    api_key = _get_api_key()
    if not api_key:
        return "Error: ZHIPU_API_KEY not set. Cannot fetch web content."

    timeout = 30
    config = get_app_config().get_tool_config("web_fetch")
    if config is not None and "timeout" in config.model_extra:
        timeout = config.model_extra.get("timeout")

    try:
        # Use sync httpx in a thread-safe manner for the MCP call
        import asyncio

        result = await asyncio.to_thread(
            _mcp_tool_call,
            _READER_MCP_URL,
            "webReader",
            {"url": url, "return_format": "markdown"},
            api_key,
            timeout,
        )

        text = _extract_text(result)
        if not text:
            return "Error: Empty response from web reader."

        # The text is a JSON-encoded string (double-encoded)
        raw_text = text.strip()
        if raw_text.startswith('"') and raw_text.endswith('"'):
            raw_text = json.loads(raw_text)

        page_data = json.loads(raw_text)

        # Extract the main content
        content = page_data.get("content", "")
        title = page_data.get("title", "")

        if not content:
            return json.dumps(page_data, indent=2, ensure_ascii=False)

        # Format with title
        if title:
            return f"# {title}\n\n{content[:8192]}"
        return content[:8192]

    except Exception as e:
        # Clear cached session on error
        _session_cache.pop(_READER_MCP_URL, None)
        return f"Error: Failed to fetch URL: {e}"


# Lazy import to avoid circular dependency
def get_app_config():
    from kkoclaw.config import get_app_config

    return get_app_config()

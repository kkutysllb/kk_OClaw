"""Runtime tool policy for Coding skills."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

logger = logging.getLogger(__name__)


class CodingToolPolicyMiddleware(AgentMiddleware[AgentState]):
    """Restrict tools when active Coding skills declare allowed tool names."""

    def __init__(self, active_skill_policy_resolver: Callable[[object], list[dict]]):
        super().__init__()
        self._active_skill_policy_resolver = active_skill_policy_resolver

    def _allowed_tool_names(self, state: object) -> set[str] | None:
        allowed: set[str] = set()
        has_policy = False
        for active in self._active_skill_policy_resolver(state):
            raw_tools = active.get("allowed_tools") if isinstance(active, dict) else None
            if not raw_tools:
                continue
            has_policy = True
            allowed.update(str(tool) for tool in raw_tools if str(tool))
        return allowed if has_policy else None

    def _denied_permissions(self, state: object) -> set[str]:
        denied: set[str] = set()
        for active in self._active_skill_policy_resolver(state):
            permissions = active.get("permissions") if isinstance(active, dict) else None
            if not isinstance(permissions, dict):
                continue
            for key in ("network", "bash", "write"):
                if permissions.get(key) is False:
                    denied.add(key)
        return denied

    def _filter_model_tools(self, request: ModelRequest) -> ModelRequest:
        allowed = self._allowed_tool_names(request.state)
        denied = self._denied_permissions(request.state)
        if allowed is None and not denied:
            return request

        active_tools = []
        for tool in request.tools:
            name = _tool_name(tool)
            if allowed is not None and name not in allowed:
                continue
            if _is_denied_by_permissions(name, denied):
                continue
            active_tools.append(tool)

        if len(active_tools) < len(request.tools):
            logger.info("CodingToolPolicyMiddleware: filtered %d model tool(s)", len(request.tools) - len(active_tools))
        return request.override(tools=active_tools)

    def _blocked_tool_message(self, request: ToolCallRequest) -> ToolMessage | None:
        allowed = self._allowed_tool_names(request.state)
        denied = self._denied_permissions(request.state)

        tool_name = str(request.tool_call.get("name") or "")
        if not tool_name:
            return None

        tool_call_id = str(request.tool_call.get("id") or "missing_tool_call_id")
        denied_permission = _denied_permission_for_tool(tool_name, denied)
        if denied_permission is not None:
            return ToolMessage(
                content=(
                    f"Error: Tool '{tool_name}' is blocked by active Coding skill permissions "
                    f"({denied_permission}=false)."
                ),
                tool_call_id=tool_call_id,
                name=tool_name,
                status="error",
            )

        if allowed is None or tool_name in allowed:
            return None

        return ToolMessage(
            content=(
                f"Error: Tool '{tool_name}' is not allowed by active Coding skills. "
                f"Allowed tools: {', '.join(sorted(allowed)) or '(none)'}."
            ),
            tool_call_id=tool_call_id,
            name=tool_name,
            status="error",
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        return handler(self._filter_model_tools(request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        return await handler(self._filter_model_tools(request))

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        blocked = self._blocked_tool_message(request)
        if blocked is not None:
            return blocked
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        blocked = self._blocked_tool_message(request)
        if blocked is not None:
            return blocked
        return await handler(request)


def _tool_name(tool: object) -> str:
    if isinstance(tool, dict):
        return str(tool.get("name") or "")
    return str(getattr(tool, "name", "") or "")


def _is_denied_by_permissions(tool_name: str, denied: set[str]) -> bool:
    return _denied_permission_for_tool(tool_name, denied) is not None


def _denied_permission_for_tool(tool_name: str, denied: set[str]) -> str | None:
    if "network" in denied and tool_name in _NETWORK_TOOLS:
        return "network"
    if "bash" in denied and tool_name in _BASH_TOOLS:
        return "bash"
    if "write" in denied and tool_name in _WRITE_TOOLS:
        return "write"
    return None


_NETWORK_TOOLS = {
    "web_search",
    "web_fetch",
    "create_pr",
    "git_push",
}

_BASH_TOOLS = {
    "bash",
    "run_tests",
    "run_linter",
}

_WRITE_TOOLS = {
    "write_file",
    "str_replace",
    "apply_diff",
    "insert_at_line",
    "multi_edit",
    "git_commit",
    "git_checkout",
    "git_stash",
    "create_worktree",
    "remove_worktree",
    "skill_manage",
}

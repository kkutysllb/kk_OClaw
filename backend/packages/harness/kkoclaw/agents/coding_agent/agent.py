"""Coding Agent factory — builds a LangGraph agent specialised for code engineering tasks."""

import logging

from langchain.agents import create_agent
from langchain_core.runnables import RunnableConfig

from kkoclaw.agents.lead_agent.agent import (
    _build_middlewares,
    _get_runtime_config,
    _resolve_model_name,
)
from kkoclaw.agents.thread_state import CodingThreadState, RuntimeContext
from kkoclaw.config.app_config import AppConfig, get_app_config
from kkoclaw.coding_core.qiongqi import QiongqiEngine
from kkoclaw.models import create_chat_model
from kkoclaw.agents.coding_agent.roi_middleware import QiongqiRoiTelemetryMiddleware

logger = logging.getLogger(__name__)

# Tool groups that the coding agent always needs access to.
_CODING_TOOL_GROUPS = ["web", "file:read", "file:write", "bash", "coding"]


def make_coding_agent(config: RunnableConfig):
    """LangGraph graph factory for the Coding Agent.

    Mirrors :func:`make_lead_agent` but uses :class:`CodingThreadState`,
    a coding-specialised system prompt, and the extended coding tool set.
    """
    runtime_config = _get_runtime_config(config)
    runtime_app_config = runtime_config.get("app_config")
    return _make_coding_agent(config, app_config=runtime_app_config or get_app_config())


def _get_coding_tools(*, app_config: AppConfig, model_name: str | None, subagent_enabled: bool) -> list:
    """Assemble the full tool list for the coding agent.

    Combines:
    - Standard tools from config (file, web, bash groups)
    - Coding-specific tools (read_file_range, grep_files, apply_diff, git_*, etc.)
    - Built-in tools (present_file, ask_clarification, view_image, task)
    """
    from kkoclaw.tools import get_available_tools
    from kkoclaw.tools.builtins import ask_clarification_tool, present_file_tool

    tools: list = []

    # 1. Load standard tools from config — coding agent gets all standard groups
    standard_tools = get_available_tools(
        model_name=model_name,
        subagent_enabled=subagent_enabled,
        app_config=app_config,
    )
    tools.extend(standard_tools)

    # 2. Load coding-specific tools from the coding tools module
    try:
        from kkoclaw.tools.coding import get_coding_tools

        coding_tools = get_coding_tools()
        # Deduplicate by tool name — coding tools may override standard ones
        existing_names = {t.name for t in tools}
        for ct in coding_tools:
            if ct.name in existing_names:
                # Replace the existing tool with the coding-optimised version
                tools = [ct if t.name == ct.name else t for t in tools]
            else:
                tools.append(ct)
        logger.info("Loaded %d coding-specific tools", len(coding_tools))
    except ImportError:
        logger.warning("Coding tools module not available yet — agent will use standard tools only")
    except Exception as e:
        logger.error("Failed to load coding tools: %s", e)

    # 3. Ensure essential built-in tools are present
    builtin_names = {t.name for t in tools}
    if present_file_tool.name not in builtin_names:
        tools.append(present_file_tool)
    if ask_clarification_tool.name not in builtin_names:
        tools.append(ask_clarification_tool)

    return tools


def _make_coding_agent(config: RunnableConfig, *, app_config: AppConfig):
    cfg = _get_runtime_config(config)
    resolved_app_config = app_config

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort", None)
    requested_model_name: str | None = cfg.get("model_name") or cfg.get("model")
    is_plan_mode = cfg.get("is_plan_mode", False)
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    project_root = cfg.get("project_root")
    thread_id = cfg.get("thread_id")

    # Resolve model — coding agent can override via coding_agent.model config
    coding_config = getattr(resolved_app_config, "coding_agent", None)
    coding_default_model = getattr(coding_config, "model", None) if coding_config else None
    model_name = _resolve_model_name(
        requested_model_name or coding_default_model,
        app_config=resolved_app_config,
    )

    model_config = resolved_app_config.get_model_config(model_name)
    if model_config is None:
        raise ValueError(
            "No chat model could be resolved for the Coding Agent. "
            "Please configure at least one model in config.yaml."
        )
    if thinking_enabled and not model_config.supports_thinking:
        logger.warning(
            "Thinking mode is enabled but model '%s' does not support it; "
            "falling back to non-thinking mode.",
            model_name,
        )
        thinking_enabled = False

    model_display_name = model_config.display_name or model_name

    logger.info(
        "Create CodingAgent -> thinking: %s, model: %s, plan_mode: %s, "
        "subagent: %s, project: %s",
        thinking_enabled,
        model_name,
        is_plan_mode,
        subagent_enabled,
        project_root or "(none)",
    )

    # Inject run metadata for LangSmith trace tagging
    if "metadata" not in config:
        config["metadata"] = {}
    config["metadata"].update(
        {
            "agent_name": "coding_agent",
            "model_name": model_name or "default",
            "thinking_enabled": thinking_enabled,
            "is_plan_mode": is_plan_mode,
            "subagent_enabled": subagent_enabled,
        }
    )

    qiongqi_engine = QiongqiEngine.from_runtime(
        project_root=project_root,
        thread_id=thread_id,
    )

    # Assemble tools
    tools = _get_coding_tools(
        app_config=resolved_app_config,
        model_name=model_name,
        subagent_enabled=subagent_enabled,
    )

    # Build system prompt
    stable_prompt = qiongqi_engine.build_stable_system_prompt(
        model_display_name=model_display_name,
        is_plan_mode=is_plan_mode,
        subagent_enabled=subagent_enabled,
        max_concurrent_subagents=max_concurrent_subagents,
    )
    system_prompt = stable_prompt + qiongqi_engine.build_dynamic_context()

    roi_report = qiongqi_engine.build_roi_report(
        stable_prompt=stable_prompt,
        tools=tools,
    )
    config["metadata"]["qiongqi_roi"] = qiongqi_engine.roi_metadata(roi_report)

    # Build the middleware chain — reuse lead_agent's proven middleware stack
    middlewares = _build_middlewares(
        config,
        model_name=model_name,
        agent_name="coding_agent",
        custom_middlewares=[
            *qiongqi_engine.build_agent_middlewares(),
            QiongqiRoiTelemetryMiddleware(
                qiongqi_engine,
                report=qiongqi_engine.roi_metadata(roi_report),
            ),
        ],
        app_config=resolved_app_config,
    )

    return create_agent(
        model=create_chat_model(
            name=model_name,
            thinking_enabled=thinking_enabled,
            reasoning_effort=reasoning_effort,
            app_config=resolved_app_config,
        ),
        tools=tools,
        middleware=middlewares,
        system_prompt=system_prompt,
        state_schema=CodingThreadState,
        context_schema=RuntimeContext,
    )

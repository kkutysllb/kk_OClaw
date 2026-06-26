"""Memory scope resolution and comparison helpers."""

from __future__ import annotations

from typing import Any

try:
    from langgraph.config import get_config
except Exception:  # pragma: no cover - import guard for lightweight tooling
    get_config = None  # type: ignore[assignment]

MemoryScope = dict[str, Any]


def scope_value(scope: MemoryScope | None, key: str) -> str:
    if not isinstance(scope, dict):
        return ""
    value = scope.get(key)
    return str(value).strip() if value is not None else ""


def same_memory_scope(left_scope: MemoryScope, right_scope: MemoryScope) -> bool:
    if scope_value(left_scope, "type") != scope_value(right_scope, "type"):
        return False

    for key in ("id", "workspaceRoot"):
        right_value = scope_value(right_scope, key)
        if right_value and scope_value(left_scope, key) == right_value:
            return True

    return False


def is_global_scope(scope: MemoryScope | None) -> bool:
    scope_type = scope_value(scope, "type")
    return scope_type in {"", "global"}


def resolve_active_scope(runtime_context: dict | None = None) -> MemoryScope | None:
    """Resolve active memory scope from runtime context or LangGraph config."""
    try:
        config_data = get_config() if get_config is not None else {}
    except RuntimeError:
        config_data = {}
    config_context = config_data.get("context") or {}
    configurable = config_data.get("configurable") or {}

    for container in (runtime_context, config_context, configurable):
        if not isinstance(container, dict):
            continue
        memory_scope = container.get("memory_scope")
        if isinstance(memory_scope, dict):
            return memory_scope

        project_id = container.get("project_id")
        project_root = container.get("project_root")
        if isinstance(project_id, str) and project_id.strip():
            scope: MemoryScope = {
                "type": "coding_project",
                "id": project_id.strip(),
            }
            if isinstance(project_root, str) and project_root.strip():
                scope["workspaceRoot"] = project_root.strip()
            return scope
        if isinstance(project_root, str) and project_root.strip():
            return {
                "type": "coding_project",
                "workspaceRoot": project_root.strip(),
            }

    return None

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime
from functools import lru_cache
from typing import TYPE_CHECKING, Any

from kkoclaw.config.agents_config import load_agent_soul
from kkoclaw.skills.storage import get_or_new_skill_storage
from kkoclaw.skills.types import Skill, SkillCategory
from kkoclaw.subagents import get_available_subagent_names

if TYPE_CHECKING:
    from kkoclaw.config.app_config import AppConfig

logger = logging.getLogger(__name__)

_ENABLED_SKILLS_REFRESH_WAIT_TIMEOUT_SECONDS = 5.0
_enabled_skills_lock = threading.Lock()
_enabled_skills_cache: list[Skill] | None = None
_enabled_skills_refresh_active = False
_enabled_skills_refresh_version = 0
_enabled_skills_refresh_event = threading.Event()


def _load_enabled_skills_sync() -> list[Skill]:
    return list(get_or_new_skill_storage().load_skills(enabled_only=True))


def _start_enabled_skills_refresh_thread() -> None:
    threading.Thread(
        target=_refresh_enabled_skills_cache_worker,
        name="kkoclaw-enabled-skills-loader",
        daemon=True,
    ).start()


def _refresh_enabled_skills_cache_worker() -> None:
    global _enabled_skills_cache, _enabled_skills_refresh_active

    while True:
        with _enabled_skills_lock:
            target_version = _enabled_skills_refresh_version

        try:
            skills = _load_enabled_skills_sync()
        except Exception:
            logger.exception("Failed to load enabled skills for prompt injection")
            skills = []

        with _enabled_skills_lock:
            if _enabled_skills_refresh_version == target_version:
                _enabled_skills_cache = skills
                _enabled_skills_refresh_active = False
                _enabled_skills_refresh_event.set()
                return

            # A newer invalidation happened while loading. Keep the worker alive
            # and loop again so the cache always converges on the latest version.
            _enabled_skills_cache = None


def _ensure_enabled_skills_cache() -> threading.Event:
    global _enabled_skills_refresh_active

    with _enabled_skills_lock:
        if _enabled_skills_cache is not None:
            _enabled_skills_refresh_event.set()
            return _enabled_skills_refresh_event
        if _enabled_skills_refresh_active:
            return _enabled_skills_refresh_event
        _enabled_skills_refresh_active = True
        _enabled_skills_refresh_event.clear()

    _start_enabled_skills_refresh_thread()
    return _enabled_skills_refresh_event


def _invalidate_enabled_skills_cache() -> threading.Event:
    global _enabled_skills_cache, _enabled_skills_refresh_active, _enabled_skills_refresh_version

    _get_cached_skills_prompt_section.cache_clear()
    with _enabled_skills_lock:
        _enabled_skills_cache = None
        _enabled_skills_refresh_version += 1
        _enabled_skills_refresh_event.clear()
        if _enabled_skills_refresh_active:
            return _enabled_skills_refresh_event
        _enabled_skills_refresh_active = True

    _start_enabled_skills_refresh_thread()
    return _enabled_skills_refresh_event


def prime_enabled_skills_cache() -> None:
    _ensure_enabled_skills_cache()


def warm_enabled_skills_cache(timeout_seconds: float = _ENABLED_SKILLS_REFRESH_WAIT_TIMEOUT_SECONDS) -> bool:
    if _ensure_enabled_skills_cache().wait(timeout=timeout_seconds):
        return True

    logger.warning("Timed out waiting %.1fs for enabled skills cache warm-up", timeout_seconds)
    return False


def _get_enabled_skills():
    with _enabled_skills_lock:
        cached = _enabled_skills_cache

    if cached is not None:
        return list(cached)

    _ensure_enabled_skills_cache()
    return []


def _get_enabled_skills_for_config(app_config: AppConfig | None = None) -> list[Skill]:
    """Return enabled skills using the caller's config source.

    When a concrete ``app_config`` is supplied, bypass the global enabled-skills
    cache so the skill list and skill paths are resolved from the same config
    object. This keeps request-scoped config injection consistent even while the
    release branch still supports global fallback paths.
    """
    if app_config is None:
        return _get_enabled_skills()
    return list(get_or_new_skill_storage(app_config=app_config).load_skills(enabled_only=True))


def _skill_mutability_label(category: SkillCategory | str) -> str:
    return "[custom, editable]" if category == SkillCategory.CUSTOM else "[built-in]"


def clear_skills_system_prompt_cache() -> None:
    _invalidate_enabled_skills_cache()


async def refresh_skills_system_prompt_cache_async() -> None:
    await asyncio.to_thread(_invalidate_enabled_skills_cache().wait)


def _build_skill_evolution_section(skill_evolution_enabled: bool) -> str:
    if not skill_evolution_enabled:
        return ""
    return """
## Skill Self-Evolution
After complex tasks (5+ tool calls, non-obvious pitfalls, user corrections), consider creating/updating a skill. Patch existing skills on issues; confirm with user before creating new ones.
"""


def _build_available_subagents_description(available_names: list[str], bash_available: bool, *, app_config: AppConfig | None = None) -> str:
    """Dynamically build subagent type descriptions from registry.

    Mirrors Codex's pattern where agent_type_description is dynamically generated
    from all registered roles, so the LLM knows about every available type.
    """
    # Built-in descriptions (kept for backward compatibility with existing prompt quality)
    builtin_descriptions = {
        "general-purpose": "For ANY non-trivial task - web research, code exploration, file operations, analysis, etc.",
        "bash": (
            "For command execution (git, build, test, deploy operations)" if bash_available else "Not available in the current sandbox configuration. Use direct file/web tools or switch to AioSandboxProvider for isolated shell access."
        ),
    }

    # Lazy import moved outside loop to avoid repeated import overhead
    from kkoclaw.subagents.registry import get_subagent_config

    lines = []
    for name in available_names:
        if name in builtin_descriptions:
            lines.append(f"- **{name}**: {builtin_descriptions[name]}")
        else:
            config = get_subagent_config(name, app_config=app_config)
            if config is not None:
                desc = config.description.split("\n")[0].strip()  # First line only for brevity
                lines.append(f"- **{name}**: {desc}")

    return "\n".join(lines)


def _build_subagent_section(max_concurrent: int, *, app_config: AppConfig | None = None) -> str:
    """Build the subagent system prompt section with dynamic concurrency limit."""
    n = max_concurrent
    available_names = get_available_subagent_names(app_config=app_config) if app_config is not None else get_available_subagent_names()
    bash_available = "bash" in available_names
    available_subagents = _build_available_subagents_description(available_names, bash_available, app_config=app_config)
    direct_tools = "bash, ls, read_file, web_search" if bash_available else "ls, read_file, web_search"
    return f"""<subagent_system>
**SUBAGENT MODE — DECOMPOSE, DELEGATE, SYNTHESIZE**

**HARD LIMIT: max {n} `task` calls per response.** Excess calls are silently discarded.

**Available Subagents:**
{available_subagents}

**When to use subagents (max {n} per turn):**
- Complex research requiring multiple sources/perspectives
- Multi-aspect analysis with independent dimensions
- Large codebase analysis across different parts

**When NOT to use subagents — execute directly via {direct_tools}:**
- Cannot break into 2+ meaningful parallel sub-tasks
- Simple single actions (read one file, quick edit)
- Sequential dependencies between steps

**Workflow:**
1. COUNT sub-tasks in thinking → if >{n}, plan sequential batches
2. LAUNCH current batch (max {n} `task` calls)
3. REPEAT until all batches done
4. SYNTHESIZE all results

**How it works:** `task` runs subagents asynchronously; backend polls and returns results automatically.
</subagent_system>"""


SYSTEM_PROMPT_TEMPLATE = """
<role>
You are {agent_name}, an open-source super agent powered by {model_display_name}.
</role>

{soul}
{memory_context}

<thinking_style>
- Think concisely and strategically BEFORE acting. Focus on NEXT steps, not recap.
- **NEVER recap or summarize previous conversation steps** — assume context is known, just proceed.
- **PRIORITY CHECK: If unclear/missing/ambiguous, ask clarification FIRST**
{subagent_thinking}- Keep thinking brief: outline only, never draft full output
- After thinking, deliver actual response. No meta-commentary like "Let me..." or "Based on..."
- ALL thinking in Chinese (中文)
</thinking_style>

<clarification_system>
**CLARIFY FIRST, ACT SECOND.** Call `ask_clarification(question, clarification_type, options)` when:
1. **Missing info** (`missing_info`): Required details not provided
2. **Ambiguous** (`ambiguous_requirement`): Multiple valid interpretations
3. **Approach choice** (`approach_choice`): Several valid approaches exist
4. **Risky** (`risk_confirmation`): Destructive actions need confirmation
5. **Suggestion** (`suggestion`): You have a recommendation but want approval
Never start working then clarify mid-execution. Stop and clarify first.
</clarification_system>

{skills_section}

{deferred_tools_section}

{subagent_section}

<working_directory>
- Uploads: `/mnt/user-data/uploads` | Workspace: `/mnt/user-data/workspace` | Outputs: `/mnt/user-data/outputs`
- Use relative paths from workspace when possible; deliver final files to outputs via `present_files`
- PDF/PPT/Excel/Word files have converted `.md` versions available alongside originals
{acp_section}
</working_directory>

<response_style>
- ALL responses in Chinese. English only when user explicitly requests it or for code/paths.
- Clear, concise, action-oriented. Avoid over-formatting.
</response_style>

<citations>
**Include citations when using web search results.**
- Inline: `[citation:Title](URL)` right after the claim
- Sources section at end: `[Title](URL) - Description` (no `citation:` prefix here)
- Never write claims from external sources without citations
</citations>

<critical_reminders>
- Clarify unclear/ambiguous requirements BEFORE starting work
{subagent_reminder}- Load relevant skill before complex tasks; use progressive loading
- Deliver final files to `/mnt/user-data/outputs` via `present_files`
- Use parallel tool calls for efficiency; welcome images and Mermaid diagrams in responses
- All communication, thinking, and responses in Chinese. Code/paths can stay English.
- Always provide visible response after thinking
</critical_reminders>
"""


def _get_memory_context(
    agent_name: str | None = None,
    *,
    app_config: AppConfig | None = None,
    messages: list[Any] | None = None,
) -> str:
    """Get memory context for injection into system prompt.

    Args:
        agent_name: If provided, loads per-agent memory. If None, loads global memory.
        app_config: Explicit application config. When provided, memory options
            are read from this value instead of the global config singleton.

    Returns:
        Formatted memory context string wrapped in XML tags, or empty string if disabled.
    """
    try:
        from kkoclaw.agents.memory import (
            extract_current_context,
            format_memory_for_injection,
            get_memory_data,
            rank_memory_facts,
        )
        from kkoclaw.runtime.user_context import get_effective_user_id

        if app_config is None:
            from kkoclaw.config.memory_config import get_memory_config

            config = get_memory_config()
        else:
            config = app_config.memory

        if not config.enabled or not config.injection_enabled:
            return ""

        memory_data = get_memory_data(agent_name, user_id=get_effective_user_id())
        ranked_facts = None
        retrieval_config = getattr(config, "retrieval", None)
        if retrieval_config and retrieval_config.enabled:
            if messages:
                try:
                    current_context = extract_current_context(
                        messages,
                        max_turns=retrieval_config.context_max_turns,
                        max_chars=retrieval_config.context_max_chars,
                    )
                    ranked_facts = rank_memory_facts(
                        memory_data.get("facts", []),
                        current_context=current_context,
                        similarity_weight=retrieval_config.similarity_weight,
                        confidence_weight=retrieval_config.confidence_weight,
                        min_similarity=retrieval_config.min_similarity,
                    )
                except Exception:
                    logger.exception("Failed to rank memory facts for prompt injection")
            else:
                # When context-aware retrieval is enabled, facts are injected at
                # runtime by middleware where the live conversation state exists.
                ranked_facts = []

        memory_content = format_memory_for_injection(
            memory_data,
            max_tokens=config.max_injection_tokens,
            ranked_facts=ranked_facts,
        )

        if not memory_content.strip():
            return ""

        return f"""<memory>
{memory_content}
</memory>
"""
    except Exception:
        logger.exception("Failed to load memory context")
        return ""


@lru_cache(maxsize=32)
def _get_cached_skills_prompt_section(
    skill_signature: tuple[tuple[str, str, str, str], ...],
    available_skills_key: tuple[str, ...] | None,
    container_base_path: str,
    skill_evolution_section: str,
) -> str:
    filtered = [(name, description, category, location) for name, description, category, location in skill_signature if available_skills_key is None or name in available_skills_key]
    skills_list = ""
    if filtered:
        skill_items = "\n".join(
            f"- **{name}** {_skill_mutability_label(category)}: {description} → `{location}`"
            for name, description, category, location in filtered
        )
        skills_list = f"<available_skills>\n{skill_items}\n</available_skills>"
    return f"""<skill_system>
Skills provide optimized workflows. When a query matches a skill, `read_file` its path, follow instructions, and load sub-resources on demand.

**Skills are located at:** {container_base_path}
{skill_evolution_section}
{skills_list}

</skill_system>"""


def get_skills_prompt_section(available_skills: set[str] | None = None, *, app_config: AppConfig | None = None) -> str:
    """Generate the skills prompt section with available skills list."""
    skills = _get_enabled_skills_for_config(app_config)

    if app_config is None:
        try:
            from kkoclaw.config import get_app_config

            config = get_app_config()
            container_base_path = config.skills.container_path
            skill_evolution_enabled = config.skill_evolution.enabled
        except Exception:
            container_base_path = "/mnt/skills"
            skill_evolution_enabled = False
    else:
        config = app_config
        container_base_path = config.skills.container_path
        skill_evolution_enabled = config.skill_evolution.enabled

    if not skills and not skill_evolution_enabled:
        return ""

    if available_skills is not None and not any(skill.name in available_skills for skill in skills):
        return ""

    skill_signature = tuple((skill.name, skill.description, skill.category, skill.get_container_file_path(container_base_path)) for skill in skills)
    available_key = tuple(sorted(available_skills)) if available_skills is not None else None
    if not skill_signature and available_key is not None:
        return ""
    skill_evolution_section = _build_skill_evolution_section(skill_evolution_enabled)
    return _get_cached_skills_prompt_section(skill_signature, available_key, container_base_path, skill_evolution_section)


def get_agent_soul(agent_name: str | None) -> str:
    # Append SOUL.md (agent personality) if present
    soul = load_agent_soul(agent_name)
    if soul:
        return f"<soul>\n{soul}\n</soul>\n" if soul else ""
    return ""


def get_deferred_tools_prompt_section(*, app_config: AppConfig | None = None) -> str:
    """Generate <available-deferred-tools> block for the system prompt.

    Lists only deferred tool names so the agent knows what exists
    and can use tool_search to load them.
    Returns empty string when tool_search is disabled or no tools are deferred.
    """
    from kkoclaw.tools.builtins.tool_search import get_deferred_registry

    if app_config is None:
        try:
            from kkoclaw.config import get_app_config

            config = get_app_config()
        except Exception:
            return ""
    else:
        config = app_config

    if not config.tool_search.enabled:
        return ""

    registry = get_deferred_registry()
    if not registry:
        return ""

    names = "\n".join(e.name for e in registry.entries)
    return f"<available-deferred-tools>\n{names}\n</available-deferred-tools>"


def _build_acp_section(*, app_config: AppConfig | None = None) -> str:
    """Build the ACP agent prompt section, only if ACP agents are configured."""
    if app_config is None:
        try:
            from kkoclaw.config.acp_config import get_acp_agents

            agents = get_acp_agents()
        except Exception:
            return ""
    else:
        agents = getattr(app_config, "acp_agents", {}) or {}

    if not agents:
        return ""

    return (
        "\n**ACP Agent Tasks (invoke_acp_agent):**\n"
        "- ACP agents (e.g. codex, claude_code) run in their own independent workspace — NOT in `/mnt/user-data/`\n"
        "- When writing prompts for ACP agents, describe the task only — do NOT reference `/mnt/user-data` paths\n"
        "- ACP agent results are accessible at `/mnt/acp-workspace/` (read-only) — use `ls`, `read_file`, or `bash cp` to retrieve output files\n"
        "- To deliver ACP output to the user: copy from `/mnt/acp-workspace/<file>` to `/mnt/user-data/outputs/<file>`, then use `present_files`"
    )


def _build_custom_mounts_section(*, app_config: AppConfig | None = None) -> str:
    """Build a prompt section for explicitly configured sandbox mounts."""
    if app_config is None:
        try:
            from kkoclaw.config import get_app_config

            config = get_app_config()
        except Exception:
            logger.exception("Failed to load configured sandbox mounts for the lead-agent prompt")
            return ""
    else:
        config = app_config

    mounts = config.sandbox.mounts or []

    if not mounts:
        return ""

    lines = []
    for mount in mounts:
        access = "read-only" if mount.read_only else "read-write"
        lines.append(f"- Custom mount: `{mount.container_path}` - Host directory mapped into the sandbox ({access})")

    mounts_list = "\n".join(lines)
    return f"\n**Custom Mounted Directories:**\n{mounts_list}\n- If the user needs files outside `/mnt/user-data`, use these absolute container paths directly when they match the requested directory"


def apply_prompt_template(
    subagent_enabled: bool = False,
    max_concurrent_subagents: int = 3,
    *,
    agent_name: str | None = None,
    model_display_name: str | None = None,
    available_skills: set[str] | None = None,
    app_config: AppConfig | None = None,
) -> str:
    # Get memory context
    memory_context = _get_memory_context(agent_name, app_config=app_config)

    # Include subagent section only if enabled (from runtime parameter)
    n = max_concurrent_subagents
    subagent_section = _build_subagent_section(n, app_config=app_config) if subagent_enabled else ""

    # Add subagent reminder to critical_reminders if enabled
    subagent_reminder = (
        f"- **Max {n} `task` calls per turn.** Excess silently discarded.\n"
        if subagent_enabled
        else ""
    )

    # Add subagent thinking guidance if enabled
    subagent_thinking = (
        "- **DECOMPOSITION CHECK: Can this be split into 2+ parallel sub-tasks? If count > "
        f"{n}, plan batches of ≤{n}.**\n"
        if subagent_enabled
        else ""
    )

    # Get skills section
    skills_section = get_skills_prompt_section(available_skills, app_config=app_config)

    # Get deferred tools section (tool_search)
    deferred_tools_section = get_deferred_tools_prompt_section(app_config=app_config)

    # Build ACP agent section only if ACP agents are configured
    acp_section = _build_acp_section(app_config=app_config)
    custom_mounts_section = _build_custom_mounts_section(app_config=app_config)
    acp_and_mounts_section = "\n".join(section for section in (acp_section, custom_mounts_section) if section)

    # Format the prompt with dynamic skills and memory
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        agent_name=agent_name or "KKOCLAW 1.0",
        model_display_name=model_display_name or agent_name or "KKOCLAW 1.0",
        soul=get_agent_soul(agent_name),
        skills_section=skills_section,
        deferred_tools_section=deferred_tools_section,
        memory_context=memory_context,
        subagent_section=subagent_section,
        subagent_reminder=subagent_reminder,
        subagent_thinking=subagent_thinking,
        acp_section=acp_and_mounts_section,
    )

    return prompt + f"\n<current_date>{datetime.now().strftime('%Y-%m-%d, %A')}</current_date>"

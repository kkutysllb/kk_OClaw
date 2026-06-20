"""Qiongqi core runtime for the Coding Agent.

The LangGraph Coding Agent is an adapter over this engine. Qiongqi owns the
Coding session context, Coding-only skills, active-skill policy, and the
Coding-specific middleware/prompt assembly.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from kkoclaw.coding_core.context import CodingRuntimeContext
from kkoclaw.coding_core.skills import ActiveCodingSkill, CodingSkill, CodingSkillRegistry, load_skill_instructions

_STABLE_QIONGQI_PROMPT = """\
You are **KKOCLAW Code**, an elite AI coding assistant integrated into the KKOCLAW platform.
You operate through the Qiongqi runtime boundary.

## Qiongqi Runtime Contract

- Keep the immutable system prefix stable across projects and turns.
- Treat project paths, active skills, task details, current date, and tool results as dynamic context.
- Spend tokens on requirements, code, decisions, errors, and results.
- Prefer narrow reads/searches over broad context loading.
- Preserve exact code, paths, commands, identifiers, and quoted errors.
- Use tools deliberately and avoid repeated identical calls.
- Write responses in the same language as the user's message.

## Project Delivery Stage Tracking

This project tracks delivery through 7 stages:
requirements → design → initialization → implementation →
verification → review → delivery

You will see the **current stage** and its **completion signals** in the
"Current Delivery Stage" section of your dynamic context.

### When you MUST proactively call `suggest_delivery_stage`

- **You just produced the stage's key deliverable.**
  (e.g. you wrote `requirements.md` during the `requirements` stage;
  you produced a design doc during the `design` stage.)
- **The user explicitly confirmed a key decision** that satisfies one of
  the stage's completion signals (e.g. tech stack chosen, acceptance
  criteria signed off).
- **You're about to start work that clearly belongs to the *next* stage**
  (e.g. you're in `requirements` but the user is asking you to scaffold
  the project → suggest `initialization`).

### Attitude: err on the side of proposing

- A false-positive suggestion costs the user **one click** to dismiss.
- A missed suggestion **strands the project** in the wrong stage until
  the user manually notices and clicks forward.
- **When in doubt, call it.** The user is the final arbiter.

### What NOT to do

- Do **not** wait for the user to explicitly say "推进阶段" or "move to
  the next stage". That defeats the purpose of proactive tracking.
- Do **not** assume the stage auto-advances. It does not — only your
  `suggest_delivery_stage` call + the user's accept click moves it.
- Do **not** batch suggestions at the end of the project. Propose as
  soon as the signal is met, every time.
"""


@dataclass(frozen=True)
class QiongqiSession:
    """Immutable Coding session assembled for one agent graph."""

    context: CodingRuntimeContext
    skills: list[CodingSkill]


@dataclass(frozen=True)
class QiongqiRuntimePolicy:
    """Serializable policy state derived from active Coding skills."""

    active_coding_skills: list[dict]


@dataclass(frozen=True)
class QiongqiRoiReport:
    stable_prompt_fingerprint: str
    tool_catalog_fingerprint: str
    immutable_prefix_fingerprint: str
    full_tool_count: int
    visible_tool_count: int
    hidden_tool_count: int


@dataclass(frozen=True)
class QiongqiEngine:
    """Core runtime boundary for OClaw Coding."""

    session: QiongqiSession

    @classmethod
    def from_runtime(
        cls,
        *,
        project_root: str | None = None,
        thread_id: str | None = None,
        scratch_root: str | None = None,
    ) -> "QiongqiEngine":
        context = CodingRuntimeContext.from_runtime(
            project_root=project_root,
            thread_id=thread_id,
            scratch_root=scratch_root,
        )
        return cls(
            session=QiongqiSession(
                context=context,
                skills=CodingSkillRegistry.discover(project_root=context.project_root),
            )
        )

    @property
    def context(self) -> CodingRuntimeContext:
        return self.session.context

    @property
    def skills(self) -> list[CodingSkill]:
        return self.session.skills

    def activate_skills(self, task_text: str | None) -> list[ActiveCodingSkill]:
        return self.activate_skills_for_task(task_text)

    def activate_skills_for_task(self, task_text: str | None) -> list[ActiveCodingSkill]:
        """Select Coding skills for a task and load their instruction files."""
        task = (task_text or "").lower()
        active: list[ActiveCodingSkill] = []
        for skill in self.session.skills:
            if not skill.enabled or skill.manifest_errors:
                continue
            if not _matches_skill(skill, task):
                continue
            instructions = load_skill_instructions(skill)
            if instructions:
                active.append(ActiveCodingSkill(skill=skill, instructions=instructions))
        return active

    def active_skill_policy_for_task(self, task_text: str | None) -> list[dict]:
        return active_skills_to_state(self.activate_skills_for_task(task_text))

    def build_system_prompt(
        self,
        *,
        model_display_name: str | None = None,
        is_plan_mode: bool = False,
        subagent_enabled: bool = False,
        max_concurrent_subagents: int = 3,
    ) -> str:
        sections = [
            self.build_stable_system_prompt(
                model_display_name=model_display_name,
                is_plan_mode=is_plan_mode,
                subagent_enabled=subagent_enabled,
                max_concurrent_subagents=max_concurrent_subagents,
            ),
            self.build_dynamic_context(),
        ]
        return "".join(section for section in sections if section)

    def build_stable_system_prompt(
        self,
        *,
        model_display_name: str | None = None,
        is_plan_mode: bool = False,
        subagent_enabled: bool = False,
        max_concurrent_subagents: int = 3,
    ) -> str:
        sections = [_STABLE_QIONGQI_PROMPT]
        if model_display_name:
            sections.append(f"\n## Model\nYou are powered by **{model_display_name}**.\n")
        if subagent_enabled:
            sections.append(
                f"\n## Sub-Agent Orchestration\n"
                f"You can launch up to **{max_concurrent_subagents}** sub-agents per response for parallel tasks.\n"
                f"Use sub-agents for independent code exploration, test generation, or documentation work.\n"
            )
        if is_plan_mode:
            sections.append(
                "\n## Plan Mode\n"
                "Create and maintain a concise todo list for complex multi-step work.\n"
            )
        return "".join(sections)

    def build_dynamic_context(self) -> str:
        sections: list[str] = []
        project_root = self.session.context.project_root

        # Surface the current delivery stage so the agent knows where
        # the project stands without needing to ask the user.
        if project_root:
            try:
                from kkoclaw.coding_core.stage_state import ProjectStageStore

                stage_state = ProjectStageStore.from_home().get_state(project_root)
                if stage_state.current_stage:
                    from kkoclaw.coding_core.delivery_stages import get_stage

                    stage = get_stage(stage_state.current_stage)
                    if stage:
                        # Build a rich "current stage" block that tells the
                        # agent: (a) what stage we're in, (b) what its goal is,
                        # (c) what concrete signals indicate completion, and
                        # (d) what the next stage is. This is what the agent
                        # compares against its own progress to decide when to
                        # call `suggest_delivery_stage`.
                        signals_block = ""
                        if stage.completion_signals:
                            signals_lines = "\n".join(
                                f"  - {sig}" for sig in stage.completion_signals
                            )
                            signals_block = (
                                f"\n**Completion signals** (any one met → call "
                                f"`suggest_delivery_stage`):\n{signals_lines}\n"
                            )
                        next_block = ""
                        if stage.next_stage_id:
                            next_block = (
                                f"\n**Next stage**: `{stage.next_stage_id}` "
                                f"(pass this as `stage_id` when you propose)\n"
                            )
                        sections.append(
                            f"\n## Current Delivery Stage\n"
                            f"You are in the **{stage.title}** (`{stage.id}`) stage.\n"
                            f"\n**Goal**: {stage.goal}\n"
                            f"{signals_block}"
                            f"{next_block}"
                        )
                    else:
                        sections.append(
                            f"\n## Current Delivery Stage\n"
                            f"The project is currently in the **{stage_state.current_stage}** stage.\n"
                        )
            except Exception:  # noqa: BLE001
                pass

        if project_root:
            sections.append(
                f"\n## Current Project\n"
                f"You are operating in the project at: `{project_root}`\n"
                f"Use this path as the source repository root when reading or editing project files.\n"
                f"Your default shell working directory is an isolated scratch workspace under the user's home directory, not this project root.\n"
                f"Put temporary notes, analysis files, generated scratch scripts, and other intermediate artifacts in the scratch workspace.\n"
                f"Only write inside `{project_root}` when the task explicitly requires changing the user's project files.\n"
            )
        if self.session.skills:
            skill_lines = [
                f"- **{skill.name}** ({skill.scope}): {skill.description}\n"
                f"  Load instructions from `{skill.skill_file}` when this skill matches the coding task."
                for skill in self.session.skills
            ]
            sections.append(
                "\n## Coding Skills\n"
                "The following skills are scoped only to the Coding Agent. Load a skill by reading "
                "its SKILL.md file when the task matches its description:\n"
                + "\n".join(skill_lines)
                + "\n"
            )
        return "".join(sections)

    def immutable_prefix_fingerprint(self, *, stable_prompt: str, tools: list[Any]) -> str:
        payload = {
            "stable_prompt": stable_prompt,
            "tools": _canonical_tools(tools),
        }
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def tool_catalog_fingerprint(self, tools: list[Any]) -> str:
        encoded = json.dumps(_canonical_tools(tools), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def build_roi_report(
        self,
        *,
        stable_prompt: str,
        tools: list[Any],
        visible_tools: list[Any] | None = None,
    ) -> QiongqiRoiReport:
        visible = visible_tools if visible_tools is not None else tools
        stable_prompt_fingerprint = hashlib.sha256(stable_prompt.encode("utf-8")).hexdigest()
        tool_catalog_fingerprint = self.tool_catalog_fingerprint(tools)
        return QiongqiRoiReport(
            stable_prompt_fingerprint=stable_prompt_fingerprint,
            tool_catalog_fingerprint=tool_catalog_fingerprint,
            immutable_prefix_fingerprint=self.immutable_prefix_fingerprint(stable_prompt=stable_prompt, tools=tools),
            full_tool_count=len(tools),
            visible_tool_count=len(visible),
            hidden_tool_count=max(0, len(tools) - len(visible)),
        )

    def roi_metadata(self, report: QiongqiRoiReport) -> dict[str, Any]:
        return {
            "stable_prompt_fingerprint": report.stable_prompt_fingerprint,
            "tool_catalog_fingerprint": report.tool_catalog_fingerprint,
            "immutable_prefix_fingerprint": report.immutable_prefix_fingerprint,
            "full_tool_count": report.full_tool_count,
            "visible_tool_count": report.visible_tool_count,
            "hidden_tool_count": report.hidden_tool_count,
        }

    def persist_task_session(
        self,
        *,
        store: Any | None = None,
        task_text: str | None = None,
        active_skills: list[ActiveCodingSkill] | None = None,
        roi: dict[str, Any] | QiongqiRoiReport | None = None,
        change_summary: dict[str, Any] | None = None,
    ) -> Any:
        from kkoclaw.coding_core.session_store import QiongqiSessionStore

        session_store = store or QiongqiSessionStore.from_home()
        active_skills = active_skills if active_skills is not None else self.activate_skills_for_task(task_text)
        snapshot = session_store.persist_session(
            self.session,
            active_skills=active_skills,
            tool_policy=active_skills_to_state(active_skills),
            roi=roi,
            change_summary=change_summary,
        )
        session_store.append_event(
            self.session.context.thread_id,
            "session_started",
            {
                "project_root": self.session.context.project_root,
                "scratch_root": self.session.context.scratch_root,
                "active_skill_ids": [item.skill.id for item in active_skills],
            },
        )
        return snapshot

    def persist_roi_telemetry(
        self,
        *,
        store: Any | None = None,
        report: QiongqiRoiReport | dict[str, Any],
        provider_usage: dict[str, Any] | None = None,
        tool_output: dict[str, Any] | None = None,
        token_economy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

        telemetry_store = store or QiongqiRoiTelemetryStore.from_home()
        return telemetry_store.record_report(
            self.session.context.thread_id,
            report=report,
            provider_usage=provider_usage,
            tool_output=tool_output,
            token_economy=token_economy,
        )

    def build_legacy_system_prompt(
        self,
        *,
        model_display_name: str | None = None,
        is_plan_mode: bool = False,
        subagent_enabled: bool = False,
        max_concurrent_subagents: int = 3,
    ) -> str:
        from kkoclaw.agents.coding_agent.prompt import apply_coding_prompt_template

        return apply_coding_prompt_template(
            model_display_name=model_display_name,
            is_plan_mode=is_plan_mode,
            subagent_enabled=subagent_enabled,
            max_concurrent_subagents=max_concurrent_subagents,
            project_root=self.session.context.project_root,
            coding_skills=self.session.skills,
        )

    def build_agent_middlewares(self) -> list:
        from kkoclaw.agents.coding_agent.skills_middleware import CodingSkillsMiddleware
        from kkoclaw.agents.coding_agent.tool_policy_middleware import CodingToolPolicyMiddleware

        return [
            CodingSkillsMiddleware(self),
            CodingToolPolicyMiddleware(self._active_skill_policy_for_state),
        ]

    def _active_skill_policy_for_state(self, state: object) -> list[dict]:
        if isinstance(state, dict):
            cached = state.get("active_coding_skills")
            if isinstance(cached, list):
                return cached
        return self.active_skill_policy_for_task(_latest_user_text(state))


def _matches_skill(skill: CodingSkill, task: str) -> bool:
    if skill.always_activate:
        return True
    if not skill.activation_keywords:
        return False
    return any(keyword.lower() in task for keyword in skill.activation_keywords)


def _latest_user_text(state: object) -> str | None:
    if not isinstance(state, dict):
        return None
    from langchain_core.messages import HumanMessage

    for message in reversed(list(state.get("messages", []))):
        if isinstance(message, HumanMessage) and not message.additional_kwargs.get("coding_skills_reminder"):
            content = message.content
            if isinstance(content, str):
                return content
            return str(content)
    return None


def active_skills_to_state(active_skills: list[ActiveCodingSkill]) -> list[dict]:
    return [
        {
            "id": active.skill.id,
            "allowed_tools": list(active.skill.allowed_tools),
            "permissions": active.skill.permissions or {},
        }
        for active in active_skills
    ]


def _canonical_tools(tools: list[Any]) -> list[dict[str, Any]]:
    canonical: list[dict[str, Any]] = []
    for tool in tools:
        if isinstance(tool, dict):
            name = str(tool.get("name") or "")
            payload = dict(tool)
        else:
            name = str(getattr(tool, "name", "") or "")
            payload = {"name": name}
            args_schema = getattr(tool, "args_schema", None)
            if args_schema is not None:
                payload["args_schema"] = str(args_schema)
            description = getattr(tool, "description", None)
            if description is not None:
                payload["description"] = str(description)
        canonical.append(_canonical_value(payload | {"name": name}))
    return sorted(canonical, key=lambda item: item.get("name", ""))


def _canonical_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _canonical_value(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, tuple):
        return [_canonical_value(item) for item in value]
    return value

"""Agent tool for suggesting delivery stage transitions.

The Coding Agent uses ``suggest_delivery_stage`` to *propose* moving the
project to a new stage. The proposal is stored as ``pending_suggestion``
in :class:`~kkoclaw.coding_core.stage_state.ProjectStageStore` and surfaced
to the user in the UI. The stage only changes when the user explicitly
accepts the suggestion (or pushes the stage manually).

This indirection is deliberate: it keeps the human in control of project
workflow transitions while still letting the agent proactively signal
"the requirements phase looks done, let's move to design".
"""

from __future__ import annotations

from langchain.tools import tool

from kkoclaw.coding_core.delivery_stages import get_stage, is_valid_stage_id, list_stages
from kkoclaw.coding_core.stage_state import ProjectStageStore
from kkoclaw.config import get_app_config
from kkoclaw.sandbox.tools import get_thread_data
from kkoclaw.tools.types import Runtime

# The terminal stage — entering it always requires manual confirmation,
# even when ``auto_accept_forward_stage`` is enabled.
_MANUAL_CONFIRM_STAGE = "delivery"


@tool("suggest_delivery_stage", parse_docstring=True)
def suggest_delivery_stage_tool(
    runtime: Runtime,
    stage_id: str,
    reason: str,
) -> str:
    """Propose moving the project to the next delivery stage.

    The project workflow is tracked through 7 stages. The user is the final
    arbiter of stage transitions — your call only creates a *suggestion*
    banner in the UI; the stage does NOT change until the user accepts.

    **WHEN TO CALL THIS (proactively, do not wait to be asked):**
    - You just produced the stage's key deliverable (e.g. generated
      requirements.md during the `requirements` stage, produced a design
      doc during the `design` stage).
    - The user confirmed a key decision that satisfies the stage's goal
      (e.g. confirmed tech stack, signed off on acceptance criteria).
    - You find yourself about to start work that clearly belongs to the
      *next* stage (e.g. about to scaffold the project while still in the
      `requirements` stage → suggest moving to `initialization`).

    **When in doubt, call it.** A false positive only costs the user one
    click to dismiss; a missed suggestion strands the project in the wrong
    stage. Err on the side of proposing.

    Args:
        stage_id: The stage you believe the project should move to. One of:
            requirements, design, initialization, implementation,
            verification, review, delivery. Usually this is the
            `next_stage_id` shown in your current-stage context.
        reason: 1-3 sentences explaining *what was produced or decided*
            that makes this transition appropriate. The user reads this
            before accepting, so be concrete ("已生成 requirements.md 并
            与用户确认技术栈" beats "需求阶段已完成").

    Returns:
        Confirmation message indicating the suggestion was recorded.
    """
    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None

    if not project_root:
        return (
            "⚠️ Unable to suggest a stage transition: no project is "
            "currently open. Open a project first."
        )

    if not is_valid_stage_id(stage_id):
        valid_ids = ", ".join(s.id for s in list_stages())
        return (
            f"⚠️ Invalid stage_id '{stage_id}'. "
            f"Must be one of: {valid_ids}."
        )

    if not reason or not reason.strip():
        return "⚠️ A reason is required so the user understands why you're suggesting this transition."

    thread_id = (
        thread_data.get("thread_id")
        if thread_data
        else (runtime.state.get("thread_id") if runtime and runtime.state else None)
        or "unknown"
    )

    store = ProjectStageStore.from_home()
    current_state = store.get_state(project_root)

    # --- B: auto-accept forward transitions when configured -------------
    # If auto_accept_forward_stage is enabled AND the suggestion moves
    # exactly one step forward (current.next_stage_id) without entering
    # the terminal 'delivery' stage, we transition immediately instead
    # of creating a pending suggestion banner.
    auto_accept = _is_auto_accept_enabled()
    forward = _is_forward_transition(current_state.current_stage, stage_id)

    if auto_accept and forward:
        store.set_current_stage(
            project_root,
            stage_id,
            reason=reason.strip(),
            source="agent_accepted",
            thread_id=thread_id,
        )
        stage = get_stage(stage_id)
        title = stage.title if stage else stage_id
        return (
            f"✅ Automatically transitioned the project to the **{title}** "
            f"stage (auto-accept enabled, forward transition).\n"
            f"Reason: {reason.strip()}"
        )
    # ------------------------------------------------------------------

    store.suggest_stage(
        project_root,
        stage_id,
        reason=reason.strip(),
        thread_id=thread_id,
    )

    stage = get_stage(stage_id)
    title = stage.title if stage else stage_id

    return (
        f"✅ Suggested transitioning the project to the **{title}** stage.\n"
        f"Reason: {reason.strip()}\n"
        f"The user will see this suggestion and can accept or dismiss it."
    )


def _is_auto_accept_enabled() -> bool:
    """Read ``coding_agent.auto_accept_forward_stage`` from config.

    Returns ``False`` on any error so a misconfigured environment never
    silently bypasses the human-confirmation safeguard.
    """
    try:
        return bool(get_app_config().coding_agent.auto_accept_forward_stage)
    except Exception:  # noqa: BLE001 — config access must never crash the tool
        return False


def _is_forward_transition(
    current_stage_id: str | None,
    suggested_stage_id: str,
) -> bool:
    """True if *suggested_stage_id* is exactly one step forward from *current*.

    Rules:
    - Entering the terminal ``delivery`` stage is **always** manual.
    - From ``None`` (project not started) only the first stage
      (``requirements``) counts as forward.
    - Otherwise the suggested stage must equal ``current.next_stage_id``.
    """
    if suggested_stage_id == _MANUAL_CONFIRM_STAGE:
        return False
    if current_stage_id is None:
        return suggested_stage_id == "requirements"
    current = get_stage(current_stage_id)
    if current is None or current.next_stage_id is None:
        return False
    return current.next_stage_id == suggested_stage_id


__all__ = ["suggest_delivery_stage_tool"]

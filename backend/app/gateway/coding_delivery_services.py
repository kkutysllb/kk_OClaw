"""Gateway service helpers for Coding delivery stage tracking."""

from __future__ import annotations

from typing import Any

from kkoclaw.coding_core.delivery_stages import DeliveryStage, list_stages
from kkoclaw.coding_core.stage_state import ProjectStageStore


class CodingDeliveryService:
    """Thin gateway boundary between the REST API and the stage store."""

    @classmethod
    def list_stages(cls) -> list[dict[str, Any]]:
        return [_stage_payload(stage) for stage in list_stages()]

    @classmethod
    def get_stage_state(cls, project_root: str) -> dict[str, Any]:
        return ProjectStageStore.from_home().get_state(project_root).to_payload()

    @classmethod
    def set_stage(
        cls,
        project_root: str,
        stage_id: str,
        reason: str = "",
    ) -> dict[str, Any]:
        store = ProjectStageStore.from_home()
        state = store.set_current_stage(
            project_root,
            stage_id,
            reason=reason,
            source="user",
        )
        store.dismiss_suggestion(project_root)
        return state.to_payload()

    @classmethod
    def accept_suggestion(cls, project_root: str) -> dict[str, Any]:
        store = ProjectStageStore.from_home()
        state = store.accept_suggestion(project_root)
        return state.to_payload()

    @classmethod
    def dismiss_suggestion(cls, project_root: str) -> dict[str, Any]:
        store = ProjectStageStore.from_home()
        state = store.dismiss_suggestion(project_root)
        return state.to_payload()


def _stage_payload(stage: DeliveryStage) -> dict[str, Any]:
    return {
        "id": stage.id,
        "title": stage.title,
        "goal": stage.goal,
        "recommended_skills": list(stage.recommended_skills),
        "suggested_prompt": stage.suggested_prompt,
        "next_stage_id": stage.next_stage_id,
    }

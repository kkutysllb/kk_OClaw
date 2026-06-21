"""REST API for Coding project delivery stage tracking.

Endpoints
---------
- ``GET  /api/coding/delivery-stages``
      Returns the canonical list of 7 delivery stages.

- ``GET  /api/coding/stage?project_root=<path>``
      Returns the current stage state for the project.

- ``POST /api/coding/stage?project_root=<path>``
      Manually set the current stage (user-initiated push).

- ``POST /api/coding/stage/suggestion/accept?project_root=<path>``
      Accept a pending agent suggestion and apply it.

- ``POST /api/coding/stage/suggestion/dismiss?project_root=<path>``
      Dismiss a pending agent suggestion without applying it.

The ``project_root`` is passed as a URL-encoded query parameter to avoid
path-traversal issues with filesystem paths containing slashes, spaces,
or CJK characters.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.gateway.coding_delivery_services import CodingDeliveryService

router = APIRouter(prefix="/api/coding", tags=["coding-delivery"])


# --------------------------------------------------------------------------- #
# Response models
# --------------------------------------------------------------------------- #

class DeliveryStageItem(BaseModel):
    id: str
    title: str
    goal: str
    recommended_skills: list[str]
    suggested_prompt: str
    next_stage_id: str | None


class DeliveryStagesResponse(BaseModel):
    stages: list[DeliveryStageItem]


class StageHistoryItem(BaseModel):
    from_stage_id: str | None
    to_stage_id: str
    reason: str
    source: str
    timestamp: str
    thread_id: str | None = None
    run_outcome: str | None = None


class StageSuggestionItem(BaseModel):
    stage_id: str
    reason: str
    suggested_by_thread_id: str
    timestamp: str


class ProjectStageResponse(BaseModel):
    project_root: str
    current_stage: str | None
    stage_history: list[StageHistoryItem]
    pending_suggestion: StageSuggestionItem | None
    updated_at: str | None


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #

class SetStageRequest(BaseModel):
    stage_id: str
    reason: str = ""


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@router.get(
    "/delivery-stages",
    response_model=DeliveryStagesResponse,
    summary="Get canonical delivery stage definitions",
)
async def get_delivery_stages() -> DeliveryStagesResponse:
    stages = CodingDeliveryService.list_stages()
    return DeliveryStagesResponse(stages=[DeliveryStageItem(**s) for s in stages])


@router.get(
    "/stage",
    response_model=ProjectStageResponse,
    summary="Get current delivery stage state for a project",
)
async def get_project_stage(
    project_root: str = Query(..., description="Absolute project root path"),
) -> ProjectStageResponse:
    try:
        payload = CodingDeliveryService.get_stage_state(project_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectStageResponse(**payload)


@router.post(
    "/stage",
    response_model=ProjectStageResponse,
    summary="Manually set the delivery stage for a project",
)
async def set_project_stage(
    body: SetStageRequest,
    project_root: str = Query(..., description="Absolute project root path"),
) -> ProjectStageResponse:
    try:
        payload = CodingDeliveryService.set_stage(
            project_root,
            stage_id=body.stage_id,
            reason=body.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectStageResponse(**payload)


@router.post(
    "/stage/suggestion/accept",
    response_model=ProjectStageResponse,
    summary="Accept a pending agent stage suggestion",
)
async def accept_stage_suggestion(
    project_root: str = Query(..., description="Absolute project root path"),
) -> ProjectStageResponse:
    try:
        payload = CodingDeliveryService.accept_suggestion(project_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectStageResponse(**payload)


@router.post(
    "/stage/suggestion/dismiss",
    response_model=ProjectStageResponse,
    summary="Dismiss a pending agent stage suggestion",
)
async def dismiss_stage_suggestion(
    project_root: str = Query(..., description="Absolute project root path"),
) -> ProjectStageResponse:
    payload = CodingDeliveryService.dismiss_suggestion(project_root)
    return ProjectStageResponse(**payload)

"""Qiongqi Coding code review API."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.gateway.coding_review_services import CodingReviewService

router = APIRouter(prefix="/api/coding", tags=["coding-review"])


class CodingReviewRequest(BaseModel):
    project_id: str = Field(..., description="Coding project id")
    project_root: str = Field(..., description="Absolute project root")
    thread_id: str = Field(..., description="Qiongqi Coding thread id")
    scope: Literal["project_diff", "task_changes", "all", "pr"] = "project_diff"
    base_ref: str | None = Field(default=None, description="Base ref for PR-level review")


class CodingApplyFixRequest(BaseModel):
    thread_id: str
    review_id: str
    finding_id: str


class CodingApplyFixResponse(BaseModel):
    thread_id: str
    review_id: str
    finding_id: str
    file: str
    applied: bool


class CodingReviewFindingResponse(BaseModel):
    id: str
    severity: Literal["critical", "major", "minor", "nitpick"]
    category: str
    file: str | None = None
    line: int | None = None
    task_id: str | None = None
    message: str
    suggestion: str
    evidence: list[str] = []
    fix: dict[str, Any] = {}


class CodingReviewResponse(BaseModel):
    review_id: str
    project_id: str
    project_root: str
    thread_id: str
    scope: str
    decision: str
    summary: dict[str, Any]
    findings: list[CodingReviewFindingResponse]
    source: dict[str, Any]
    created_at: str
    next_plan: list[str] = []


class CodingLatestReviewResponse(BaseModel):
    thread_id: str
    review: CodingReviewResponse | None = None


@router.post(
    "/reviews",
    response_model=CodingReviewResponse,
    summary="Run Qiongqi Coding Review",
)
async def run_coding_review(request: CodingReviewRequest) -> CodingReviewResponse:
    try:
        result = CodingReviewService.run_review(
            project_id=request.project_id,
            project_root=request.project_root,
            thread_id=request.thread_id,
            scope=request.scope,
            base_ref=request.base_ref,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return CodingReviewResponse(**result)


@router.post(
    "/reviews/fixes/apply",
    response_model=CodingApplyFixResponse,
    summary="Apply Qiongqi Coding Review Fix",
)
async def apply_coding_review_fix(request: CodingApplyFixRequest) -> CodingApplyFixResponse:
    try:
        result = CodingReviewService.apply_fix(
            thread_id=request.thread_id,
            review_id=request.review_id,
            finding_id=request.finding_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CodingApplyFixResponse(**result)


@router.get(
    "/sessions/{thread_id}/review",
    response_model=CodingLatestReviewResponse,
    summary="Get Latest Qiongqi Coding Review",
)
async def get_latest_coding_review(thread_id: str) -> CodingLatestReviewResponse:
    try:
        review = CodingReviewService.get_latest_review(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CodingLatestReviewResponse(thread_id=thread_id, review=review)

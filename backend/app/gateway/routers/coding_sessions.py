"""Qiongqi Coding Agent session snapshot API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.gateway.coding_session_services import CodingSessionService

router = APIRouter(prefix="/api/coding", tags=["coding-sessions"])


class QiongqiSessionSnapshotResponse(BaseModel):
    thread_id: str
    project_root: str | None = None
    scratch_root: str | None = None
    skills: list[dict[str, Any]] = []
    active_coding_skills: list[dict[str, Any]] = []
    tool_policy: list[dict[str, Any]] = []
    roi: dict[str, Any] = {}
    change_summary: dict[str, Any] = {}
    updated_at: str | None = None


class QiongqiSessionResponse(BaseModel):
    thread_id: str
    session: QiongqiSessionSnapshotResponse


@router.get(
    "/sessions/{thread_id}",
    response_model=QiongqiSessionResponse,
    summary="Get Qiongqi Coding Session Snapshot",
)
async def get_qiongqi_session(thread_id: str) -> QiongqiSessionResponse:
    try:
        result = CodingSessionService.get_session(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return QiongqiSessionResponse(**result)

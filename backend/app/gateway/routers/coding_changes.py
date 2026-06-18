"""Qiongqi Coding Agent task changes API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.gateway.coding_change_services import CodingChangeService

router = APIRouter(prefix="/api/coding", tags=["coding-changes"])


class QiongqiChangeResponse(BaseModel):
    thread_id: str
    task_id: str
    project_root: str | None
    path: str
    status: str
    additions: int
    deletions: int
    diff: str
    created_at: str


class QiongqiChangesListResponse(BaseModel):
    thread_id: str
    task_id: str | None = None
    changes: list[QiongqiChangeResponse]


class QiongqiChangeDetailResponse(BaseModel):
    thread_id: str
    task_id: str | None = None
    change: QiongqiChangeResponse


@router.get(
    "/sessions/{thread_id}/changes",
    response_model=QiongqiChangesListResponse,
    summary="List Qiongqi Coding Task Changes",
)
async def list_qiongqi_task_changes(
    thread_id: str,
    task_id: str | None = Query(default=None),
) -> QiongqiChangesListResponse:
    try:
        result = CodingChangeService.list_changes(thread_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return QiongqiChangesListResponse(**result)


@router.get(
    "/sessions/{thread_id}/changes/{path:path}",
    response_model=QiongqiChangeDetailResponse,
    summary="Get Qiongqi Coding Task File Change",
)
async def get_qiongqi_task_change(
    thread_id: str,
    path: str,
    task_id: str | None = Query(default=None),
) -> QiongqiChangeDetailResponse:
    try:
        result = CodingChangeService.get_change(thread_id, task_id=task_id, path=path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail=f"Coding change '{path}' not found")
    return QiongqiChangeDetailResponse(**result)

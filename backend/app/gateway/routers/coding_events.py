"""Qiongqi Coding Agent session events API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.gateway.coding_event_services import CodingEventService

router = APIRouter(prefix="/api/coding", tags=["coding-events"])


class QiongqiEventResponse(BaseModel):
    schema_version: int
    source: str
    seq: int
    thread_id: str
    event_type: str
    payload: dict[str, Any]
    created_at: str


class QiongqiEventsListResponse(BaseModel):
    thread_id: str
    events: list[QiongqiEventResponse]


@router.get(
    "/sessions/{thread_id}/events",
    response_model=QiongqiEventsListResponse,
    summary="List Qiongqi Coding Session Events",
)
async def list_qiongqi_session_events(
    thread_id: str,
    event_type: list[str] | None = Query(default=None),
    after_seq: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=1000),
) -> QiongqiEventsListResponse:
    try:
        result = CodingEventService.list_events(
            thread_id,
            event_types=event_type,
            after_seq=after_seq,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return QiongqiEventsListResponse(**result)

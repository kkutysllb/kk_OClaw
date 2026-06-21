"""Qiongqi Coding Agent ROI telemetry API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.gateway.coding_roi_services import CodingRoiService

router = APIRouter(prefix="/api/coding", tags=["coding-roi"])


class QiongqiRoiReportResponse(BaseModel):
    seq: int
    thread_id: str
    stable_prompt_fingerprint: str
    tool_catalog_fingerprint: str
    immutable_prefix_fingerprint: str
    full_tool_count: int
    visible_tool_count: int
    hidden_tool_count: int
    provider_usage: dict[str, int]
    tool_output: dict[str, int]
    token_economy: dict[str, int]
    created_at: str


class QiongqiRoiListResponse(BaseModel):
    thread_id: str
    reports: list[QiongqiRoiReportResponse]


class QiongqiRoiSummaryPayload(BaseModel):
    thread_id: str
    report_count: int
    latest: dict[str, Any] | None
    provider_usage: dict[str, int]
    tool_output: dict[str, int]
    token_economy: dict[str, int]
    derived: dict[str, int | float]


class QiongqiRoiSummaryResponse(BaseModel):
    thread_id: str
    summary: QiongqiRoiSummaryPayload


@router.get(
    "/sessions/{thread_id}/roi",
    response_model=QiongqiRoiListResponse,
    summary="List Qiongqi Coding ROI Telemetry",
)
async def list_qiongqi_roi_reports(thread_id: str) -> QiongqiRoiListResponse:
    try:
        result = CodingRoiService.list_reports(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return QiongqiRoiListResponse(**result)


@router.get(
    "/sessions/{thread_id}/roi/summary",
    response_model=QiongqiRoiSummaryResponse,
    summary="Get Qiongqi Coding ROI Telemetry Summary",
)
async def get_qiongqi_roi_summary(thread_id: str) -> QiongqiRoiSummaryResponse:
    try:
        result = CodingRoiService.get_summary(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return QiongqiRoiSummaryResponse(**result)

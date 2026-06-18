"""Coding Agent skills API.

These endpoints are separate from ``/api/skills`` and only expose skills from
the Coding Agent roots:

- ``<project_root>/.oclaw-coding/skills``
- ``~/.oclaw-coding/skills``
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.gateway.coding_skill_services import CodingSkillService

router = APIRouter(prefix="/api/coding", tags=["coding-skills"])


class CodingSkillResponse(BaseModel):
    id: str
    name: str
    description: str
    scope: Literal["project", "global"]
    legacy: bool
    activation_keywords: list[str]
    always_activate: bool
    allowed_tools: list[str]
    permissions: dict[str, Any] | None
    skill_file: str
    enabled: bool = True
    manifest_errors: list[str] = Field(default_factory=list)
    commands: list[dict[str, str]] = Field(default_factory=list)
    ui: dict[str, Any] | None = None


class CodingSkillsListResponse(BaseModel):
    skills: list[CodingSkillResponse]


class CodingSkillDetailResponse(BaseModel):
    skill: CodingSkillResponse
    instructions: str


class CodingSkillDeleteResponse(BaseModel):
    deleted: bool
    skill_id: str


class CodingSkillEnabledRequest(BaseModel):
    project_root: str | None = None
    scope: Literal["project", "global"]
    enabled: bool


class CodingSkillCreateRequest(BaseModel):
    project_root: str | None = None
    id: str
    name: str
    description: str
    instructions: str
    activation_keywords: list[str] = Field(default_factory=list)
    always_activate: bool = False
    allowed_tools: list[str] = Field(default_factory=list)
    permissions: dict[str, Any] | None = None


class CodingSkillUpdateRequest(BaseModel):
    project_root: str | None = None
    name: str
    description: str
    instructions: str
    activation_keywords: list[str] = Field(default_factory=list)
    always_activate: bool = False
    allowed_tools: list[str] = Field(default_factory=list)
    permissions: dict[str, Any] | None = None


@router.get("/skills", response_model=CodingSkillsListResponse, summary="List Coding Skills")
async def list_coding_skills(project_root: str | None = Query(default=None)) -> CodingSkillsListResponse:
    return CodingSkillsListResponse(skills=CodingSkillService.list_skills(project_root=project_root))


@router.post("/skills", response_model=CodingSkillDetailResponse, status_code=201, summary="Create Project Coding Skill")
async def create_coding_skill(request: CodingSkillCreateRequest) -> CodingSkillDetailResponse:
    try:
        detail = CodingSkillService.create_project_skill(
            project_root=request.project_root,
            skill_id=request.id,
            name=request.name,
            description=request.description,
            instructions=request.instructions,
            activation_keywords=request.activation_keywords,
            always_activate=request.always_activate,
            allowed_tools=request.allowed_tools,
            permissions=request.permissions,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CodingSkillDetailResponse(**detail)


@router.get("/skills/{skill_id}", response_model=CodingSkillDetailResponse, summary="Get Coding Skill")
async def get_coding_skill(skill_id: str, project_root: str | None = Query(default=None)) -> CodingSkillDetailResponse:
    detail = CodingSkillService.get_skill(skill_id, project_root=project_root)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Coding skill '{skill_id}' not found")
    return CodingSkillDetailResponse(**detail)


@router.put("/skills/{skill_id}", response_model=CodingSkillDetailResponse, summary="Update Project Coding Skill")
async def update_coding_skill(skill_id: str, request: CodingSkillUpdateRequest) -> CodingSkillDetailResponse:
    try:
        detail = CodingSkillService.update_project_skill(
            project_root=request.project_root,
            skill_id=skill_id,
            name=request.name,
            description=request.description,
            instructions=request.instructions,
            activation_keywords=request.activation_keywords,
            always_activate=request.always_activate,
            allowed_tools=request.allowed_tools,
            permissions=request.permissions,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CodingSkillDetailResponse(**detail)


@router.delete("/skills/{skill_id}", response_model=CodingSkillDeleteResponse, summary="Delete Project Coding Skill")
async def delete_coding_skill(skill_id: str, project_root: str | None = Query(default=None)) -> CodingSkillDeleteResponse:
    try:
        result = CodingSkillService.delete_project_skill(project_root=project_root, skill_id=skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CodingSkillDeleteResponse(**result)


@router.put("/skills/{skill_id}/enabled", response_model=CodingSkillDetailResponse, summary="Set Coding Skill Enabled State")
async def set_coding_skill_enabled(skill_id: str, request: CodingSkillEnabledRequest) -> CodingSkillDetailResponse:
    try:
        detail = CodingSkillService.set_skill_enabled(
            project_root=request.project_root,
            skill_id=skill_id,
            scope=request.scope,
            enabled=request.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CodingSkillDetailResponse(**detail)

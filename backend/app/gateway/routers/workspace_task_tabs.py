"""Workspace task tab persistence API."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.gateway.authz import get_auth_context
from app.gateway.workspace_task_tabs_services import WorkspaceTaskTabsService
from kkoclaw.runtime.user_context import get_effective_user_id

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

MAX_WORKSPACE_TASK_TABS = 12


class WorkspaceTaskTab(BaseModel):
    id: str = Field(..., min_length=1, max_length=160)
    href: str = Field(..., min_length=1, max_length=512)
    kind: Literal["chat", "agent", "coding"]
    title: str = Field(..., min_length=1, max_length=160)
    subtitle: str | None = Field(default=None, max_length=160)
    threadId: str | None = Field(default=None, max_length=160)
    agentName: str | None = Field(default=None, max_length=160)
    projectId: str | None = Field(default=None, max_length=160)
    lastActiveAt: int = Field(..., ge=0)

    @field_validator("href")
    @classmethod
    def _validate_workspace_href(cls, value: str) -> str:
        if not value.startswith("/workspace/"):
            raise ValueError("href must start with /workspace/")
        if "://" in value:
            raise ValueError("href must be an application-relative workspace path")
        return value


class WorkspaceTaskTabsRequest(BaseModel):
    tabs: list[WorkspaceTaskTab] = Field(default_factory=list, max_length=MAX_WORKSPACE_TASK_TABS)


class WorkspaceTaskTabsResponse(BaseModel):
    tabs: list[WorkspaceTaskTab] = Field(default_factory=list)


def _request_user_id(request: Request) -> str:
    auth = get_auth_context(request)
    if auth is not None and auth.user is not None:
        return str(auth.user.id)
    user = getattr(request.state, "user", None)
    if user is not None and getattr(user, "id", None) is not None:
        return str(user.id)
    return get_effective_user_id()


@router.get("/task-tabs", response_model=WorkspaceTaskTabsResponse, response_model_exclude_none=True)
async def get_workspace_task_tabs(request: Request) -> WorkspaceTaskTabsResponse:
    tabs = WorkspaceTaskTabsService.load_tabs(_request_user_id(request))
    return WorkspaceTaskTabsResponse(tabs=[WorkspaceTaskTab.model_validate(tab) for tab in tabs])


@router.put("/task-tabs", response_model=WorkspaceTaskTabsResponse, response_model_exclude_none=True)
async def put_workspace_task_tabs(
    body: WorkspaceTaskTabsRequest,
    request: Request,
) -> WorkspaceTaskTabsResponse:
    tabs = [tab.model_dump(exclude_none=True) for tab in body.tabs]
    saved = WorkspaceTaskTabsService.save_tabs(_request_user_id(request), tabs)
    return WorkspaceTaskTabsResponse(tabs=[WorkspaceTaskTab.model_validate(tab) for tab in saved])

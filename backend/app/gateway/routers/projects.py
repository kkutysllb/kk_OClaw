"""REST API for coding-agent project & worktree management.

Endpoints
---------
**Projects**
    GET    /api/projects                — list all registered projects
    POST   /api/projects                — register a new project
    GET    /api/projects/{project_id}   — get project details
    PUT    /api/projects/{project_id}   — update project metadata
    DELETE /api/projects/{project_id}   — unregister a project

**Worktrees** (nested under a project)
    GET    /api/projects/{project_id}/worktrees          — list worktrees
    POST   /api/projects/{project_id}/worktrees          — create worktree
    DELETE /api/projects/{project_id}/worktrees           — remove worktree
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.gateway.coding_services import (
    FileService,
    GitDiffService,
    ProjectEnvironmentService,
    ProjectService,
    WorktreeService,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["projects"])


# ---------------------------------------------------------------------------
# Pydantic models — Projects
# ---------------------------------------------------------------------------


class ProjectResponse(BaseModel):
    """Response model for a coding project."""

    id: str = Field(..., description="Unique project identifier")
    name: str = Field(..., description="Human-friendly project name")
    path: str = Field(..., description="Absolute filesystem path to the project root")
    description: str = Field(default="", description="Optional project description")
    config: dict[str, Any] = Field(default_factory=dict, description="Project configuration overrides")
    is_git_repo: bool = Field(default=False, description="Whether the path is inside a git repository")
    created_at: str = Field(..., description="ISO-8601 creation timestamp")
    updated_at: str = Field(..., description="ISO-8601 last-update timestamp")


class ProjectsListResponse(BaseModel):
    """Response model for listing projects."""

    projects: list[ProjectResponse]


class ProjectCreateRequest(BaseModel):
    """Request body for registering a new project."""

    name: str = Field(..., description="Human-friendly project name")
    path: str = Field(..., description="Absolute or relative path to the project root directory")
    description: str = Field(default="", description="Optional project description")
    config: dict[str, Any] | None = Field(default=None, description="Optional project configuration")


class ProjectUpdateRequest(BaseModel):
    """Request body for updating project metadata."""

    name: str | None = Field(default=None, description="Updated project name")
    description: str | None = Field(default=None, description="Updated description")
    config: dict[str, Any] | None = Field(default=None, description="Configuration overrides to merge")


# ---------------------------------------------------------------------------
# Pydantic models — Worktrees
# ---------------------------------------------------------------------------


class WorktreeInfo(BaseModel):
    """Information about a single git worktree."""

    path: str = Field(..., description="Absolute path of the worktree")
    branch: str | None = Field(default=None, description="Branch checked out in the worktree")
    head: str | None = Field(default=None, description="HEAD commit SHA")
    bare: str | None = Field(default=None, description="'true' if this is a bare worktree")
    detached: str | None = Field(default=None, description="'true' if HEAD is detached")


class WorktreeListResponse(BaseModel):
    """Response model for listing worktrees."""

    worktrees: list[WorktreeInfo]


class WorktreeCreateRequest(BaseModel):
    """Request body for creating a worktree."""

    branch: str = Field(..., description="New branch name for the worktree")
    base_branch: str | None = Field(default=None, description="Starting point for the new branch (default: HEAD)")
    path: str | None = Field(default=None, description="Explicit path for the worktree (optional)")


class WorktreeCreateResponse(BaseModel):
    """Response model for worktree creation."""

    path: str = Field(..., description="Path of the created worktree")
    branch: str = Field(..., description="Branch name")
    base_branch: str = Field(default="", description="Base branch used")
    repo_root: str = Field(..., description="Root repository path")


class WorktreeRemoveRequest(BaseModel):
    """Request body for removing a worktree."""

    path: str = Field(..., description="Path of the worktree to remove")
    force: bool = Field(default=False, description="Force removal even if the worktree is dirty")
    delete_branch: bool = Field(default=False, description="Also delete the associated branch")


class WorktreeRemoveResponse(BaseModel):
    """Response model for worktree removal."""

    path: str = Field(..., description="Path of the removed worktree")
    removed: str = Field(default="true", description="Confirmation")
    deleted_branch: str = Field(default="", description="Branch name that was deleted, if any")


# ---------------------------------------------------------------------------
# Pydantic models — File browsing
# ---------------------------------------------------------------------------


class FileEntry(BaseModel):
    """A single file or directory entry."""

    name: str = Field(..., description="Entry name")
    path: str = Field(..., description="Relative path from project root")
    type: str = Field(..., description="'directory' or 'file'")
    size: int = Field(default=0, description="File size in bytes (0 for directories)")
    ext: str = Field(default="", description="File extension (empty for directories)")


class FileListResponse(BaseModel):
    """Response model for listing directory contents."""

    entries: list[FileEntry]


class FileContentResponse(BaseModel):
    """Response model for reading a file."""

    path: str = Field(..., description="Relative path from project root")
    content: str = Field(..., description="File content as UTF-8 text")
    size: int = Field(..., description="File size in bytes")
    language: str = Field(default="text", description="Detected language identifier")


class ProjectDiffFile(BaseModel):
    """A single changed file in the project diff."""

    path: str = Field(..., description="Relative path from project root")
    status: str = Field(..., description="Change status: modified, added, deleted, renamed, copied")
    additions: int = Field(default=0, description="Added lines")
    deletions: int = Field(default=0, description="Deleted lines")
    previous_path: str | None = Field(default=None, description="Previous path for renamed/copied files")
    diff: str = Field(default="", description="Unified diff for this file")


class ProjectDiffResponse(BaseModel):
    """Response model for project Git diff."""

    is_git_repo: bool = Field(default=True, description="Whether the project is a Git repository")
    has_changes: bool = Field(default=False, description="Whether the project has working-tree changes")
    files: list[ProjectDiffFile] = Field(default_factory=list, description="Changed files")
    diff: str = Field(default="", description="Unified diff for all changed files")


class DiscardProjectFileChangeRequest(BaseModel):
    """Request body for discarding one changed file."""

    path: str = Field(..., description="Relative path from project root")


class DiscardProjectFileChangeResponse(BaseModel):
    """Response model for discarding one changed file."""

    path: str = Field(..., description="Relative path that was discarded")
    discarded: bool = Field(default=True, description="Whether the discard operation completed")


class GitHubCliStatusResponse(BaseModel):
    """GitHub CLI availability and auth state."""

    available: bool = Field(default=False, description="Whether gh CLI is available")
    authenticated: bool = Field(default=False, description="Whether gh CLI is authenticated")
    username: str | None = Field(default=None, description="Authenticated GitHub username")
    host: str | None = Field(default=None, description="Authenticated host")
    detail: str | None = Field(default=None, description="Human-facing status detail")


class ProjectSourceResponse(BaseModel):
    """Remote/source summary for the project."""

    label: str = Field(default="仅本地", description="Human-facing source label")
    remote: str | None = Field(default=None, description="Remote URL")
    provider: str = Field(default="local", description="Source provider key")


class ProjectEnvironmentResponse(BaseModel):
    """Response model for project environment info."""

    is_git_repo: bool = Field(default=False, description="Whether this is a git repo")
    branch: str | None = Field(default=None, description="Current branch")
    head: str | None = Field(default=None, description="Current HEAD SHA")
    upstream: str | None = Field(default=None, description="Tracked upstream branch")
    ahead: int = Field(default=0, description="Commits ahead of upstream")
    behind: int = Field(default=0, description="Commits behind upstream")
    changed_files: int = Field(default=0, description="Changed file count")
    additions: int = Field(default=0, description="Total added lines")
    deletions: int = Field(default=0, description="Total deleted lines")
    github_cli: GitHubCliStatusResponse = Field(default_factory=GitHubCliStatusResponse)
    source: ProjectSourceResponse = Field(default_factory=ProjectSourceResponse)


class GitCommitRequest(BaseModel):
    """Request body for creating a commit."""

    message: str = Field(..., description="Commit message")


class GitCommitResponse(BaseModel):
    """Response model for git commit action."""

    head: str = Field(..., description="New HEAD SHA")
    summary: str = Field(..., description="Commit summary line")
    message: str = Field(..., description="Commit message")


class GitPushResponse(BaseModel):
    """Response model for git push action."""

    branch: str = Field(..., description="Pushed branch")
    upstream: str | None = Field(default=None, description="Tracked upstream after push")
    summary: str = Field(..., description="Push summary output")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _to_project_response(proj: dict[str, Any]) -> ProjectResponse:
    """Convert a raw project dict to ProjectResponse."""
    return ProjectResponse(
        id=proj["id"],
        name=proj["name"],
        path=proj["path"],
        description=proj.get("description", ""),
        config=proj.get("config", {}),
        is_git_repo=proj.get("is_git_repo", False),
        created_at=proj["created_at"],
        updated_at=proj["updated_at"],
    )


def _require_project(project_id: str) -> dict[str, Any]:
    """Return the project dict or raise 404."""
    proj = ProjectService.get_project(project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id!r} not found")
    return proj


# ---------------------------------------------------------------------------
# Project endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/projects",
    response_model=ProjectsListResponse,
    summary="List Coding Projects",
    description="List all registered coding projects.",
)
async def list_projects() -> ProjectsListResponse:
    """List all registered coding projects."""
    projects = ProjectService.list_projects()
    return ProjectsListResponse(projects=[_to_project_response(p) for p in projects])


@router.get(
    "/projects/{project_id}",
    response_model=ProjectResponse,
    summary="Get Coding Project",
    description="Retrieve details of a specific coding project.",
)
async def get_project(project_id: str) -> ProjectResponse:
    """Get a single project by id."""
    proj = _require_project(project_id)
    return _to_project_response(proj)


@router.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=201,
    summary="Register Coding Project",
    description="Register a new coding project by pointing to its root directory.",
)
async def create_project(request: ProjectCreateRequest) -> ProjectResponse:
    """Register a new coding project."""
    try:
        proj = ProjectService.create_project(
            name=request.name,
            path=request.path,
            description=request.description,
            config=request.config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to create project: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create project: {exc}") from exc
    return _to_project_response(proj)


@router.put(
    "/projects/{project_id}",
    response_model=ProjectResponse,
    summary="Update Coding Project",
    description="Update metadata or configuration of a registered project.",
)
async def update_project(project_id: str, request: ProjectUpdateRequest) -> ProjectResponse:
    """Update an existing project."""
    try:
        proj = ProjectService.update_project(
            project_id,
            name=request.name,
            description=request.description,
            config=request.config,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to update project %s: %s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update project: {exc}") from exc
    return _to_project_response(proj)


@router.delete(
    "/projects/{project_id}",
    status_code=204,
    summary="Delete Coding Project",
    description="Unregister a coding project.  The files on disk are not touched.",
)
async def delete_project(project_id: str) -> None:
    """Delete a project registration."""
    _require_project(project_id)
    ProjectService.delete_project(project_id)


# ---------------------------------------------------------------------------
# Worktree endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/worktrees",
    response_model=WorktreeListResponse,
    summary="List Worktrees",
    description="List all git worktrees in the project repository.",
)
async def list_worktrees(project_id: str) -> WorktreeListResponse:
    """List all worktrees for a project."""
    proj = _require_project(project_id)
    try:
        raw = WorktreeService.list_worktrees(proj["path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    worktrees = [
        WorktreeInfo(
            path=wt.get("path", ""),
            branch=wt.get("branch"),
            head=wt.get("head"),
            bare=wt.get("bare"),
            detached=wt.get("detached"),
        )
        for wt in raw
    ]
    return WorktreeListResponse(worktrees=worktrees)


@router.post(
    "/projects/{project_id}/worktrees",
    response_model=WorktreeCreateResponse,
    status_code=201,
    summary="Create Worktree",
    description="Create a new git worktree with a fresh branch for isolated work.",
)
async def create_worktree(project_id: str, request: WorktreeCreateRequest) -> WorktreeCreateResponse:
    """Create a worktree for a project."""
    proj = _require_project(project_id)
    try:
        result = WorktreeService.create_worktree(
            proj["path"],
            branch=request.branch,
            base_branch=request.base_branch,
            worktree_path=request.path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to create worktree: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create worktree: {exc}") from exc
    return WorktreeCreateResponse(**result)


@router.delete(
    "/projects/{project_id}/worktrees",
    response_model=WorktreeRemoveResponse,
    summary="Remove Worktree",
    description="Remove a git worktree from the project repository.",
)
async def remove_worktree(project_id: str, request: WorktreeRemoveRequest) -> WorktreeRemoveResponse:
    """Remove a worktree."""
    proj = _require_project(project_id)
    try:
        result = WorktreeService.remove_worktree(
            proj["path"],
            worktree_path=request.path,
            force=request.force,
            delete_branch=request.delete_branch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to remove worktree: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to remove worktree: {exc}") from exc
    return WorktreeRemoveResponse(**result)


# ---------------------------------------------------------------------------
# File browsing endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/files",
    response_model=FileListResponse,
    summary="List Project Files",
    description="List the contents of a directory within a project.",
)
async def list_files(project_id: str, path: str = ".") -> FileListResponse:
    """List directory contents in a project."""
    proj = _require_project(project_id)
    try:
        entries = FileService.list_directory(proj["path"], path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileListResponse(entries=[FileEntry(**e) for e in entries])


@router.get(
    "/projects/{project_id}/file",
    response_model=FileContentResponse,
    summary="Read Project File",
    description="Read the content of a file within a project.",
)
async def read_file(project_id: str, path: str) -> FileContentResponse:
    """Read a file from a project."""
    proj = _require_project(project_id)
    try:
        result = FileService.read_file(proj["path"], path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileContentResponse(**result)


@router.get(
    "/projects/{project_id}/diff",
    response_model=ProjectDiffResponse,
    summary="Get Project Diff",
    description="Return Git working-tree changes for a coding project.",
)
async def get_project_diff(project_id: str) -> ProjectDiffResponse:
    """Return changed files and unified diff for a project."""
    proj = _require_project(project_id)
    try:
        result = GitDiffService.get_diff(proj["path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return ProjectDiffResponse(**result)


@router.get(
    "/projects/{project_id}/environment",
    response_model=ProjectEnvironmentResponse,
    summary="Get Project Environment",
    description="Return git branch, GitHub CLI identity, source and sync state for a coding project.",
)
async def get_project_environment(project_id: str) -> ProjectEnvironmentResponse:
    """Return project git environment summary."""
    proj = _require_project(project_id)
    try:
        result = ProjectEnvironmentService.get_environment(proj["path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return ProjectEnvironmentResponse(**result)


@router.post(
    "/projects/{project_id}/git/commit",
    response_model=GitCommitResponse,
    summary="Commit Project Changes",
    description="Stage all current project changes and create a real git commit.",
)
async def commit_project_changes(
    project_id: str,
    request: GitCommitRequest,
) -> GitCommitResponse:
    """Create a git commit for the project."""
    proj = _require_project(project_id)
    try:
        result = ProjectEnvironmentService.commit_changes(proj["path"], request.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return GitCommitResponse(**result)


@router.post(
    "/projects/{project_id}/git/push",
    response_model=GitPushResponse,
    summary="Push Project Branch",
    description="Push the current branch to its configured upstream, creating upstream when possible.",
)
async def push_project_branch(project_id: str) -> GitPushResponse:
    """Push the current branch for the project."""
    proj = _require_project(project_id)
    try:
        result = ProjectEnvironmentService.push_branch(proj["path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return GitPushResponse(**result)


@router.post(
    "/projects/{project_id}/diff/discard",
    response_model=DiscardProjectFileChangeResponse,
    summary="Discard Project File Change",
    description="Discard working-tree changes for one file in a coding project.",
)
async def discard_project_file_change(
    project_id: str,
    request: DiscardProjectFileChangeRequest,
) -> DiscardProjectFileChangeResponse:
    """Discard one changed file from the project working tree."""
    proj = _require_project(project_id)
    try:
        result = GitDiffService.discard_file_change(proj["path"], request.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return DiscardProjectFileChangeResponse(**result)

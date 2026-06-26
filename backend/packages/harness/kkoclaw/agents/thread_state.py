from typing import Annotated, Any, NotRequired, TypedDict

from langchain.agents import AgentState


class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]


class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]
    project_root: NotRequired[str | None]


class ViewedImageData(TypedDict):
    base64: str
    mime_type: str


def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    """Reducer for artifacts list - merges and deduplicates artifacts."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    # Use dict.fromkeys to deduplicate while preserving order
    return list(dict.fromkeys(existing + new))


def merge_viewed_images(existing: dict[str, ViewedImageData] | None, new: dict[str, ViewedImageData] | None) -> dict[str, ViewedImageData]:
    """Reducer for viewed_images dict - merges image dictionaries.

    Special case: If new is an empty dict {}, it clears the existing images.
    This allows middlewares to clear the viewed_images state after processing.
    """
    if existing is None:
        return new or {}
    if new is None:
        return existing
    # Special case: empty dict means clear all viewed images
    if len(new) == 0:
        return {}
    # Merge dictionaries, new values override existing ones for same keys
    return {**existing, **new}


class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    todo_completion_control: NotRequired[dict[str, Any] | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]  # image_path -> {base64, mime_type}


class RuntimeContext(TypedDict, total=False):
    """Schema for ``Runtime.context`` — declared as ``context_schema`` so
    Pydantic knows the actual type and stops emitting::

        PydanticSerializationUnexpectedValue(Expected `none` ... field_name='context')

    Fields are ``total=False`` because different call sites populate different
    subsets.  The dict is built by ``_build_runtime_context`` in the worker and
    then enriched by middlewares / tools at runtime.
    """

    thread_id: str
    run_id: str
    sandbox_id: str
    agent_name: str
    app_config: Any


# ---------------------------------------------------------------------------
# Coding Agent state extensions
# ---------------------------------------------------------------------------


class CodingProjectState(TypedDict):
    """Metadata for the currently open coding project."""

    root: str
    name: str
    branch: NotRequired[str]
    worktree_path: NotRequired[str]
    language: NotRequired[str]
    framework: NotRequired[str]


class FileDiff(TypedDict):
    """A single file-level diff entry produced by coding tools."""

    file_path: str
    status: str  # "added" | "modified" | "deleted" | "renamed"
    additions: int
    deletions: int
    diff: NotRequired[str]


class TestResult(TypedDict):
    """Structured result of a test or lint run."""

    command: str
    passed: bool
    output: str
    summary: NotRequired[dict[str, Any] | None]
    duration_ms: NotRequired[int]


class PermissionDecision(TypedDict):
    """Record of a user permission decision for a sensitive operation."""

    tool: str
    args: dict[str, Any]
    decision: str  # "approved" | "denied" | "always"
    reason: NotRequired[str]


class ActiveCodingSkillState(TypedDict):
    """Runtime policy metadata for a Coding skill activated in the current turn."""

    id: str
    allowed_tools: NotRequired[list[str]]


class CodeSessionState(TypedDict):
    """Per-session coding metadata."""

    model: str
    plan_mode: NotRequired[bool]
    todos: NotRequired[list[dict]]
    iter_count: NotRequired[int]
    iteration_limit: NotRequired[int]


def merge_diffs(existing: list[FileDiff] | None, new: list[FileDiff] | None) -> list[FileDiff]:
    """Reducer for diff list — merges by file_path, later entries override."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    by_path: dict[str, FileDiff] = {d["file_path"]: d for d in existing}
    for d in new:
        by_path[d["file_path"]] = d
    return list(by_path.values())


_TEST_RESULTS_CAP = 20


def merge_test_results(
    existing: list[TestResult] | None,
    new: list[TestResult] | None,
) -> list[TestResult]:
    """Reducer for test_results list — appends new results, caps total.

    Without a custom reducer, ``Command(update={"test_results": [...]})``
    would **overwrite** the entire list, losing prior lint/test outcomes.
    This reducer appends instead, keeping at most ``_TEST_RESULTS_CAP``
    most-recent entries so ``_summarize_run_outcome`` always sees the
    latest lint *and* test results from the current turn.
    """
    if existing is None:
        return new or []
    if new is None:
        return existing
    combined = existing + new
    if len(combined) > _TEST_RESULTS_CAP:
        combined = combined[-_TEST_RESULTS_CAP:]
    return combined


class CodingThreadState(ThreadState):
    """Extended state schema for the Coding Agent.

    Inherits all fields from :class:`ThreadState` and adds coding-specific
    fields for project context, file diffs, test results, permission
    decisions, and session metadata.
    """

    project: NotRequired[CodingProjectState | None]
    diff: Annotated[list[FileDiff], merge_diffs]
    test_results: Annotated[list[TestResult], merge_test_results]
    permission_decisions: NotRequired[list[PermissionDecision] | None]
    active_coding_skills: NotRequired[list[ActiveCodingSkillState] | None]
    code_session: NotRequired[CodeSessionState | None]

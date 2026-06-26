"""Git worktree management tools for the Coding Agent.

Provides:
- ``create_worktree``: Create an isolated git worktree for parallel work
- ``remove_worktree``: Remove a previously created worktree
- ``list_worktrees``: List all worktrees of the current repository
"""

import json
import re
import shlex

from langchain.tools import tool

from kkoclaw.sandbox.tools import (
    _sanitize_error,
    execute_sandbox_command,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
)
from kkoclaw.tools.types import Runtime

def _run_git(runtime: Runtime, args: str) -> str:
    """Run a git subcommand in the sandbox and return stdout."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)
    return execute_sandbox_command(runtime, sandbox, f"git {args}")


def _get_repo_root(runtime: Runtime) -> str:
    """Return the absolute path of the git repository root."""
    output = _run_git(runtime, "rev-parse --show-toplevel")
    root = output.strip()
    if not root:
        raise RuntimeError("Not inside a git repository.")
    return root


@tool("create_worktree", parse_docstring=True)
def create_worktree_tool(
    runtime: Runtime,
    branch: str,
    base_branch: str = "main",
    path: str | None = None,
) -> str:
    """Create a new git worktree with a dedicated branch.

    Worktrees allow parallel development in isolated directories without
    cloning the repository multiple times.

    Args:
        branch: Name of the new branch to create in the worktree.
        base_branch: The branch to base the new worktree on. Default "main".
        path: Optional absolute path for the worktree directory.
            If None, a default location under ``../.worktrees/<branch>`` is used.
    """
    try:
        repo_root = _get_repo_root(runtime)

        if path is None:
            # Default: sibling directory to avoid nesting inside the repo
            import posixpath

            repo_name = posixpath.basename(repo_root.rstrip("/"))
            path = posixpath.join(
                posixpath.dirname(repo_root.rstrip("/")),
                f".worktrees_{repo_name}",
                branch,
            )

        escaped_path = shlex.quote(path)
        escaped_branch = shlex.quote(branch)
        escaped_base = shlex.quote(base_branch)

        # Create branch from base, then add worktree
        _run_git(runtime, f"branch {escaped_branch} {escaped_base} 2>/dev/null || true")
        output = _run_git(runtime, f"worktree add {escaped_path} {escaped_branch}")

        result = {
            "branch": branch,
            "base_branch": base_branch,
            "path": path,
            "output": output.strip() or f"Created worktree at {path} on branch {branch}",
        }
        return json.dumps(result, indent=2)
    except RuntimeError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Error: Failed to create worktree: {_sanitize_error(e, runtime)}"


@tool("remove_worktree", parse_docstring=True)
def remove_worktree_tool(
    runtime: Runtime,
    path: str,
    force: bool = False,
    delete_branch: bool = False,
) -> str:
    """Remove an existing git worktree.

    Args:
        path: Absolute path of the worktree to remove.
        force: If True, force removal even if the worktree has uncommitted changes. Default False.
        delete_branch: If True, also delete the branch associated with the worktree. Default False.
    """
    try:
        escaped_path = shlex.quote(path)
        flag = "--force" if force else ""
        output = _run_git(runtime, f"worktree remove {flag} {escaped_path}")

        messages = [output.strip()] if output.strip() else [f"Removed worktree at {path}"]

        if delete_branch:
            # Extract branch name from the worktree list before removing
            try:
                list_output = _run_git(runtime, "worktree list --porcelain")
                branch_name = None
                current_wt = None
                for line in list_output.splitlines():
                    if line.startswith("worktree "):
                        current_wt = line.split(" ", 1)[1]
                    elif line.startswith("branch ") and current_wt == path:
                        branch_name = line.split(" ", 1)[1].replace("refs/heads/", "")
                        break

                if branch_name:
                    del_output = _run_git(runtime, f"branch -D {shlex.quote(branch_name)}")
                    messages.append(f"Deleted branch: {branch_name}")
            except Exception:
                pass  # Branch deletion is best-effort

        return "\n".join(messages)
    except Exception as e:
        return f"Error: Failed to remove worktree: {_sanitize_error(e, runtime)}"


@tool("list_worktrees", parse_docstring=True)
def list_worktrees_tool(
    runtime: Runtime,
    porcelain: bool = False,
) -> str:
    """List all git worktrees of the current repository.

    Args:
        porcelain: If True, return raw ``git worktree list --porcelain`` output. Default False.
    """
    try:
        if porcelain:
            return _run_git(runtime, "worktree list --porcelain")

        raw = _run_git(runtime, "worktree list")
        if not raw.strip():
            return json.dumps({"worktrees": []}, indent=2)

        worktrees: list[dict] = []
        for line in raw.strip().splitlines():
            # Format: /path/to/worktree  (branch_name)
            m = re.match(r"^(\S+)\s+(\S+)(?:\s+\((.+)\))?", line)
            if m:
                wt_path = m.group(1)
                commit = m.group(2)
                branch = m.group(3) or "(detached)"
                worktrees.append({
                    "path": wt_path,
                    "commit": commit[:8],
                    "branch": branch,
                })

        return json.dumps({"worktrees": worktrees}, indent=2)
    except Exception as e:
        return f"Error: Failed to list worktrees: {_sanitize_error(e, runtime)}"

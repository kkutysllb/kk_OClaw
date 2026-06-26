"""Structured git tools for the Coding Agent.

Provides:
- ``git_status``: Structured working-tree status (JSON-like text)
- ``git_diff``: Show staged or unstaged diffs
- ``git_log``: Recent commit history
- ``git_commit``: Stage and commit changes
"""

import json
import shlex

from langchain.tools import tool

from kkoclaw.sandbox.tools import (
    _sanitize_error,
    execute_sandbox_command,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
)
from kkoclaw.tools.types import Runtime

def _run_git(runtime: Runtime, args: str) -> str:
    """Run a git subcommand in the sandbox workspace and return stdout."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)
    # When the coding agent has an open project, run git from that project
    # root so commands see the real repository state.
    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None
    if project_root:
        cmd = f'cd "{project_root}" && git {args}'
    else:
        cmd = f"git {args}"
    return execute_sandbox_command(runtime, sandbox, cmd)


@tool("git_status", parse_docstring=True)
def git_status_tool(
    runtime: Runtime,
    porcelain: bool = False,
) -> str:
    """Show the working tree status of the current git repository.

    Returns a structured summary of staged, unstaged, and untracked files.
    Use ``porcelain=True`` for the raw machine-readable format.

    Args:
        porcelain: If True, return raw ``git status --porcelain`` output. Default False.
    """
    try:
        if porcelain:
            return _run_git(runtime, "status --porcelain")

        # Gather structured data
        branch_line = _run_git(runtime, "branch --show-current").strip()
        porcelain_raw = _run_git(runtime, "status --porcelain")

        if not porcelain_raw.strip():
            return json.dumps(
                {
                    "branch": branch_line or "(detached HEAD)",
                    "clean": True,
                    "staged": [],
                    "unstaged": [],
                    "untracked": [],
                },
                indent=2,
            )

        staged: list[dict] = []
        unstaged: list[dict] = []
        untracked: list[str] = []

        for line in porcelain_raw.splitlines():
            if len(line) < 3:
                continue
            x = line[0]  # staged status
            y = line[1]  # unstaged status
            path = line[3:]

            if x != " " and x != "?":
                staged.append({"status": x, "file": path})
            if y != " " and y != "?":
                unstaged.append({"status": y, "file": path})
            if x == "?" or y == "?":
                untracked.append(path)

        return json.dumps(
            {
                "branch": branch_line or "(detached HEAD)",
                "clean": False,
                "staged": staged,
                "unstaged": unstaged,
                "untracked": untracked,
            },
            indent=2,
        )
    except Exception as e:
        return f"Error: Failed to get git status: {_sanitize_error(e, runtime)}"


@tool("git_diff", parse_docstring=True)
def git_diff_tool(
    runtime: Runtime,
    staged: bool = True,
    file_path: str | None = None,
    max_chars: int = 20000,
) -> str:
    """Show git diff for staged and/or unstaged changes.

    Args:
        staged: If True, show staged changes (``--cached``). Default True.
        file_path: Optional path filter — only show diff for this file.
        max_chars: Maximum output size in characters. Default 20000.
    """
    try:
        args = "diff"
        if staged:
            args += " --cached"
        if file_path:
            args += f" -- {shlex.quote(file_path)}"

        output = _run_git(runtime, args)
        if not output.strip():
            return "(no changes)"

        if len(output) > max_chars:
            output = output[:max_chars] + f"\n... (truncated at {max_chars} chars)"
        return output
    except Exception as e:
        return f"Error: Failed to get git diff: {_sanitize_error(e, runtime)}"


@tool("git_log", parse_docstring=True)
def git_log_tool(
    runtime: Runtime,
    count: int = 10,
    oneline: bool = True,
    file_path: str | None = None,
) -> str:
    """Show recent git commit history.

    Args:
        count: Number of commits to show. Default 10.
        oneline: If True, use compact ``--oneline`` format. Default True.
        file_path: Optional filter — only show commits touching this file.
    """
    try:
        args = f"log -{min(count, 100)}"
        if oneline:
            args += " --oneline"
        else:
            args += " --format='%H%n  Author: %an <%ae>%n  Date:   %ad%n%n    %s%n'"
        if file_path:
            args += f" -- {shlex.quote(file_path)}"

        output = _run_git(runtime, args)
        if not output.strip():
            return "(no commits)"
        return output
    except Exception as e:
        return f"Error: Failed to get git log: {_sanitize_error(e, runtime)}"


@tool("git_commit", parse_docstring=True)
def git_commit_tool(
    runtime: Runtime,
    message: str,
    add_all: bool = True,
    conventional: bool = True,
) -> str:
    """Stage and commit changes to the git repository.

    When ``conventional`` is True and the message lacks a valid type prefix
    (such as feat, fix, docs, refactor, test, chore), ``chore`` is prepended
    automatically.

    Args:
        message: The commit message text.
        add_all: If True, run ``git add -A`` before committing. Default True.
        conventional: If True, validate/enforce Conventional Commits format. Default True.
    """
    try:
        _VALID_TYPES = {"feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"}

        msg = message.strip()
        if conventional:
            # Check if message starts with a valid type prefix
            colon_idx = msg.find(":")
            if colon_idx > 0:
                type_part = msg[:colon_idx].split("(")[0].strip().lower()
                if type_part not in _VALID_TYPES:
                    msg = f"chore: {msg}"
            else:
                msg = f"chore: {msg}"

        if add_all:
            _run_git(runtime, "add -A")

        # Use -F - to read message from stdin via heredoc-style approach
        # sandbox.execute_command runs via bash so we can use printf
        escaped_msg = msg.replace("'", "'\\''")
        output = _run_git(runtime, f"commit -m '{escaped_msg}'")

        if "nothing to commit" in output.lower() or "no changes" in output.lower():
            return "Nothing to commit — working tree is clean."

        return output if output.strip() else "OK: Committed."
    except Exception as e:
        return f"Error: Failed to commit: {_sanitize_error(e, runtime)}"


@tool("git_branch", parse_docstring=True)
def git_branch_tool(
    runtime: Runtime,
    action: str = "list",
    branch: str | None = None,
    base: str | None = None,
) -> str:
    """List, create, or delete branches.

    Args:
        action: One of ``list`` (default), ``create``, ``delete``, ``current``.
        branch: Branch name (required for create/delete).
        base: Base branch to create from (for create). Defaults to current HEAD.
    """
    try:
        if action == "list":
            return _run_git(runtime, "branch -vv")
        elif action == "current":
            return _run_git(runtime, "branch --show-current").strip()
        elif action == "create":
            if not branch:
                return "Error: 'branch' is required for create action."
            base_arg = f" {shlex.quote(base)}" if base else ""
            return _run_git(runtime, f"branch {shlex.quote(branch)}{base_arg}")
        elif action == "delete":
            if not branch:
                return "Error: 'branch' is required for delete action."
            return _run_git(runtime, f"branch -d {shlex.quote(branch)}")
        else:
            return f"Error: Unknown action '{action}'. Use: list, create, delete, current."
    except Exception as e:
        return f"Error: Failed git branch operation: {_sanitize_error(e, runtime)}"


@tool("git_checkout", parse_docstring=True)
def git_checkout_tool(
    runtime: Runtime,
    branch: str,
    create: bool = False,
) -> str:
    """Switch to a different branch or create a new branch and switch to it.

    Args:
        branch: The branch name to checkout or create.
        create: If True, create the branch if it doesn't exist (``-b``). Default False.
    """
    try:
        flag = "-b" if create else ""
        output = _run_git(runtime, f"checkout {flag} {shlex.quote(branch)}")
        return output.strip() or f"Switched to branch '{branch}'."
    except Exception as e:
        return f"Error: Failed to checkout branch: {_sanitize_error(e, runtime)}"


@tool("git_push", parse_docstring=True)
def git_push_tool(
    runtime: Runtime,
    remote: str = "origin",
    branch: str | None = None,
    set_upstream: bool = False,
    force: bool = False,
) -> str:
    """Push local commits to a remote repository.

    Args:
        remote: Remote name. Default "origin".
        branch: Branch to push. If None, pushes the current branch.
        set_upstream: If True, set upstream tracking (``-u``). Default False.
        force: If True, force push (``--force-with-lease``). Default False.
    """
    try:
        flags = []
        if set_upstream:
            flags.append("-u")
        if force:
            flags.append("--force-with-lease")

        args = f"push {' '.join(flags)} {shlex.quote(remote)}"
        if branch:
            args += f" {shlex.quote(branch)}"

        output = _run_git(runtime, args)
        return output.strip() or "OK: Pushed."
    except Exception as e:
        return f"Error: Failed to push: {_sanitize_error(e, runtime)}"


@tool("git_stash", parse_docstring=True)
def git_stash_tool(
    runtime: Runtime,
    action: str = "push",
    message: str | None = None,
) -> str:
    """Stash or unstash working directory changes.

    Args:
        action: One of ``push`` (default), ``pop``, ``list``, ``drop``, ``apply``.
        message: Stash message (for push action only).
    """
    try:
        if action == "push":
            args = "stash push"
            if message:
                args += f" -m {shlex.quote(message)}"
            return _run_git(runtime, args).strip() or "OK: Changes stashed."
        elif action == "pop":
            return _run_git(runtime, "stash pop").strip() or "OK: Stash popped."
        elif action == "list":
            return _run_git(runtime, "stash list").strip() or "(no stashes)"
        elif action == "apply":
            return _run_git(runtime, "stash apply").strip() or "OK: Stash applied."
        elif action == "drop":
            return _run_git(runtime, "stash drop").strip() or "OK: Stash dropped."
        else:
            return f"Error: Unknown action '{action}'. Use: push, pop, list, apply, drop."
    except Exception as e:
        return f"Error: Failed stash operation: {_sanitize_error(e, runtime)}"


@tool("git_show", parse_docstring=True)
def git_show_tool(
    runtime: Runtime,
    ref: str = "HEAD",
    stat_only: bool = False,
    max_chars: int = 20000,
) -> str:
    """Show details of a specific commit.

    Args:
        ref: Commit hash, tag, or ref. Default "HEAD".
        stat_only: If True, show only the stat summary (file changes), not the full diff.
        max_chars: Maximum output size. Default 20000.
    """
    try:
        args = f"show {shlex.quote(ref)}"
        if stat_only:
            args += " --stat"
        output = _run_git(runtime, args)
        if len(output) > max_chars:
            output = output[:max_chars] + f"\n... (truncated at {max_chars} chars)"
        return output.strip() or "(empty)"
    except Exception as e:
        return f"Error: Failed to show commit: {_sanitize_error(e, runtime)}"

"""PR creation and code review tools for the Coding Agent.

Provides:
- ``create_pr``: Create a pull request via the ``gh`` CLI (GitHub)
- ``review_code``: Generate a structured code review from the current diff
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


def _run_cmd(runtime: Runtime, cmd: str) -> str:
    """Run a shell command in the sandbox and return stdout."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)
    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None
    if project_root:
        cmd = f'cd "{project_root}" && {cmd}'
    return execute_sandbox_command(runtime, sandbox, cmd)


def _run_git(runtime: Runtime, args: str) -> str:
    """Run a git subcommand."""
    return _run_cmd(runtime, f"git {args}")


@tool("create_pr", parse_docstring=True)
def create_pr_tool(
    runtime: Runtime,
    title: str | None = None,
    body: str | None = None,
    base: str | None = None,
    draft: bool = False,
) -> str:
    """Create a GitHub pull request from the current branch.

    Uses the ``gh`` CLI to create a PR. Requires that ``gh`` is installed
    and authenticated, and that the current branch has been pushed to the
    remote.

    If ``title`` or ``body`` are not provided, they will be auto-generated
    from the commit messages on the current branch.

    Args:
        title: PR title. If None, auto-generated from the latest commit.
        body: PR description. If None, auto-generated from commit messages.
        base: Target branch for the PR. If None, uses the default branch.
        draft: If True, create as a draft PR. Default False.
    """
    try:
        # Check if gh CLI is available
        gh_check = _run_cmd(runtime, "which gh 2>/dev/null")
        if not gh_check.strip():
            return (
                "Error: GitHub CLI (gh) is not installed. "
                "Install it from https://cli.github.com/ and run 'gh auth login'."
            )

        # Determine current branch
        current_branch = _run_git(runtime, "branch --show-current").strip()
        if not current_branch:
            return "Error: Could not determine current branch (detached HEAD?)."

        # Auto-generate title from latest commit if not provided
        if not title:
            title = _run_git(runtime, "log -1 --format='%s'").strip()
            if not title:
                return "Error: No commits found to generate PR title."

        # Auto-generate body from commit messages if not provided
        if not body:
            # Get commits unique to this branch (ahead of remote)
            log_output = _run_git(
                runtime,
                f"log --oneline origin/{current_branch}..HEAD 2>/dev/null || "
                f"log -5 --oneline",
            ).strip()
            body = f"## Commits\n\n{log_output}\n"

        # Build gh pr create command
        cmd_parts = [
            "gh", "pr", "create",
            "--title", shlex.quote(title),
            "--body", shlex.quote(body),
        ]
        if base:
            cmd_parts.extend(["--base", shlex.quote(base)])
        if draft:
            cmd_parts.append("--draft")

        result = _run_cmd(runtime, " ".join(cmd_parts))

        if result.strip():
            # Extract PR URL from output
            for line in result.strip().splitlines():
                if "https://" in line or "http://" in line:
                    return json.dumps(
                        {
                            "success": True,
                            "url": line.strip(),
                            "branch": current_branch,
                            "title": title,
                            "draft": draft,
                        },
                        indent=2,
                    )
            return result.strip()

        return "Error: gh pr create returned empty output. Check 'gh auth status'."
    except Exception as e:
        return f"Error: Failed to create PR: {_sanitize_error(e, runtime)}"


@tool("review_code", parse_docstring=True)
def review_code_tool(
    runtime: Runtime,
    target: str = "unstaged",
    file_path: str | None = None,
    max_diff_chars: int = 50000,
) -> str:
    """Gather diff data and prepare a structured code review context.

    This tool collects the diff, file stats, and surrounding context so the
    agent can produce a comprehensive review report following the code-review
    skill format (correctness / security / performance / design / style).

    Args:
        target: What to review — ``unstaged`` (default), ``staged``, ``committed``
            (diff of HEAD vs its parent), or a git ref range like ``main..feature``.
        file_path: Optional path filter — only review this file.
        max_diff_chars: Maximum diff size to collect. Default 50000.
    """
    try:
        # Build the diff command based on target
        if target == "unstaged":
            diff_cmd = "diff"
        elif target == "staged":
            diff_cmd = "diff --cached"
        elif target == "committed":
            diff_cmd = "diff HEAD~1 HEAD"
        else:
            # Treat as a ref range
            diff_cmd = f"diff {shlex.quote(target)}"

        if file_path:
            diff_cmd += f" -- {shlex.quote(file_path)}"

        raw_diff = _run_git(runtime, diff_cmd)
        if not raw_diff.strip():
            return json.dumps(
                {
                    "status": "no_changes",
                    "message": f"No changes found for target='{target}'.",
                },
                indent=2,
            )

        # Truncate if too large
        truncated = len(raw_diff) > max_diff_chars
        diff_content = raw_diff[:max_diff_chars] if truncated else raw_diff

        # Get file stats
        stat_cmd = diff_cmd.replace("diff", "diff --stat")
        if "--stat" not in stat_cmd:
            stat_cmd = diff_cmd + " --stat"
        stats = _run_git(runtime, stat_cmd).strip()

        # Get current branch
        branch = _run_git(runtime, "branch --show-current").strip()

        # List changed files
        changed_files: list[str] = []
        for line in raw_diff.splitlines():
            if line.startswith("diff --git"):
                parts = line.split(" b/", 1)
                if len(parts) == 2:
                    changed_files.append(parts[1].strip())

        result = {
            "status": "ok",
            "branch": branch or "(detached HEAD)",
            "target": target,
            "changed_files": changed_files,
            "stats": stats,
            "diff": diff_content,
            "truncated": truncated,
            "review_instructions": (
                "Review the diff above using these categories:\n"
                "1. [must-fix] Correctness: logic errors, null handling, edge cases\n"
                "2. [must-fix] Security: injection, auth bypass, secrets, input validation\n"
                "3. [should-fix] Performance: N+1 queries, unbounded loops, memory leaks\n"
                "4. [discuss] Design: coupling, abstraction, naming, consistency\n"
                "5. [nit] Style: formatting, docs, imports, conventions\n\n"
                "For each issue: file + line, explanation, and suggested fix.\n"
                "End with a summary: approve / request changes / block."
            ),
        }

        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: Failed to prepare review: {_sanitize_error(e, runtime)}"

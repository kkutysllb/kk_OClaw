"""Enhanced file editing tools for the Coding Agent.

Provides:
- ``apply_diff``: Apply a unified-diff patch to a file
- ``insert_at_line``: Insert text at a specific line number
- ``multi_edit``: Apply multiple edits to one or more files in a single call
"""

import re

from langchain.tools import tool

from kkoclaw.coding_core.change_tracking import (
    build_file_diff_entry,
    commit_edit_to_state,
    record_runtime_file_change,
)
from kkoclaw.coding_core.edit_snapshots import record_edit_snapshot
from kkoclaw.sandbox.exceptions import SandboxError
from kkoclaw.sandbox.file_operation_lock import get_file_operation_lock
from kkoclaw.sandbox.tools import (
    _resolve_and_validate_user_data_path,
    _sanitize_error,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
    is_local_sandbox,
    validate_local_tool_path,
)
from kkoclaw.tools.types import Runtime

# Unified-diff hunk header: @@ -old_start,old_count +new_start,new_count @@
_HUNK_HEADER_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _parse_unified_diff(diff_text: str) -> list[dict]:
    """Parse a unified diff into a list of hunk dicts.

    Each hunk: ``{"old_start": int, "lines": [(action, text), ...]}``
    where action is ``" "``, ``"-"``, or ``"+"``.
    """
    hunks: list[dict] = []
    current_hunk: dict | None = None

    for line in diff_text.splitlines():
        if line.startswith("@@"):
            m = _HUNK_HEADER_RE.match(line)
            if m:
                if current_hunk is not None:
                    hunks.append(current_hunk)
                current_hunk = {
                    "old_start": int(m.group(1)),
                    "lines": [],
                }
            continue

        if current_hunk is None:
            # Skip file headers (--- / +++) and any preamble
            continue

        if line.startswith("+"):
            current_hunk["lines"].append(("+", line[1:]))
        elif line.startswith("-"):
            current_hunk["lines"].append(("-", line[1:]))
        elif line.startswith(" "):
            current_hunk["lines"].append((" ", line[1:]))
        elif line == "":
            # Empty lines in diff represent unchanged empty lines
            current_hunk["lines"].append((" ", ""))
        # Lines starting with \ are ignored (no newline markers)

    if current_hunk is not None:
        hunks.append(current_hunk)

    return hunks


def _apply_hunks(lines: list[str], hunks: list[dict]) -> list[str]:
    """Apply parsed hunks to a list of file lines. Returns new line list."""
    result = list(lines)
    # Track offset as earlier hunks shift line numbers
    offset = 0

    for hunk in hunks:
        old_start = hunk["old_start"] - 1 + offset  # 0-indexed
        idx = old_start
        new_segment: list[str] = []

        for action, text in hunk["lines"]:
            if action == " ":
                # Context line — verify it matches
                if idx < len(result) and result[idx].rstrip("\n") == text.rstrip("\n"):
                    new_segment.append(text)
                    idx += 1
                else:
                    raise ValueError(
                        f"Context mismatch at line {idx + 1 - offset}: "
                        f"expected {text!r}, got "
                        f"{result[idx].rstrip(chr(10)) if idx < len(result) else '(EOF)'!r}"
                    )
            elif action == "-":
                # Deletion — verify and skip
                if idx < len(result) and result[idx].rstrip("\n") == text.rstrip("\n"):
                    idx += 1
                else:
                    raise ValueError(
                        f"Deletion mismatch at line {idx + 1 - offset}: "
                        f"expected {text!r}, got "
                        f"{result[idx].rstrip(chr(10)) if idx < len(result) else '(EOF)'!r}"
                    )
            elif action == "+":
                new_segment.append(text)

        # Replace old_start..idx with new_segment
        result = result[:old_start] + new_segment + result[idx:]
        offset += len(new_segment) - (idx - old_start)

    return result


def _resolve_edit_path(runtime: Runtime, file_path: str) -> tuple[str, str]:
    requested_path = file_path
    resolved_path = file_path
    if is_local_sandbox(runtime):
        thread_data = get_thread_data(runtime)
        validate_local_tool_path(file_path, thread_data)
        resolved_path = _resolve_and_validate_user_data_path(file_path, thread_data)
    return requested_path, resolved_path


@tool("apply_diff", parse_docstring=True)
def apply_diff_tool(
    runtime: Runtime,
    file_path: str,
    diff: str,
) -> str:
    """Apply a unified-diff patch to a single file.

    The diff should use standard unified format with ``@@ ... @@`` hunk
    headers. Context lines are verified before changes are applied — if a
    context line does not match, the entire operation is aborted.

    Args:
        file_path: Absolute path to the file to patch.
        diff: The unified diff content to apply.
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path, file_path = _resolve_edit_path(runtime, file_path)

        hunks = _parse_unified_diff(diff)
        if not hunks:
            return "Error: No valid hunks found in diff."

        with get_file_operation_lock(sandbox, file_path):
            content = sandbox.read_file(file_path)
            lines = content.splitlines(keepends=False) if content else []
            new_lines = _apply_hunks(lines, hunks)
            new_content = "\n".join(new_lines)
            if content and content.endswith("\n"):
                new_content += "\n"
            record_edit_snapshot(
                runtime,
                file_path=file_path,
                before=content,
                tool="apply_diff",
            )
            sandbox.write_file(file_path, new_content)
            record_runtime_file_change(
                runtime,
                file_path=file_path,
                before=content,
                after=new_content,
            )

        return commit_edit_to_state(
            runtime,
            result_message=f"OK: Applied {len(hunks)} hunk(s) to {requested_path}",
            file_path=file_path,
            before=content,
            after=new_content,
        )
    except ValueError as e:
        return f"Error: Patch application failed — {e}"
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {requested_path}"
    except PermissionError:
        return f"Error: Permission denied: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error applying diff: {_sanitize_error(e, runtime)}"


@tool("insert_at_line", parse_docstring=True)
def insert_at_line_tool(
    runtime: Runtime,
    file_path: str,
    line_number: int,
    content: str,
) -> str:
    """Insert text at a specific line number in a file.

    Existing lines from ``line_number`` onward are shifted down. Use
    ``line_number=0`` to prepend at the very beginning.

    Args:
        file_path: Absolute path to the file to edit.
        line_number: 1-indexed line number where insertion begins. 0 means prepend.
        content: The text to insert. May contain multiple lines.
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path, file_path = _resolve_edit_path(runtime, file_path)

        with get_file_operation_lock(sandbox, file_path):
            original = sandbox.read_file(file_path) or ""
            lines = original.splitlines(keepends=False)
            insert_lines = content.splitlines(keepends=False)

            n = len(lines)
            if line_number < 0 or line_number > n:
                return f"Error: line_number {line_number} out of range (file has {n} lines, valid: 0-{n})"

            new_lines = lines[:line_number] + insert_lines + lines[line_number:]
            new_content = "\n".join(new_lines)
            if original.endswith("\n"):
                new_content += "\n"
            record_edit_snapshot(
                runtime,
                file_path=file_path,
                before=original,
                tool="insert_at_line",
            )
            sandbox.write_file(file_path, new_content)
            record_runtime_file_change(
                runtime,
                file_path=file_path,
                before=original,
                after=new_content,
            )

        return commit_edit_to_state(
            runtime,
            result_message=f"OK: Inserted {len(insert_lines)} line(s) at position {line_number} in {requested_path}",
            file_path=file_path,
            before=original,
            after=new_content,
        )
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {requested_path}"
    except PermissionError:
        return f"Error: Permission denied: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error inserting text: {_sanitize_error(e, runtime)}"


@tool("multi_edit", parse_docstring=True)
def multi_edit_tool(
    runtime: Runtime,
    edits: list[dict],
) -> str:
    """Apply multiple string-replacement edits across one or more files in one call.

    Each edit dict has the shape::

        {
            "file_path": "/absolute/path/to/file",
            "old_string": "text to find",
            "new_string": "replacement text",
            "replace_all": false   // optional, default false
        }

    Edits are applied sequentially. If any edit fails (old_string not
    found or ambiguous), the entire operation is aborted and previously
    applied edits are NOT rolled back.

    Args:
        edits: A list of edit dicts, each with file_path, old_string, new_string, and optional replace_all.
    """
    if not edits:
        return "Error: No edits provided."

    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)

        results: list[str] = []
        # Group edits by file to minimize read/write cycles
        by_file: dict[str, list[dict]] = {}
        for ed in edits:
            fp = ed.get("file_path", "")
            if not fp:
                return "Error: Each edit must include 'file_path'."
            by_file.setdefault(fp, []).append(ed)

        planned_writes: list[tuple[str, str, str, str]] = []
        for file_path, file_edits in by_file.items():
            requested_path, resolved_path = _resolve_edit_path(runtime, file_path)
            with get_file_operation_lock(sandbox, resolved_path):
                content = sandbox.read_file(resolved_path) or ""
                original = content
                applied = 0

                for ed in file_edits:
                    old_str = ed.get("old_string", "")
                    new_str = ed.get("new_string", "")
                    replace_all = ed.get("replace_all", False)

                    if not old_str:
                        results.append(f"  SKIP: empty old_string in {requested_path}")
                        continue

                    if old_str not in content:
                        return f"Error: old_string not found in {requested_path} — multi_edit aborted."

                    if not replace_all:
                        count = content.count(old_str)
                        if count > 1:
                            return (
                                f"Error: old_string appears {count} times in {requested_path}. "
                                f"Set replace_all=true or provide more context — multi_edit aborted."
                            )
                        content = content.replace(old_str, new_str, 1)
                    else:
                        content = content.replace(old_str, new_str)

                    applied += 1
                    results.append(f"  OK: edit #{applied} applied to {requested_path}")

                planned_writes.append((requested_path, resolved_path, original, content))

        for requested_path, resolved_path, original, _content in planned_writes:
            with get_file_operation_lock(sandbox, resolved_path):
                current = sandbox.read_file(resolved_path) or ""
                if current != original:
                    return f"Error: {requested_path} changed during multi_edit planning — multi_edit aborted."

        diff_entries: list[dict] = []
        for _requested_path, resolved_path, original, content in planned_writes:
            with get_file_operation_lock(sandbox, resolved_path):
                record_edit_snapshot(
                    runtime,
                    file_path=resolved_path,
                    before=original,
                    tool="multi_edit",
                )
                sandbox.write_file(resolved_path, content)
                record_runtime_file_change(
                    runtime,
                    file_path=resolved_path,
                    before=original,
                    after=content,
                )
                entry = build_file_diff_entry(
                    runtime,
                    file_path=resolved_path,
                    before=original,
                    after=content,
                )
                if entry is not None:
                    diff_entries.append(entry)

        result_msg = f"Applied {len(edits)} edit(s) across {len(by_file)} file(s):\n" + "\n".join(results)
        if diff_entries:
            from langchain_core.messages import ToolMessage
            from langgraph.types import Command

            tool_call_id = getattr(runtime, "tool_call_id", None)
            if not tool_call_id:
                return result_msg

            return Command(
                update={
                    "diff": diff_entries,
                    "messages": [
                        ToolMessage(
                            content=result_msg,
                            tool_call_id=tool_call_id,
                        ),
                    ],
                },
            )
        return result_msg
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError as e:
        return f"Error: File not found: {e}"
    except PermissionError as e:
        return f"Error: Permission denied: {e}"
    except Exception as e:
        return f"Error: Unexpected error in multi_edit: {_sanitize_error(e, runtime)}"

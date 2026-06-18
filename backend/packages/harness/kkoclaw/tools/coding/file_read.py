"""Enhanced file reading tools for the Coding Agent.

Provides:
- ``read_file_lines``: Read a file with line-number formatting
- ``search_code``: Regex search with context lines (-A/-B/-C)
- ``find_files``: Multi-pattern file discovery
"""

import fnmatch
import os
import re

from langchain.tools import tool

from kkoclaw.sandbox.exceptions import SandboxError
from kkoclaw.sandbox.tools import (
    _sanitize_error,
    _resolve_local_read_path,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
    is_local_sandbox,
    mask_local_paths_in_output,
    validate_local_tool_path,
)
from kkoclaw.tools.types import Runtime

_MAX_READ_LINES = 2000
_MAX_SEARCH_RESULTS = 200
_MAX_FIND_RESULTS = 200


@tool("read_file_lines", parse_docstring=True)
def read_file_lines_tool(
    runtime: Runtime,
    file_path: str,
    start_line: int = 1,
    end_line: int = 0,
) -> str:
    """Read a text file and return its contents with line numbers.

    The output format is ``LINE_NUMBER→CONTENT`` so the agent can reference
    exact line positions when planning edits.

    Args:
        file_path: Absolute path to the file to read.
        start_line: Starting line number (1-indexed, inclusive). Default 1.
        end_line: Ending line number (1-indexed, inclusive). 0 means "until EOF".
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = file_path
        thread_data = None
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(file_path, thread_data, read_only=True)
            file_path = _resolve_local_read_path(file_path, thread_data)

        content = sandbox.read_file(file_path)
        if not content:
            return "(empty file)"

        lines = content.splitlines()
        total = len(lines)

        s = max(1, start_line)
        e = total if end_line <= 0 else min(end_line, total)
        if s > e:
            return f"Error: Invalid line range [{s}, {e}] (file has {total} lines)"

        # Cap the number of lines returned to avoid flooding the context
        if e - s + 1 > _MAX_READ_LINES:
            e = s + _MAX_READ_LINES - 1
            truncated_note = f"\n... (truncated, showing {_MAX_READ_LINES} of {total - s + 1} remaining lines)"
        else:
            truncated_note = ""

        selected = lines[s - 1 : e]
        width = len(str(e))
        formatted = "\n".join(
            f"{str(s + i).rjust(width)}→{line}" for i, line in enumerate(selected)
        )

        if thread_data is not None:
            formatted = mask_local_paths_in_output(formatted, thread_data)

        return formatted + truncated_note
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {requested_path}"
    except PermissionError:
        return f"Error: Permission denied: {requested_path}"
    except IsADirectoryError:
        return f"Error: Path is a directory: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error reading file: {_sanitize_error(e, runtime)}"


@tool("search_code", parse_docstring=True)
def search_code_tool(
    runtime: Runtime,
    pattern: str,
    path: str,
    glob_pattern: str | None = None,
    case_sensitive: bool = False,
    context_before: int = 0,
    context_after: int = 0,
    max_results: int = 100,
) -> str:
    """Search for a regex pattern in files under a directory, with optional context lines.

    Unlike the basic ``grep`` tool, this returns surrounding context lines
    (similar to ``rg -A/-B/-C``) to help understand match locations.

    Args:
        pattern: The regular expression to search for.
        path: Absolute root directory to search under.
        glob_pattern: Optional glob filter e.g. ``**/*.py``. Default None (all text files).
        case_sensitive: Whether matching is case-sensitive. Default False.
        context_before: Number of context lines before each match. Default 0.
        context_after: Number of context lines after each match. Default 0.
        max_results: Maximum number of matches to return. Default 100.
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = path
        thread_data = None
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(path, thread_data, read_only=True)
            path = _resolve_local_read_path(path, thread_data)

        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return f"Error: Invalid regex pattern: {e}"

        matches: list[str] = []
        file_paths = sandbox.glob(path, glob_pattern or "**/*", include_dirs=False, max_results=_MAX_FIND_RESULTS * 5)[0]

        count = 0
        for fp in file_paths:
            if count >= max_results:
                break
            try:
                content = sandbox.read_file(fp)
            except Exception:
                continue
            if content is None:
                continue
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if count >= max_results:
                    break
                if regex.search(line):
                    count += 1
                    # Build context block
                    s = max(0, i - context_before)
                    e = min(len(lines), i + context_after + 1)
                    block_lines = []
                    for j in range(s, e):
                        prefix = ">>" if j == i else "  "
                        block_lines.append(f"{prefix} {j + 1:5d}│{lines[j]}")
                    display_path = fp
                    if thread_data is not None:
                        display_path = mask_local_paths_in_output(fp, thread_data)
                    matches.append(f"{display_path}\n" + "\n".join(block_lines))

        if not matches:
            return "No matches found."

        header = f"Found {count} match(es)"
        if count >= max_results:
            header += f" (showing first {max_results})"
        return header + "\n\n" + "\n\n---\n\n".join(matches)
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: Directory not found: {requested_path}"
    except NotADirectoryError:
        return f"Error: Path is not a directory: {requested_path}"
    except re.error as e:
        return f"Error: Invalid regex pattern: {e}"
    except Exception as e:
        return f"Error: Unexpected error searching: {_sanitize_error(e, runtime)}"


@tool("find_files", parse_docstring=True)
def find_files_tool(
    runtime: Runtime,
    path: str,
    name_pattern: str | None = None,
    glob_pattern: str | None = None,
    file_type: str = "all",
    max_results: int = 200,
) -> str:
    """Find files or directories matching name or glob patterns.

    Supports filtering by file type and multiple pattern inputs — more
    flexible than the basic ``glob`` tool for coding tasks.

    Args:
        path: Absolute root directory to search under.
        name_pattern: Simple filename pattern (e.g. ``*.py``, ``test_*``). Uses fnmatch.
        glob_pattern: Full glob path pattern (e.g. ``**/test_*.py``). Takes precedence over name_pattern.
        file_type: Filter by type — ``all`` (default), ``file``, or ``dir``.
        max_results: Maximum number of results. Default 200.
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = path
        thread_data = None
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(path, thread_data, read_only=True)
            path = _resolve_local_read_path(path, thread_data)

        effective_pattern = glob_pattern or "**/*"
        include_dirs = file_type in ("all", "dir")
        matches_raw, truncated = sandbox.glob(
            path,
            effective_pattern,
            include_dirs=include_dirs,
            max_results=min(max_results, _MAX_FIND_RESULTS),
        )

        # Apply name_pattern post-filter if specified
        if name_pattern:
            matches_raw = [m for m in matches_raw if fnmatch.fnmatch(os.path.basename(m), name_pattern)]

        # Apply file_type filter
        if file_type == "file":
            matches_raw = [m for m in matches_raw if not m.endswith("/")]
        elif file_type == "dir":
            matches_raw = [m for m in matches_raw if m.endswith("/")]

        if thread_data is not None:
            matches_raw = [mask_local_paths_in_output(m, thread_data) for m in matches_raw]

        if not matches_raw:
            return "No matching files found."

        header = f"Found {len(matches_raw)} matching path(s)"
        if truncated:
            header += " (results may be truncated)"
        return header + "\n" + "\n".join(matches_raw)
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: Directory not found: {requested_path}"
    except NotADirectoryError:
        return f"Error: Path is not a directory: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error finding files: {_sanitize_error(e, runtime)}"

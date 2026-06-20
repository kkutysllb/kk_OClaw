"""Symbol-aware code navigation tools for the Coding Agent.

Provides:
- ``find_symbols``: Locate function/class/method/interface definitions by name
- ``read_symbol``: Read the full body of a specific symbol (function/class)

Parsing strategy:

1. **Tree-sitter backend (preferred)** — when the ``tree_sitter`` package
   and matching grammar are importable, source is parsed into an AST for
   accurate results across Python, JS/TS, Go, and Rust. Handles nested
   classes, async functions, arrow-function variables, generics, Go
   ``type_declaration`` wrappers, Rust ``impl`` blocks, etc.
2. **Enhanced regex fallback** — when tree-sitter is unavailable, an
   enhanced regex scanner runs. It tracks block scope (brace counting or
   Python indentation) so ``read_symbol`` can still slice the body
   accurately without relying on the next definition's location.

Both backends emit the same ``Symbol`` shape via :mod:`._symbol_parser`.
"""

from __future__ import annotations

import re

from langchain.tools import tool

from kkoclaw.sandbox.exceptions import SandboxError
from kkoclaw.sandbox.tools import (
    _resolve_local_read_path,
    _sanitize_error,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
    is_local_sandbox,
    mask_local_paths_in_output,
    validate_local_tool_path,
)
from kkoclaw.tools.coding._symbol_parser import (
    detect_language_by_extension,
    parse_symbols,
    treesitter_available,
)
from kkoclaw.tools.types import Runtime

_MAX_SYMBOLS = 200
_MAX_SYMBOL_BODY_LINES = 400


def _detect_language(file_path: str) -> str | None:
    """Return the language slug for a file based on its extension."""
    return detect_language_by_extension(file_path)


def _scan_file_for_symbols(content: str, language: str) -> list[dict]:
    """Backward-compatible wrapper returning ``{name, line, kind}`` dicts.

    Delegates to :func:`._symbol_parser.parse_symbols` which prefers
    tree-sitter and falls back to the enhanced regex scanner.
    """
    return [
        {"name": s.name, "line": s.line, "kind": s.kind}
        for s in parse_symbols(content, language)
    ]


def _backend_label(language: str) -> str:
    """Return a short human-readable label for the active parser backend."""
    return "tree-sitter" if treesitter_available(language) else "regex"


@tool("find_symbols", parse_docstring=True)
def find_symbols_tool(
    runtime: Runtime,
    file_path: str,
    name_pattern: str | None = None,
) -> str:
    """List all function/class/method/interface definitions in a source file.

    Uses tree-sitter for AST-accurate parsing across Python, JS/TS, Go, and
    Rust. Falls back to an enhanced regex scanner when tree-sitter is not
    installed. Faster than reading the whole file when you only need to
    know where symbols are defined.

    Args:
        file_path: Absolute path to the source file to scan.
        name_pattern: Optional regex filter — only symbols whose name matches
            are returned. Default None (return all symbols).
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

        language = _detect_language(file_path)
        if not language:
            return f"Error: Unsupported file extension for symbol scanning: {requested_path}"

        content = sandbox.read_file(file_path) or ""
        symbols = parse_symbols(content, language)

        if name_pattern:
            try:
                regex = re.compile(name_pattern)
            except re.error as e:
                return f"Error: Invalid name_pattern regex: {e}"
            symbols = [s for s in symbols if regex.search(s.name)]

        symbols = symbols[:_MAX_SYMBOLS]

        if not symbols:
            return "No symbols found."

        display_path = requested_path
        if thread_data is not None:
            display_path = mask_local_paths_in_output(requested_path, thread_data)

        backend = _backend_label(language)
        lines = [
            f"Found {len(symbols)} symbol(s) in {display_path} "
            f"({language}, backend={backend}):\n"
        ]
        for s in symbols:
            lines.append(f"  L{s.line:>5}  [{s.kind:<9}]  {s.name}")
        return "\n".join(lines)
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {file_path}"
    except Exception as e:
        return f"Error: Unexpected error scanning symbols: {_sanitize_error(e, runtime)}"


@tool("read_symbol", parse_docstring=True)
def read_symbol_tool(
    runtime: Runtime,
    file_path: str,
    name: str,
) -> str:
    """Read the full body of a specific function/class/method by name.

    Finds the definition of ``name`` in ``file_path`` and returns its
    complete body with line numbers. Body extent is determined by the
    parser backend — tree-sitter yields the AST node's precise end line;
    the regex fallback tracks brace depth (JS/Go/Rust) or indentation
    (Python) to compute the same boundary.

    Args:
        file_path: Absolute path to the source file.
        name: The symbol name (function/class/method) to read.
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

        language = _detect_language(file_path)
        if not language:
            return f"Error: Unsupported file extension for symbol reading: {requested_path}"

        content = sandbox.read_file(file_path) or ""
        all_lines = content.splitlines()
        symbols = parse_symbols(content, language)

        target = next((s for s in symbols if s.name == name), None)
        if target is None:
            return f"Error: Symbol '{name}' not found in {requested_path}."

        start = target.line
        end = target.end_line if target.end_line >= start else start

        # Cap to avoid huge output
        truncated_note = ""
        if end - start + 1 > _MAX_SYMBOL_BODY_LINES:
            end = start + _MAX_SYMBOL_BODY_LINES - 1
            truncated_note = f"\n... (truncated, showing {_MAX_SYMBOL_BODY_LINES} lines)"

        body = all_lines[start - 1 : end]
        width = len(str(end))
        formatted = "\n".join(
            f"{str(start + i).rjust(width)}→{line}" for i, line in enumerate(body)
        )

        if thread_data is not None:
            formatted = mask_local_paths_in_output(formatted, thread_data)

        header = f"[{target.kind}] {target.name} ({requested_path} L{start}-{end})"
        return header + "\n" + formatted + truncated_note
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {file_path}"
    except Exception as e:
        return f"Error: Unexpected error reading symbol: {_sanitize_error(e, runtime)}"


__all__ = ["find_symbols_tool", "read_symbol_tool"]

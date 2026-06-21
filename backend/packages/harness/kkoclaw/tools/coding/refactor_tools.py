"""Semantic refactoring tools for the Coding Agent.

Provides:
- ``rename_symbol``: Rename an identifier (function/class/variable/method)
  across a single file with token-boundary awareness.
- ``extract_function``: Extract a contiguous code block into a new
  standalone function definition. Supports Python, JavaScript/TypeScript,
  Go, and Rust — each language emits its native function syntax.
  **Parameters and return values are automatically inferred** from
  data-flow analysis (Python uses the ``ast`` module for precision;
  other languages use tree-sitter AST when available, falling back to
  heuristic regex). The caller can still override ``params`` explicitly.

Unlike naive ``str_replace``, these tools respect identifier boundaries so
that renaming ``foo`` does not accidentally touch ``foobar``, ``myfoo``,
or ``foo`` inside a longer token. Comments (``#`` / ``//``) are skipped by
default to reduce noise.
"""

from __future__ import annotations

import ast
import builtins
import re
import textwrap

from langchain.tools import tool

from kkoclaw.coding_core.change_tracking import (
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
    mask_local_paths_in_output,
    validate_local_tool_path,
)
from kkoclaw.tools.coding._symbol_parser import detect_language_by_extension
from kkoclaw.tools.types import Runtime

_MAX_RENAME_OCCURRENCES = 500

# Default indent unit for newly generated code. Callers can override when
# the surrounding file uses tabs.
_INDENT_UNIT = "    "

# Per-language function-syntax emitters for extract_function. Each emitter
# takes (name, params, body_lines, base_indent, returns) and returns the
# function definition block as a list of lines.

# Maximum number of inferred params to accept without manual confirmation.
# Prevents pathological cases where a block uses 30+ outer variables.
_MAX_INFERRED_PARAMS = 8


def _make_python_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    returns: list[str] | None = None,
) -> list[str]:
    """Python: ``def name(params):`` + indented body + optional ``return``.

    If *returns* is non-empty, a ``return a, b`` line is appended after the
    body (unless the body already ends with a ``return`` statement).
    """
    sig = f"def {name}({', '.join(params)}):"
    out = [f"{base_indent}{sig}"]
    body_indent = base_indent + _INDENT_UNIT
    has_body = any(ln.strip() for ln in body_lines)
    body_ends_with_return = False
    if has_body:
        for bl in body_lines:
            stripped = bl.strip()
            out.append(f"{body_indent}{bl}" if stripped else "")
            if stripped.startswith("return"):
                body_ends_with_return = True
            else:
                body_ends_with_return = False
    else:
        out.append(f"{body_indent}pass")

    if returns and not body_ends_with_return:
        out.append(f"{body_indent}return {', '.join(returns)}")
    return out


def _make_braced_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    *,
    keyword: str,
    param_prefix: str = "",
    param_suffix: str = "",
    return_sig: str = "",
    returns: list[str] | None = None,
    return_keyword: str = "return",
) -> list[str]:
    """Generic emitter for brace-delimited languages.

    Produces::

        <kw> name(<prefix>params<suffix>) <ret> {
            <body>
            <return_kw> returns;   // only if returns is non-empty
        }
    """
    params_str = ", ".join(params)
    head = f"{keyword} {name}({param_prefix}{params_str}{param_suffix})"
    if return_sig:
        head = f"{head} {return_sig}"
    out = [f"{base_indent}{head} {{"]
    body_indent = base_indent + _INDENT_UNIT
    has_body = any(ln.strip() for ln in body_lines)
    body_ends_with_return = False
    if has_body:
        for bl in body_lines:
            stripped = bl.strip()
            out.append(f"{body_indent}{bl}" if stripped else "")
            if stripped.startswith(return_keyword):
                body_ends_with_return = True
            else:
                body_ends_with_return = False
    out.append(f"{base_indent}}}")

    # Insert return before closing brace if inferred and body doesn't end
    # with an explicit return.
    if returns and not body_ends_with_return:
        if len(returns) == 1:
            ret_expr = returns[0]
        elif keyword == "function":
            # JS/TS: multiple returns must be an array literal
            ret_expr = f"[{', '.join(returns)}]"
        else:
            # Go/Rust: tuple-style (may need type annotation by caller)
            ret_expr = ", ".join(returns)
        ret_line = f"{body_indent}{return_keyword} {ret_expr}"
        if keyword != "fn":
            ret_line += ";"
        # Insert before the closing brace
        out.insert(-1, ret_line)
    return out


def _make_javascript_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    returns: list[str] | None = None,
) -> list[str]:
    return _make_braced_func(
        name, params, body_lines, base_indent, keyword="function", returns=returns
    )


def _make_typescript_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    returns: list[str] | None = None,
) -> list[str]:
    return _make_braced_func(
        name, params, body_lines, base_indent, keyword="function", returns=returns
    )


def _make_go_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    returns: list[str] | None = None,
) -> list[str]:
    # Go return types are hard to infer without type analysis; we still
    # emit `return` with values but leave the signature type blank for
    # the caller/Agent to fill in.
    return _make_braced_func(
        name, params, body_lines, base_indent, keyword="func", returns=returns
    )


def _make_rust_func(
    name: str,
    params: list[str],
    body_lines: list[str],
    base_indent: str,
    returns: list[str] | None = None,
) -> list[str]:
    # Rust uses `return` with semicolons in non-expression position.
    return _make_braced_func(
        name, params, body_lines, base_indent, keyword="fn", returns=returns
    )


_FUNC_EMITTERS: dict[str, callable] = {
    "python": _make_python_func,
    "javascript": _make_javascript_func,
    "go": _make_go_func,
    "rust": _make_rust_func,
}


def _build_call_site(
    name: str,
    params: list[str],
    base_indent: str,
    language: str,
    returns: list[str] | None = None,
) -> str:
    """Build the replacement call line at the original extraction site.

    - Python / JS / TS / Rust: ``name(args)`` (drop ``self`` for Python).
    - Go: ``name(args)`` (no special handling).
    - If *returns* is non-empty and has exactly one element, emit
      ``result = name(args)`` for destructuring-free cases.
    - If *returns* has multiple elements:
      - Python: ``a, b = name(args)``
      - JS/TS: ``const [a, b] = name(args);``
      - Go/Rust: ``a, b = name(args)`` / ``let (a, b) = name(args);``
    """
    args = params
    if language == "python":
        args = [p for p in params if p != "self"]
    call_args = ", ".join(args)

    if not returns:
        return f"{base_indent}{name}({call_args})"

    if len(returns) == 1:
        ret_var = returns[0]
        if language in {"javascript"}:
            return f"{base_indent}const {ret_var} = {name}({call_args});"
        return f"{base_indent}{ret_var} = {name}({call_args})"

    # Multiple returns
    if language == "python":
        return f"{base_indent}{', '.join(returns)} = {name}({call_args})"
    if language in {"javascript"}:
        return f"{base_indent}const [{', '.join(returns)}] = {name}({call_args});"
    # Go / Rust — tuple style (Agent may need to adjust types)
    return f"{base_indent}{', '.join(returns)} = {name}({call_args})"


def _validate_identifier(name: str, label: str) -> str | None:
    """Return an error message if *name* is not a valid identifier, else None."""
    if not name or not re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*$", name):
        return f"Invalid {label}: '{name}' must be a valid identifier."
    return None


def _line_is_comment(line: str) -> bool:
    """Heuristic: True if *line* (after stripping leading whitespace) starts
    with a comment marker for Python (``#``) or C-like languages (``//``)."""
    stripped = line.lstrip()
    return stripped.startswith("#") or stripped.startswith("//")


def _rename_in_text(
    content: str,
    old_name: str,
    new_name: str,
    *,
    skip_comments: bool = True,
) -> tuple[str, int]:
    """Replace identifier *old_name* with *new_name* respecting token boundaries.

    Uses a negative-lookaround regex so that only whole-token matches are
    replaced (e.g. renaming ``foo`` will not affect ``foobar``).

    Returns ``(new_content, count)``.
    """
    pattern = re.compile(
        r"(?<![A-Za-z0-9_$])" + re.escape(old_name) + r"(?![A-Za-z0-9_$])"
    )

    if not skip_comments:
        count = len(pattern.findall(content))
        return pattern.sub(new_name, content), count

    lines = content.splitlines(keepends=True)
    out: list[str] = []
    count = 0
    for line in lines:
        if _line_is_comment(line):
            out.append(line)
            continue
        replaced, n = pattern.subn(new_name, line)
        count += n
        out.append(replaced)
    return "".join(out), count


# --------------------------------------------------------------------- #
# Data-flow analysis for extract_function auto-inference
# --------------------------------------------------------------------- #

# Python: builtins + special names to exclude from inferred params.
# NOTE: ``self`` and ``cls`` are intentionally NOT excluded here — when
# extracting from inside a method, they are legitimate free variables that
# should become parameters of the extracted function.
_PY_EXCLUDE: frozenset[str] = frozenset(dir(builtins)) | frozenset({
    "True", "False", "None",
    "__name__", "__file__", "__doc__", "__init__", "__class__",
})

# Per-language keywords (never params).
_LANG_KEYWORDS: dict[str, frozenset[str]] = {
    "python": frozenset({
        "and", "or", "not", "if", "else", "elif", "for", "while",
        "return", "yield", "import", "from", "class", "def",
        "try", "except", "finally", "with", "as", "in", "is",
        "lambda", "pass", "break", "continue", "global", "nonlocal",
        "raise", "assert", "del", "async", "await",
    }),
    "javascript": frozenset({
        "var", "let", "const", "function", "return", "if", "else",
        "for", "while", "do", "switch", "case", "break", "continue",
        "new", "delete", "typeof", "instanceof", "in", "of",
        "class", "extends", "super", "this", "import", "export",
        "default", "async", "await", "yield", "try", "catch",
        "finally", "throw", "void", "null", "undefined", "true",
        "false",
    }),
    "go": frozenset({
        "func", "return", "if", "else", "for", "switch", "case",
        "default", "break", "continue", "var", "const", "type",
        "struct", "interface", "map", "chan", "go", "defer",
        "select", "package", "import", "range", "nil", "true", "false",
        "iota",
    }),
    "rust": frozenset({
        "fn", "let", "mut", "return", "if", "else", "for", "while",
        "loop", "match", "struct", "enum", "trait", "impl", "pub",
        "use", "mod", "crate", "self", "super", "as", "in", "ref",
        "move", "async", "await", "const", "static", "type", "where",
        "unsafe", "true", "false",
    }),
}

# Per-language common builtins / library objects to exclude.
_LANG_BUILTIN_FUNCS: dict[str, frozenset[str]] = {
    "python": frozenset(dir(builtins)),
    "javascript": frozenset({
        "console", "Math", "Object", "Array", "String", "Number",
        "Boolean", "JSON", "Date", "RegExp", "Error", "Promise",
        "Map", "Set", "Symbol", "parseInt", "parseFloat", "isNaN",
        "isFinite", "setTimeout", "setInterval", "require", "module",
        "exports", "process", "Buffer", "global", "document", "window",
        "fetch", "Reflect", "Proxy",
    }),
    "go": frozenset({
        "fmt", "make", "append", "len", "cap", "copy", "delete",
        "new", "print", "println", "panic", "recover", "close",
        "string", "int", "int32", "int64", "float32", "float64",
        "bool", "byte", "rune", "error", "complex", "real", "imag",
        "strings", "strconv", "os", "io", "errors",
    }),
    "rust": frozenset({
        "println", "print", "eprintln", "eprint", "vec", "String",
        "Vec", "Option", "Result", "Some", "None", "Ok", "Err",
        "Box", "Rc", "Arc", "RefCell", "Cell", "HashMap", "HashSet",
        "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32",
        "u64", "u128", "f32", "f64", "bool", "char", "str",
        "format", "format!", "vec!", "println!", "todo!", "unimplemented!",
    }),
}

# Per-language assignment-target patterns (captures variable name(s)).
# Each pattern's group(1) captures the name (or comma-separated names).
_DEF_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "python": [
        # NAME = ... (plain assignment, not ==)
        re.compile(r"(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])"),
        # for NAME in ...
        re.compile(r"\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b"),
        # with ... as NAME
        re.compile(r"\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b"),
    ],
    "javascript": [
        # const/let/var NAME = ...  (also: const a, b = ...)
        re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$\s,]*)\s*=(?![=>])"),
        # NAME = ...  (plain assignment, not == or =>)
        re.compile(r"(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?![=>])"),
    ],
    "go": [
        # NAME := ...
        re.compile(r"(?<![.\w])([A-Za-z_][A-Za-z0-9_\s,]*)\s*:?="),
        # var NAME ...  or  var NAME = ...
        re.compile(r"\bvar\s+([A-Za-z_][A-Za-z0-9_\s,]*)"),
    ],
    "rust": [
        # let (mut)? NAME = ...
        re.compile(r"\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_\s,]*)\s*=(?![=>])"),
        # NAME = ...  (plain assignment)
        re.compile(r"(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])"),
    ],
}

_IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


def _strip_code_noise(line: str, language: str) -> str:
    """Remove string literals and comments from a single line for analysis."""
    # Remove string literals
    line = re.sub(r"'[^']*'", "''", line)
    line = re.sub(r'"[^"]*"', '""', line)
    if language in {"javascript", "go"}:
        line = re.sub(r"`[^`]*`", "``", line)
    # Remove line comments
    if language == "python":
        idx = line.find("#")
        if idx >= 0:
            line = line[:idx]
    else:
        idx = line.find("//")
        if idx >= 0:
            line = line[:idx]
    return line


def _extract_defs_from_line(line: str, language: str) -> set[str]:
    """Extract variable definition names from a single line."""
    defs: set[str] = set()
    for pat in _DEF_PATTERNS.get(language, []):
        for m in pat.finditer(line):
            raw = m.group(1)
            if not raw:
                continue
            # Handle comma-separated names: "a, b" → {a, b}
            for part in raw.split(","):
                part = part.strip()
                vm = _IDENT_RE.match(part)
                if vm:
                    defs.add(vm.group())
    return defs


def _extract_uses_from_line(line: str) -> set[str]:
    """Extract identifier *uses* from a cleaned line.

    Excludes:
    - Property accesses (``.foo``)
    - Function call targets (``foo(``)
    """
    # Remove property accesses: .identifier
    line = re.sub(r"\.[A-Za-z_$][A-Za-z0-9_$]*", "", line)
    # Remove function call targets: identifier( → (
    line = re.sub(r"[A-Za-z_$][A-Za-z0-9_$]*\s*\(", "(", line)
    return set(_IDENT_RE.findall(line))


def _try_parse_python(src: str) -> ast.Module | None:
    """Try multiple strategies to parse Python source that may be indented.

    1. Direct parse (works for top-level code).
    2. Dedent then parse (works for uniformly-indented blocks).
    3. Wrap in a dummy function then parse (works for mixed-indentation
       fragments extracted from different nesting levels).
    """
    # Attempt 1: direct
    try:
        return ast.parse(src)
    except SyntaxError:
        pass
    # Attempt 2: dedent
    dedented = textwrap.dedent(src)
    if dedented != src:
        try:
            return ast.parse(dedented)
        except SyntaxError:
            pass
    # Attempt 3: wrap in dummy function (normalises indentation)
    try:
        wrapped = "def __w__():\n" + textwrap.indent(dedented, "    ")
        return ast.parse(wrapped)
    except SyntaxError:
        return None


def _infer_python_extraction(
    content: str, start_line: int, end_line: int
) -> tuple[list[str], list[str], str | None]:
    """Python: use the ``ast`` module for precise data-flow analysis.

    Returns ``(params, returns, error)``. When error is non-None the caller
    falls through to the heuristic backend.
    """
    lines = content.splitlines()
    block_src = "\n".join(lines[start_line - 1 : end_line])

    block_tree = _try_parse_python(block_src)
    if block_tree is None:
        return [], [], "block syntax error"  # signal fallback to heuristic

    loads: set[str] = set()
    stores: set[str] = set()
    for node in ast.walk(block_tree):
        if isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Load):
                loads.add(node.id)
            elif isinstance(node.ctx, (ast.Store, ast.Del)):
                stores.add(node.id)
        elif isinstance(node, ast.arg):
            # Nested function parameter counts as a local def
            stores.add(node.arg)

    exclude = _PY_EXCLUDE | _LANG_KEYWORDS["python"]
    params = sorted(loads - stores - exclude)

    # Returns: block-defined variables that are used after the block
    after_src = "\n".join(lines[end_line:])
    returns: list[str] = []
    block_defs = stores - exclude
    if after_src.strip() and block_defs:
        after_loads: set[str] = set()
        after_tree = _try_parse_python(after_src)
        if after_tree is not None:
            for node in ast.walk(after_tree):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                    after_loads.add(node.id)
        else:
            # Regex fallback: search for each var by token boundary
            for var in block_defs:
                if re.search(
                    r"(?<![A-Za-z0-9_])" + re.escape(var) + r"(?![A-Za-z0-9_])",
                    after_src,
                ):
                    after_loads.add(var)
        returns = sorted(block_defs & after_loads)

    return params, returns, None


def _infer_heuristic_extraction(
    content: str, start_line: int, end_line: int, language: str
) -> tuple[list[str], list[str], str | None]:
    """JS/TS/Go/Rust: regex-based heuristic data-flow analysis.

    Returns ``(params, returns, error)``.
    """
    lines = content.splitlines()
    block_lines = lines[start_line - 1 : end_line]
    after_lines = lines[end_line:]

    block_defs: set[str] = set()
    block_uses: set[str] = set()

    for raw_line in block_lines:
        clean = _strip_code_noise(raw_line, language)
        block_defs |= _extract_defs_from_line(clean, language)
        block_uses |= _extract_uses_from_line(clean)

    keywords = _LANG_KEYWORDS.get(language, frozenset())
    builtins = _LANG_BUILTIN_FUNCS.get(language, frozenset())
    exclude = keywords | builtins

    params = sorted(block_uses - block_defs - exclude)

    # Returns
    after_uses: set[str] = set()
    for raw_line in after_lines:
        clean = _strip_code_noise(raw_line, language)
        after_uses |= _extract_uses_from_line(clean)

    returns = sorted(block_defs & after_uses - exclude)

    return params, returns, None


def _infer_extraction_params(
    content: str,
    start_line: int,
    end_line: int,
    language: str,
) -> tuple[list[str], list[str]]:
    """Infer function params and return values via data-flow analysis.

    Strategy:
    - Python: ``ast`` module (precise — distinguishes Load/Store contexts).
    - JS/TS/Go/Rust: heuristic regex (excludes property access and call
      targets, respects language-specific assignment syntax).

    Returns ``(params, returns)`` where:
    - **params**: variables used in the block but defined outside it
      (free variables that should become function parameters).
    - **returns**: variables defined in the block and used after it
      (should be returned by the new function).
    """
    if language == "python":
        params, returns, err = _infer_python_extraction(
            content, start_line, end_line
        )
        if err is None:
            return params[:_MAX_INFERRED_PARAMS], returns

    params, returns, _ = _infer_heuristic_extraction(
        content, start_line, end_line, language
    )
    return params[:_MAX_INFERRED_PARAMS], returns


@tool("rename_symbol", parse_docstring=True)
def rename_symbol_tool(
    runtime: Runtime,
    file_path: str,
    old_name: str,
    new_name: str,
    skip_comments: bool = True,
) -> str:
    """Rename an identifier (function/class/variable/method) across one file.

    Performs token-boundary-aware replacement so that substrings inside
    longer identifiers are not touched (e.g. renaming ``get`` will not
    affect ``get_user`` or ``budget``). Comment lines (``#`` / ``//``) are
    skipped by default.

    After renaming, run your tests/linter to verify the change is correct.
    The edit is recorded for ``undo_last_edit`` rollback.

    Args:
        file_path: Absolute path to the file to modify.
        old_name: Current identifier name to replace.
        new_name: New identifier name.
        skip_comments: If True (default), skip replacement inside full-line
            comments. Inline occurrences are still replaced.
    """
    for name, label in [(old_name, "old_name"), (new_name, "new_name")]:
        err = _validate_identifier(name, label)
        if err:
            return f"Error: {err}"
    if old_name == new_name:
        return "Error: old_name and new_name are identical."

    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = file_path
        thread_data = None
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(file_path, thread_data)
            file_path = _resolve_and_validate_user_data_path(file_path, thread_data)

        with get_file_operation_lock(sandbox, file_path):
            content = sandbox.read_file(file_path) or ""
            new_content, count = _rename_in_text(
                content, old_name, new_name, skip_comments=skip_comments
            )

            if count == 0:
                return (
                    f"No occurrences of '{old_name}' (as a whole identifier) "
                    f"found in {requested_path}."
                )

            if count > _MAX_RENAME_OCCURRENCES:
                return (
                    f"Error: Refusing to rename {count} occurrences (limit "
                    f"{_MAX_RENAME_OCCURRENCES}). The identifier '{old_name}' "
                    f"may be too common; use targeted edits instead."
                )

            record_edit_snapshot(
                runtime,
                file_path=file_path,
                before=content,
                tool="rename_symbol",
            )
            sandbox.write_file(file_path, new_content)
            record_runtime_file_change(
                runtime,
                file_path=file_path,
                before=content,
                after=new_content,
            )

        display_path = requested_path
        if thread_data is not None:
            display_path = mask_local_paths_in_output(requested_path, thread_data)

        return commit_edit_to_state(
            runtime,
            result_message=(
                f"Renamed '{old_name}' -> '{new_name}' in {display_path} "
                f"({count} occurrence(s) updated). Run tests to verify. "
                f"Use undo_last_edit to revert if needed."
            ),
            file_path=file_path,
            before=content,
            after=new_content,
        )
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {requested_path}"
    except PermissionError:
        return f"Error: Permission denied: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error during rename: {_sanitize_error(e, runtime)}"


@tool("extract_function", parse_docstring=True)
def extract_function_tool(
    runtime: Runtime,
    file_path: str,
    new_name: str,
    start_line: int,
    end_line: int,
    params: str = "",
) -> str:
    """Extract a block of code into a new function. Supports Python, JS/TS, Go, Rust.

    The lines from ``start_line`` to ``end_line`` (inclusive, 1-based) are
    extracted into a new function and replaced at the call site with
    ``new_name(args)``. The new function is inserted immediately before
    the extracted block's original position.

    **Automatic parameter and return-value inference**: If ``params`` is
    omitted (or empty), the tool performs data-flow analysis on the
    extracted block:

    - **Python**: Uses the ``ast`` module for precise Load/Store analysis.
      Free variables (used in block, defined outside) become params;
      block-defined variables used afterward become return values.
    - **JS/TS/Go/Rust**: Heuristic regex analysis with language-specific
      assignment-pattern recognition. Property accesses and call targets
      are excluded to reduce false positives.

    When params are inferred, a ``return`` statement is automatically
    appended if the analysis detected return values, and the call site
    becomes ``result = new_name(args)`` (or destructuring for multiple
    returns).

    Each language emits its native syntax:

    - **Python**: ``def name(params):`` with indented body.
    - **JavaScript / TypeScript**: ``function name(params) { ... }``.
    - **Go**: ``func name(params) { ... }``.
    - **Rust**: ``fn name(params) { ... }``.

    For Python, ``self`` is dropped from the call-site arguments.

    After extraction, verify indentation, return statements, and variable
    scoping are correct. The edit is recorded for ``undo_last_edit``.

    Args:
        file_path: Absolute path to the source file to modify.
        new_name: Name for the extracted function.
        start_line: 1-based start line of the block to extract (inclusive).
        end_line: 1-based end line of the block to extract (inclusive).
        params: Optional comma-separated parameter names to override
            auto-inference, e.g. ``self, user_id``. If omitted, params
            and return values are inferred automatically from data-flow
            analysis.
    """
    err = _validate_identifier(new_name, "new_name")
    if err:
        return f"Error: {err}"
    if end_line < start_line:
        return "Error: end_line must be >= start_line."
    if start_line < 1:
        return "Error: start_line must be >= 1."

    language = detect_language_by_extension(file_path)
    if language is None:
        return (
            f"Error: Unsupported file extension for extract_function: "
            f"{file_path}. Supported: .py .js .jsx .mjs .cjs .ts .tsx .go .rs"
        )
    emitter = _FUNC_EMITTERS.get(language)
    if emitter is None:
        return f"Error: extract_function does not yet support language '{language}'."

    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = file_path
        thread_data = None
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(file_path, thread_data)
            file_path = _resolve_and_validate_user_data_path(file_path, thread_data)

        with get_file_operation_lock(sandbox, file_path):
            content = sandbox.read_file(file_path) or ""
            all_lines = content.splitlines()
            if end_line > len(all_lines):
                return (
                    f"Error: end_line {end_line} exceeds file length "
                    f"({len(all_lines)} lines)."
                )

            block = all_lines[start_line - 1 : end_line]
            first_line = block[0] if block else ""
            block_indent_str = first_line[: len(first_line) - len(first_line.lstrip(" \t"))]
            block_indent_len = len(block_indent_str)

            body_lines: list[str] = []
            for ln in block:
                if ln[:block_indent_len].strip() == "":
                    body_lines.append(ln[block_indent_len:])
                else:
                    body_lines.append(ln)

            # --- Parameter & return-value inference ---
            auto_inferred = False
            inferred_returns: list[str] = []

            if params and params.strip():
                # User provided explicit params; still try to infer returns.
                param_list = [
                    p.strip() for p in params.split(",") if p.strip()
                ]
                _, inferred_returns = _infer_extraction_params(
                    content, start_line, end_line, language
                )
            else:
                # Auto-infer both params and returns.
                param_list, inferred_returns = _infer_extraction_params(
                    content, start_line, end_line, language
                )
                auto_inferred = True

            # Build the function definition (with return if inferred)
            emit_returns = inferred_returns if inferred_returns else None
            func_lines = emitter(
                new_name,
                param_list,
                body_lines,
                base_indent=block_indent_str,
                returns=emit_returns,
            )
            func_def = "\n".join(func_lines)

            # Build the call site (with return-value assignment if inferred)
            call_returns = inferred_returns if inferred_returns else None
            call_line = _build_call_site(
                new_name,
                param_list,
                base_indent=block_indent_str,
                language=language,
                returns=call_returns,
            )

            before_block = all_lines[: start_line - 1]
            after_block = all_lines[end_line:]
            new_lines = before_block + [func_def, "", call_line] + after_block
            new_content = "\n".join(new_lines)
            if content.endswith("\n"):
                new_content += "\n"

            record_edit_snapshot(
                runtime,
                file_path=file_path,
                before=content,
                tool="extract_function",
            )
            sandbox.write_file(file_path, new_content)
            record_runtime_file_change(
                runtime,
                file_path=file_path,
                before=content,
                after=new_content,
            )

        display_path = requested_path
        if thread_data is not None:
            display_path = mask_local_paths_in_output(requested_path, thread_data)

        # Build informative result message
        msg_parts = [
            f"Extracted lines {start_line}-{end_line} from {display_path} "
            f"({language}) into function '{new_name}'."
        ]
        if auto_inferred:
            params_str = ", ".join(param_list) if param_list else "(none)"
            msg_parts.append(f" Auto-inferred params: [{params_str}].")
        else:
            msg_parts.append(f" Params: [{', '.join(param_list)}].")
        if inferred_returns:
            rets = ", ".join(inferred_returns)
            msg_parts.append(f" Auto-inferred returns: [{rets}].")
        msg_parts.append(
            " Verify indentation, scoping, and return values. "
            "Use undo_last_edit to revert."
        )
        return commit_edit_to_state(
            runtime,
            result_message="".join(msg_parts),
            file_path=file_path,
            before=content,
            after=new_content,
        )
    except SandboxError as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: File not found: {requested_path}"
    except PermissionError:
        return f"Error: Permission denied: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error during extract: {_sanitize_error(e, runtime)}"


__all__ = ["rename_symbol_tool", "extract_function_tool"]

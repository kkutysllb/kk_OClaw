"""Unified symbol parser with tree-sitter backend + enhanced regex fallback.

Public API:

- ``Symbol`` — dataclass with name / line / end_line / kind / language / body_node
- ``parse_symbols(content, language)`` — returns a list of ``Symbol``

Resolution strategy (per call):

1. If ``tree_sitter`` and the matching grammar package are importable, parse
   the source with tree-sitter for AST-accurate results (handles nested
   classes, async functions, arrow-function variables, generics, etc.).
2. Otherwise, fall back to an enhanced regex scanner that is more precise
   than the previous generation: it tracks block scope via brace counting
   for brace-delimited languages and via indentation for Python.

Both backends emit the same ``Symbol`` shape so callers (find_symbols /
read_symbol / rename_symbol / extract_function) can consume either.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# --------------------------------------------------------------------- #
# Public data model
# --------------------------------------------------------------------- #


@dataclass(frozen=True)
class Symbol:
    """A single definition discovered in a source file.

    Attributes:
        name: Identifier name.
        line: 1-based start line.
        end_line: 1-based end line (inclusive). For the regex backend this
            is computed via brace/indent tracking; for tree-sitter it is
            the node's end point. May equal ``line`` for one-liners.
        kind: One of ``function``, ``method``, ``class``, ``interface``,
            ``type``, ``struct``, ``enum``, ``trait``, ``const``. The
            regex backend falls back to ``symbol`` for unknown shapes.
        language: Source language slug (python/javascript/go/rust).
        node: Optional tree-sitter node (only set by the AST backend).
            Callers that need byte offsets can use it; regex backend
            leaves this as None.
    """

    name: str
    line: int
    end_line: int
    kind: str
    language: str
    node: Any = field(default=None, repr=False, compare=False)


# --------------------------------------------------------------------- #
# Language detection (shared with callers)
# --------------------------------------------------------------------- #

_LANG_BY_EXT: dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "javascript",
    ".tsx": "javascript",
    ".go": "go",
    ".rs": "rust",
}


def detect_language_by_extension(file_path: str) -> str | None:
    """Return the language slug for a file based on its extension."""
    import os

    _, ext = os.path.splitext(file_path)
    return _LANG_BY_EXT.get(ext.lower())


# --------------------------------------------------------------------- #
# Tree-sitter backend
# --------------------------------------------------------------------- #

# Grammar loaders per language. Each loader returns the PyCapsule expected
# by tree_sitter.Language. Resolved lazily so missing grammars don't break
# import.

_TS_GRAMMAR_LOADERS: dict[str, tuple[str, str]] = {
    # language -> (module_name, attr_name) for ``language()`` callable
    "python": ("tree_sitter_python", "language"),
    "javascript": ("tree_sitter_javascript", "language"),
    "go": ("tree_sitter_go", "language"),
    "rust": ("tree_sitter_rust", "language"),
}
# TypeScript ships two grammars; the caller treats .ts/.tsx as javascript
# slug, so we pick ``language_typescript`` for .ts and ``language_tsx`` for
# .tsx. Since detect_language flattens both to "javascript", we use a
# separate entry that the parser resolves via file extension hint passed
# in the content's leading bytes — simpler: we just use language_typescript.
_TS_TS_MODULE = "tree_sitter_typescript"


# Per-language node type -> symbol kind mapping. Order matters: more
# specific kinds (e.g. method_definition vs function_declaration) should
# be probed in priority order when a node matches multiple shapes.
_TS_NODE_KIND: dict[str, dict[str, str]] = {
    "python": {
        "function_definition": "function",
        "class_definition": "class",
    },
    "javascript": {
        "function_declaration": "function",
        "method_definition": "method",
        "class_declaration": "class",
        "interface_declaration": "interface",
        "type_alias_declaration": "type",
        # variable_declarator carrying a function/arrow is handled specially
        # below.
    },
    "go": {
        "function_declaration": "function",
        "method_declaration": "method",
        # type_declaration is a wrapper — its type_spec / type_alias children
        # carry the name field and are handled by the generic name lookup.
        "type_spec": "type",
        "type_alias": "type",
        "method_elem": "method",
    },
    "rust": {
        "function_item": "function",
        "struct_item": "struct",
        "enum_item": "enum",
        "trait_item": "trait",
        "type_item": "type",
    },
}


# Node types we never descend into (avoid noise like decorator / comment).
_TS_SKIP_NODES: frozenset[str] = frozenset({"comment", "line_comment", "block_comment"})

# Wrapper nodes that themselves carry no name but should still be recursed
# into so their inner spec/alias children are picked up.
_TS_WRAPPER_NODES: dict[str, frozenset[str]] = {
    "go": frozenset({"type_declaration"}),
}


def _ts_build_parser(language: str) -> Any | None:
    """Return a configured tree-sitter Parser for *language* or None if the
    grammar is unavailable.
    """
    try:
        from tree_sitter import Language, Parser
    except ImportError:
        return None

    try:
        if language == "javascript" or language == "typescript":
            # Prefer typescript grammar for .ts/.tsx; fall back to plain JS.
            mod = __import__(_TS_TS_MODULE)
            # language_typescript for .ts, language_tsx for .tsx — we expose
            # both and let the caller choose. Default to typescript here;
            # callers passing a TSX hint should use parse_symbols_with_hint.
            capsule = mod.language_typescript()
        else:
            module_name, attr = _TS_GRAMMAR_LOADERS.get(language, (None, None))  # type: ignore[misc]
            if not module_name:
                return None
            mod = __import__(module_name)
            capsule = getattr(mod, attr)()
        lang = Language(capsule)
        return Parser(lang)
    except Exception:
        return None


def _ts_extract_name(node: Any, language: str) -> str | None:
    """Extract the identifier name from a definition node."""
    # Most grammars use a 'name' child of type identifier.
    name_field = node.child_by_field_name("name")
    if name_field is not None:
        try:
            return name_field.text.decode("utf-8")
        except Exception:
            return None

    # Fallback: scan children for an identifier node.
    for child in node.children:
        if child.type in {"identifier", "type_identifier", "property_identifier"}:
            try:
                return child.text.decode("utf-8")
            except Exception:
                continue
    return None


def _ts_walk(node: Any, language: str, out: list[Symbol]) -> None:
    """Depth-first walk collecting definition nodes."""
    kind_map = _TS_NODE_KIND.get(language, {})

    # Skip the type_declaration wrapper itself; recurse into children so
    # type_spec / type_alias are picked up with their own name field.
    skip_as_symbol = _TS_WRAPPER_NODES.get(language, frozenset())

    if node.type in kind_map and node.type not in skip_as_symbol:
        name = _ts_extract_name(node, language)
        if name:
            start_line = node.start_point[0] + 1
            end_line = node.end_point[0] + 1
            out.append(
                Symbol(
                    name=name,
                    line=start_line,
                    end_line=end_line,
                    kind=kind_map[node.type],
                    language=language,
                    node=node,
                )
            )

    # Special handling: JS/TS variable declarator with function/arrow value
    if language in {"javascript"} and node.type == "lexical_declaration":
        # const foo = (...) => {...}   or   const foo = function () {}
        for child in node.children:
            if child.type == "variable_declarator":
                name_node = child.child_by_field_name("name")
                value_node = child.child_by_field_name("value")
                if name_node and value_node and value_node.type in {
                    "arrow_function",
                    "function_expression",
                }:
                    try:
                        nm = name_node.text.decode("utf-8")
                    except Exception:
                        nm = None
                    if nm:
                        out.append(
                            Symbol(
                                name=nm,
                                line=child.start_point[0] + 1,
                                end_line=child.end_point[0] + 1,
                                kind="const",
                                language=language,
                                node=child,
                            )
                        )

    if node.type in _TS_SKIP_NODES:
        return

    for child in node.children:
        _ts_walk(child, language, out)


def _parse_with_treesitter(content: str, language: str) -> list[Symbol] | None:
    """Parse source with tree-sitter. Returns None if unavailable."""
    parser = _ts_build_parser(language)
    if parser is None:
        return None
    try:
        tree = parser.parse(content.encode("utf-8"))
    except Exception:
        return None
    out: list[Symbol] = []
    _ts_walk(tree.root_node, language, out)
    # Sort by line then by end_line (definitions can be nested)
    out.sort(key=lambda s: (s.line, s.end_line))
    return out


# --------------------------------------------------------------------- #
# Enhanced regex backend (fallback)
# --------------------------------------------------------------------- #
#
# The previous generation matched a single line per definition. This
# backend additionally tracks the symbol's *body extent* so read_symbol
# can slice accurately without relying on the next definition's location.

# Per-language definition patterns.
_REGEX_PATTERNS: dict[str, list[tuple[re.Pattern[str], str]]] = {
    "python": [
        (re.compile(r"^\s*(?:async\s+)?def\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\("), "name"),
        (re.compile(r"^\s*class\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*[\(:]"), "name"),
    ],
    "javascript": [
        (re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\("), "name"),
        (re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(?[^=]*=>"), "name"),
        (re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function"), "name"),
        (re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)"), "name"),
        (re.compile(r"^\s*(?:export\s+)?(?:interface|type)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*[={]"), "name"),
    ],
    "go": [
        (re.compile(r"^func\s+(?:\([^)]+\)\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\("), "name"),
        (re.compile(r"^\s*type\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface|func)"), "name"),
    ],
    "rust": [
        (re.compile(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*[<(]"), "name"),
        (re.compile(r"^\s*(?:pub\s+)?(?:struct|enum|trait|impl|type)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)"), "name"),
    ],
}


def _infer_kind_from_line(line: str) -> str:
    lower = line.lower()
    if "class" in lower:
        return "class"
    if "interface" in lower:
        return "interface"
    if "type " in lower and "=" in line:
        return "type"
    if "struct" in lower:
        return "struct"
    if "enum" in lower:
        return "enum"
    if "trait" in lower:
        return "trait"
    if any(k in lower for k in ("def ", "function", "fn ", "func ")):
        return "function"
    return "symbol"


_BRACE_LANGS: frozenset[str] = frozenset({"javascript", "go", "rust"})


def _find_block_end_brace(lines: list[str], start_idx: int) -> int:
    """For brace-delimited languages, walk from the definition line until
    the opening ``{`` brace count returns to zero. Returns the 1-based end
    line (inclusive)."""
    depth = 0
    started = False
    for i in range(start_idx, len(lines)):
        line = lines[i]
        # Strip strings/comments crudely to reduce false positives.
        stripped = _strip_strings_and_comments(line)
        for ch in stripped:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
                if started and depth == 0:
                    return i + 1  # 1-based
        # Python-style fallback: end of file
    return len(lines)


def _strip_strings_and_comments(line: str) -> str:
    """Crude stripping of string/comment characters from a single line.

    Only good enough to avoid gross brace-count drift; tree-sitter is the
    accurate backend when available.
    """
    # Remove // and # line comments
    for marker in ("//", "#"):
        idx = line.find(marker)
        if idx >= 0:
            # Make sure we're not inside a string (cheap heuristic: count quotes)
            head = line[:idx]
            if head.count('"') % 2 == 0 and head.count("'") % 2 == 0:
                line = head
                break
    # Remove double- and back-tick-quoted spans (single-line only)
    line = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', '""', line)
    line = re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'", "''", line)
    line = re.sub(r"`[^`]*`", "``", line)
    return line


def _find_block_end_python(lines: list[str], start_idx: int) -> int:
    """For Python, walk until the indentation returns to <= the def's
    indentation OR we hit EOF / a decorator of the same indent."""
    if start_idx >= len(lines):
        return start_idx + 1
    def_line = lines[start_idx]
    base_indent = len(def_line) - len(def_line.lstrip(" \t"))
    i = start_idx + 1
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        cur_indent = len(line) - len(line.lstrip(" \t"))
        if cur_indent <= base_indent:
            # Could be next def/class at same scope or outer — both end the body
            return i  # end_line is the line *before* this one (1-based: i)
        i += 1
    return len(lines)


def _parse_with_regex(content: str, language: str) -> list[Symbol]:
    patterns = _REGEX_PATTERNS.get(language, [])
    if not patterns:
        return []
    lines = content.splitlines()
    symbols: list[Symbol] = []

    for idx, line in enumerate(lines, start=1):
        for pattern, group in patterns:
            m = pattern.match(line)
            if not m:
                continue
            name = m.group(group)
            kind = _infer_kind_from_line(line)
            start_idx = idx - 1
            if language == "python":
                end_line = _find_block_end_python(lines, start_idx)
            elif language in _BRACE_LANGS:
                end_line = _find_block_end_brace(lines, start_idx)
            else:
                end_line = idx
            symbols.append(
                Symbol(
                    name=name,
                    line=idx,
                    end_line=end_line,
                    kind=kind,
                    language=language,
                )
            )
            break
    return symbols


# --------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------- #


def parse_symbols(content: str, language: str) -> list[Symbol]:
    """Parse source *content* and return a list of symbols.

    Prefers tree-sitter for AST accuracy; falls back to an enhanced regex
    scanner when the grammar is unavailable.
    """
    if not content:
        return []
    ts_result = _parse_with_treesitter(content, language)
    if ts_result is not None:
        return ts_result
    return _parse_with_regex(content, language)


def treesitter_available(language: str) -> bool:
    """Return True if tree-sitter and the matching grammar are importable."""
    return _ts_build_parser(language) is not None


__all__ = [
    "Symbol",
    "detect_language_by_extension",
    "parse_symbols",
    "treesitter_available",
]

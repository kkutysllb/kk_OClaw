"""Test execution and linting tools for the Coding Agent.

Provides:
- ``run_tests``: Auto-detect test framework and run tests with structured result parsing
- ``run_linter``: Run a linter / type-checker on the project

The result payloads are structured JSON so the agent can directly locate
failing assertions, error lines, and severity counts instead of grepping
raw stdout.
"""

import json
import os
import re
import tempfile

from langchain.tools import tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from kkoclaw.sandbox.tools import (
    _sanitize_error,
    execute_sandbox_command,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
)
from kkoclaw.tools.types import Runtime

# Max characters of raw output stored in the ``test_results`` state entry.
# The full JSON is still returned to the model via ToolMessage; this truncation
# only applies to the state field consumed by ``_summarize_run_outcome``.
_STATE_OUTPUT_CAP = 2000


def _build_test_result_command(
    runtime: Runtime,
    result: dict,
    *,
    is_lint: bool = False,
) -> Command:
    """Wrap a test/lint result dict into a ``Command`` that writes
    ``test_results`` state and returns the full JSON as a ToolMessage.

    The ``merge_test_results`` reducer on ``CodingThreadState`` appends this
    entry, so consecutive run_tests + run_linter calls don't overwrite each
    other.
    """
    if is_lint:
        entry: dict = {
            "command": result.get("command", ""),
            "passed": bool(result.get("clean", False)),
            "output": str(result.get("output", ""))[:_STATE_OUTPUT_CAP],
        }
    else:
        entry = {
            "command": result.get("command", ""),
            "passed": bool(result.get("passed", False)),
            "output": str(result.get("raw_output", ""))[:_STATE_OUTPUT_CAP],
            "summary": result.get("summary") if isinstance(result.get("summary"), dict) else None,
        }
    result_json = json.dumps(result, indent=2, ensure_ascii=False)
    tool_call_id = getattr(runtime, "tool_call_id", None)
    if not tool_call_id:
        return result_json
    return Command(
        update={
            "test_results": [entry],
            "messages": [
                ToolMessage(
                    content=result_json,
                    tool_call_id=tool_call_id,
                ),
            ],
        },
    )

# Framework detection heuristics
_FRAMEWORK_DETECTORS = [
    ("pytest", ["pytest.ini", "setup.cfg", "pyproject.toml"], ["test_*.py", "*_test.py"]),
    ("jest", ["jest.config.js", "jest.config.ts", "package.json"], ["*.test.js", "*.test.ts", "*.spec.js", "*.spec.ts"]),
    ("vitest", ["vitest.config.ts", "vitest.config.js"], ["*.test.ts", "*.test.js", "*.spec.ts"]),
    ("go test", ["go.mod"], ["*_test.go"]),
]


def _command_with_project_root(runtime: Runtime, cmd: str) -> str:
    """If the coding agent has an open project, prefix *cmd* with a cd so the
    command runs inside the project root rather than the server CWD."""
    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None
    if project_root:
        return f'cd "{project_root}" && {cmd}'
    return cmd


def _project_root_from_runtime(runtime: Runtime) -> str:
    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None
    return project_root or "/mnt/user-data/workspace"


def _detect_test_framework(runtime: Runtime) -> str | None:
    """Detect the most likely test framework based on project files."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)
    project_root = _project_root_from_runtime(runtime)

    for framework, markers, _ in _FRAMEWORK_DETECTORS:
        for marker in markers:
            try:
                files, _ = sandbox.glob(project_root, marker, include_dirs=False, max_results=1)
                if files:
                    return framework
            except Exception:
                continue
    return None


def _detect_linter(runtime: Runtime) -> str | None:
    """Detect available linter based on project files and installed binaries.

    Order of preference:
      Python: ruff > flake8 > pylint > mypy
      Node:   eslint > tsc
      Go:     go vet
      Rust:   cargo clippy
    """
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)

    thread_data = get_thread_data(runtime)
    project_root = thread_data.get("project_root") if thread_data else None

    def _project_has(*names: str) -> bool:
        if not project_root:
            return False
        for name in names:
            try:
                files, _ = sandbox.glob(project_root, name, include_dirs=False, max_results=1)
                if files:
                    return True
            except Exception:
                continue
        return False

    def _binary_available(name: str) -> bool:
        try:
            result = execute_sandbox_command(runtime, sandbox, f"which {name} 2>/dev/null")
            return bool(result.strip()) and "not found" not in result.lower()
        except Exception:
            return False

    # Python project — prefer ruff
    if _project_has("pyproject.toml", "setup.py", "requirements.txt", "setup.cfg"):
        for linter in ("ruff", "flake8", "pylint", "mypy"):
            if _binary_available(linter):
                return linter

    # Node/TS project — prefer eslint, fallback tsc
    if _project_has("package.json", "tsconfig.json"):
        if _binary_available("eslint"):
            return "eslint"
        if _binary_available("tsc"):
            return "tsc"

    # Go project
    if _project_has("go.mod") and _binary_available("go"):
        return "go vet"

    # Rust project
    if _project_has("Cargo.toml") and _binary_available("cargo"):
        return "cargo clippy"

    # Legacy fallback: any installed linter
    for linter in ("ruff", "flake8", "eslint", "mypy"):
        if _binary_available(linter):
            return linter

    return None


# ----------------------------------------------------------------------
# Pytest structured parsing via --json-report
# ----------------------------------------------------------------------


def _run_pytest_structured(runtime: Runtime, target: str | None, extra_args: str) -> dict:
    """Run pytest with --json-report and parse the structured output.

    Falls back to plain text parsing if pytest-json-report is not installed.
    """
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)

    tmp_dir = tempfile.mkdtemp(prefix="kkoclaw_pytest_")
    report_path = os.path.join(tmp_dir, "report.json")

    # Try with --json-report first; if the plugin is missing, fall back.
    cmd_parts = [
        "python -m pytest -v --tb=short",
        f"--json-report --json-report-file={report_path}",
        extra_args,
    ]
    if target:
        cmd_parts.append(target)
    cmd = " ".join(p for p in cmd_parts if p)

    output = execute_sandbox_command(runtime, sandbox, _command_with_project_root(runtime, cmd))

    # Read the JSON report if it was produced
    report = _read_pytest_json_report(report_path)
    if report is not None:
        return _summarize_pytest_json(report, cmd, output)

    # Fallback: parse the raw text output
    return _parse_pytest_text(output, cmd)


def _read_pytest_json_report(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _summarize_pytest_json(report: dict, command: str, raw_output: str) -> dict:
    summary = report.get("summary", {}) or {}
    total = summary.get("total", 0)
    passed = summary.get("passed", 0)
    failed = summary.get("failed", 0)
    errors = summary.get("errors", 0)
    skipped = summary.get("skipped", 0)

    failing_tests: list[dict] = []
    for test in report.get("tests", []) or []:
        outcome = test.get("outcome")
        if outcome in ("failed", "error"):
            call = test.get("call") or {}
            crash = call.get("crash") or {}
            failing_tests.append({
                "nodeid": test.get("nodeid", ""),
                "outcome": outcome,
                "file": _nodeid_to_file(test.get("nodeid", "")),
                "message": crash.get("message", "")[:500] if crash.get("message") else "",
                "longrepr": (call.get("longrepr") or "")[:1500],
            })

    return {
        "framework": "pytest",
        "command": command,
        "passed": failed == 0 and errors == 0,
        "structured": True,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
        },
        "failing_tests": failing_tests[:50],  # cap to avoid token bloat
        "raw_output": raw_output[:8000],
    }


def _nodeid_to_file(nodeid: str) -> str:
    """Convert a pytest nodeid like 'tests/test_foo.py::test_bar' to 'tests/test_foo.py'."""
    return nodeid.split("::", 1)[0] if "::" in nodeid else nodeid


# ----------------------------------------------------------------------
# Text-based fallback parsers
# ----------------------------------------------------------------------


_PYTEST_SUMMARY_RE = re.compile(
    r"(?P<passed>\d+) passed(?:[,\s]+(?P<failed>\d+) failed)?"
    r"(?:[,\s]+(?P<errors>\d+) errors)?(?:[,\s]+(?P<skipped>\d+) skipped)?",
    re.IGNORECASE,
)
_JEST_SUMMARY_RE = re.compile(
    r"Tests:\s+(?P<failed>\d+) failed(?:,\s+(?P<pending>\d+) pending)?"
    r",\s+(?P<passed>\d+) passed",
    re.IGNORECASE,
)


def _parse_pytest_text(output: str, command: str) -> dict:
    m = _PYTEST_SUMMARY_RE.search(output)
    if m:
        passed = int(m.group("passed") or 0)
        failed = int(m.group("failed") or 0)
        errors = int(m.group("errors") or 0)
        skipped = int(m.group("skipped") or 0)
    else:
        passed, failed, errors, skipped = 0, 0, 0, 0
        if "error" in output.lower():
            errors = 1

    failing_tests = _extract_pytest_failures(output)
    return {
        "framework": "pytest",
        "command": command,
        "passed": failed == 0 and errors == 0,
        "structured": False,
        "summary": {
            "total": passed + failed + errors + skipped,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
        },
        "failing_tests": failing_tests,
        "raw_output": output[:8000],
    }


def _extract_pytest_failures(output: str) -> list[dict]:
    """Extract failed test nodeids from pytest -v output."""
    failures: list[dict] = []
    for m in re.finditer(r"^FAILED\s+(.+?)(?:\s+-\s+(.*))?$", output, re.MULTILINE):
        nodeid = m.group(1).strip()
        message = (m.group(2) or "").strip()[:500]
        failures.append({
            "nodeid": nodeid,
            "outcome": "failed",
            "file": _nodeid_to_file(nodeid),
            "message": message,
        })
    return failures[:50]


def _parse_jest_text(output: str, command: str) -> dict:
    m = _JEST_SUMMARY_RE.search(output)
    if m:
        failed = int(m.group("failed") or 0)
        pending = int(m.group("pending") or 0)
        passed = int(m.group("passed") or 0)
    else:
        failed, passed, pending = 0, 0, 0
        if "✕" in output or "failed" in output.lower():
            failed = 1

    return {
        "framework": "jest",
        "command": command,
        "passed": failed == 0,
        "structured": False,
        "summary": {
            "total": passed + failed + pending,
            "passed": passed,
            "failed": failed,
            "errors": 0,
            "skipped": pending,
        },
        "failing_tests": _extract_jest_failures(output),
        "raw_output": output[:8000],
    }


def _extract_jest_failures(output: str) -> list[dict]:
    """Extract failed test names from jest output lines like '✕ test name (xx ms)'."""
    failures: list[dict] = []
    for m in re.finditer(r"✕\s+(.+?)(?:\s+\([\d.]+\s*(?:ms|s)\))?$", output, re.MULTILINE):
        name = m.group(1).strip()
        failures.append({"nodeid": name, "outcome": "failed", "message": ""})
    return failures[:50]


def _parse_generic_text(output: str, command: str, framework: str) -> dict:
    """Last-resort parser for go test / cargo test / unknown frameworks."""
    lower = output.lower()
    failed = False
    if "fail" in lower and "0 fail" not in lower:
        failed = True
    if "error" in lower and "0 error" not in lower:
        failed = True

    return {
        "framework": framework,
        "command": command,
        "passed": not failed,
        "structured": False,
        "summary": {},
        "failing_tests": [],
        "raw_output": output[:8000],
    }


@tool("run_tests", parse_docstring=True)
def run_tests_tool(
    runtime: Runtime,
    framework: str | None = None,
    target: str | None = None,
    extra_args: str = "",
) -> str:
    """Run tests using the detected or specified test framework.

    Returns a structured JSON result with pass/fail counts and a list of
    failing test nodeids so you can directly locate the failures.

    When ``framework`` is not provided, auto-detection is attempted based on
    project files (pytest, jest, vitest, go test).

    For pytest, if ``pytest-json-report`` is installed, the result includes
    rich structured data (failing test file paths, crash messages, longrepr
    snippets). Otherwise a text-based fallback is used.

    Args:
        framework: Test framework to use (pytest, jest, vitest, go test). Auto-detected if None.
        target: Specific test file or test name to run. If None, runs all tests.
        extra_args: Additional CLI arguments to pass to the test runner.
    """
    try:
        fw = framework or _detect_test_framework(runtime)
        if not fw:
            return (
                "Error: Could not auto-detect test framework. "
                "Please specify the 'framework' parameter."
            )

        # pytest — use structured path
        if fw == "pytest":
            result = _run_pytest_structured(runtime, target, extra_args)
            return _build_test_result_command(runtime, result)

        # jest / vitest — try to parse text summary
        if fw in ("jest", "vitest"):
            runner = "npx jest" if fw == "jest" else "npx vitest"
            cmd = f"{runner} --verbose {extra_args}"
            if target:
                cmd += f" {target}"
            sandbox = ensure_sandbox_initialized(runtime)
            ensure_thread_directories_exist(runtime)
            output = execute_sandbox_command(runtime, sandbox, _command_with_project_root(runtime, cmd))
            result = _parse_jest_text(output, cmd)
            return _build_test_result_command(runtime, result)

        # go test / cargo test / others
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        cmd = f"{fw} {extra_args}"
        if target:
            cmd += f" {target}"
        output = execute_sandbox_command(runtime, sandbox, _command_with_project_root(runtime, cmd))
        result = _parse_generic_text(output, cmd, fw)
        return _build_test_result_command(runtime, result)
    except Exception as e:
        return f"Error: Failed to run tests: {_sanitize_error(e, runtime)}"


@tool("run_linter", parse_docstring=True)
def run_linter_tool(
    runtime: Runtime,
    linter: str | None = None,
    target: str = ".",
    extra_args: str = "",
) -> str:
    """Run a linter or type-checker on the project and return structured output.

    If ``linter`` is not provided, auto-detection is attempted based on
    the project's language and installed tools:
      - Python: ruff > flake8 > pylint > mypy
      - Node/TS: eslint > tsc
      - Go:     go vet
      - Rust:   cargo clippy

    The result includes a ``clean`` flag, an ``issue_count``, and a
    truncated list of issues with file/line/message so you can directly
    jump to the problem spots.

    Args:
        linter: Linter to run (ruff, flake8, pylint, eslint, mypy, tsc,
            go vet, cargo clippy). Auto-detected if None.
        target: File or directory to lint. Default "." (current directory).
        extra_args: Additional CLI arguments for the linter.
    """
    try:
        ln = linter or _detect_linter(runtime)
        if not ln:
            return (
                "Error: Could not auto-detect a linter. "
                "Please specify the 'linter' parameter."
            )

        if ln == "ruff":
            cmd = f"ruff check --output-format=concise {extra_args} {target}"
        elif ln == "flake8":
            cmd = f"flake8 {extra_args} {target}"
        elif ln == "pylint":
            cmd = f"pylint --output-format=text {extra_args} {target}"
        elif ln == "eslint":
            cmd = f"npx eslint --format=compact {extra_args} {target}"
        elif ln == "mypy":
            cmd = f"mypy {extra_args} {target}"
        elif ln == "tsc":
            cmd = f"npx tsc --noEmit {extra_args}"
        elif ln == "go vet":
            cmd = f"go vet {extra_args} {target}"
        elif ln == "cargo clippy":
            cmd = f"cargo clippy --message-format=short {extra_args}"
        else:
            cmd = f"{ln} {extra_args} {target}"

        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        output = execute_sandbox_command(runtime, sandbox, _command_with_project_root(runtime, cmd))

        issues = _parse_linter_issues(output, ln)
        has_issues = bool(issues) and "no issues" not in output.lower() and "all checks passed" not in output.lower() and "no problems" not in output.lower()

        result = {
            "linter": ln,
            "command": cmd,
            "clean": not has_issues,
            "issue_count": len(issues) if has_issues else 0,
            "issues": issues[:100],  # cap to avoid token bloat
            "output": output[:6000] if output.strip() else "(no issues found)",
        }
        return _build_test_result_command(runtime, result, is_lint=True)
    except Exception as e:
        return f"Error: Failed to run linter: {_sanitize_error(e, runtime)}"


# Generic linter issue pattern: file:line:col? message
_LINTER_ISSUE_RE = re.compile(
    r"^(?P<file>[^\s:]+):(?P<line>\d+)(?::(?P<col>\d+))?:\s*(?P<message>.+)$"
)
_TSC_ISSUE_RE = re.compile(
    r"^(?P<file>.+?)\((?P<line>\d+),(?P<col>\d+)\):\s*(?P<message>.+)$"
)


def _parse_linter_issues(output: str, linter: str) -> list[dict]:
    """Parse common linter output formats into a list of issue dicts.

    Each issue: {"file": str, "line": int, "column": int|None, "message": str}
    """
    issues: list[dict] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Skip summary lines that aren't issues
        if any(marker in stripped.lower() for marker in (
            "found", "warning", "error", "checking", "processing",
        )) and ":" not in stripped:
            continue
        m = _TSC_ISSUE_RE.match(stripped) or _LINTER_ISSUE_RE.match(stripped)
        if m:
            try:
                line_no = int(m.group("line"))
            except ValueError:
                continue
            col = m.group("col")
            issues.append({
                "file": m.group("file"),
                "line": line_no,
                "column": int(col) if col else None,
                "message": m.group("message").strip()[:300],
            })
    return issues

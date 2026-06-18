"""Test execution and linting tools for the Coding Agent.

Provides:
- ``run_tests``: Auto-detect test framework and run tests
- ``run_linter``: Run a linter / type-checker on the project
"""

import json

from langchain.tools import tool

from kkoclaw.sandbox.tools import (
    _sanitize_error,
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_thread_data,
)
from kkoclaw.tools.types import Runtime

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


def _detect_test_framework(runtime: Runtime) -> str | None:
    """Detect the most likely test framework based on project files."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)

    for framework, markers, _ in _FRAMEWORK_DETECTORS:
        for marker in markers:
            try:
                files, _ = sandbox.glob("/mnt/user-data/workspace", marker, include_dirs=False, max_results=1)
                if files:
                    return framework
            except Exception:
                continue
    return None


def _detect_linter(runtime: Runtime) -> str | None:
    """Detect available linter based on project files."""
    sandbox = ensure_sandbox_initialized(runtime)
    ensure_thread_directories_exist(runtime)

    # Python: ruff > flake8 > pylint
    for linter in ["ruff", "flake8", "pylint"]:
        try:
            result = sandbox.execute_command(f"which {linter} 2>/dev/null")
            if result.strip() and "not found" not in result.lower():
                return linter
        except Exception:
            continue

    # Node: eslint
    try:
        result = sandbox.execute_command("which eslint 2>/dev/null")
        if result.strip() and "not found" not in result.lower():
            return "eslint"
    except Exception:
        pass

    return None


@tool("run_tests", parse_docstring=True)
def run_tests_tool(
    runtime: Runtime,
    framework: str | None = None,
    target: str | None = None,
    extra_args: str = "",
) -> str:
    """Run tests using the detected or specified test framework.

    If ``framework`` is not provided, auto-detection is attempted based on
    project files (pytest, jest, vitest, go test).

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

        if fw == "pytest":
            cmd = f"python -m pytest -v --tb=short {extra_args}"
            if target:
                cmd += f" {target}"
        elif fw == "jest":
            cmd = f"npx jest --verbose {extra_args}"
            if target:
                cmd += f" {target}"
        else:
            cmd = f"{fw} {extra_args}"
            if target:
                cmd += f" {target}"

        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        output = sandbox.execute_command(_command_with_project_root(runtime, cmd))

        # Parse pass/fail summary
        passed = bool(output)
        failed = False
        summary = ""

        if "passed" in output.lower() or "no tests ran" in output.lower():
            failed = "failed" in output.lower() and "0 failed" not in output.lower()
        elif "error" in output.lower() or "failed" in output.lower():
            failed = True

        result = {
            "framework": fw,
            "command": cmd,
            "passed": not failed,
            "summary": summary,
            "output": output,
        }
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: Failed to run tests: {_sanitize_error(e, runtime)}"


@tool("run_linter", parse_docstring=True)
def run_linter_tool(
    runtime: Runtime,
    linter: str | None = None,
    target: str = ".",
    extra_args: str = "",
) -> str:
    """Run a linter or type-checker on the project.

    If ``linter`` is not provided, auto-detection is attempted (ruff,
    flake8, eslint).

    Args:
        linter: Linter to run (ruff, flake8, pylint, eslint, mypy). Auto-detected if None.
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
            cmd = f"ruff check {extra_args} {target}"
        elif ln == "flake8":
            cmd = f"flake8 {extra_args} {target}"
        elif ln == "pylint":
            cmd = f"pylint {extra_args} {target}"
        elif ln == "eslint":
            cmd = f"npx eslint {extra_args} {target}"
        elif ln == "mypy":
            cmd = f"mypy {extra_args} {target}"
        else:
            cmd = f"{ln} {extra_args} {target}"

        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        output = sandbox.execute_command(_command_with_project_root(runtime, cmd))

        # Most linters exit non-zero on issues but still produce output
        has_issues = bool(output.strip()) and "no issues" not in output.lower() and "all checks passed" not in output.lower()

        result = {
            "linter": ln,
            "command": cmd,
            "clean": not has_issues,
            "output": output if output.strip() else "(no issues found)",
        }
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: Failed to run linter: {_sanitize_error(e, runtime)}"

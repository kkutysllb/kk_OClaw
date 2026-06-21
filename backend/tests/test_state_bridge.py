"""Tests for the end-to-end state bridge fixes.

Covers:
- ``build_file_diff_entry`` / ``commit_edit_to_state`` (diff → graph state)
- ``merge_test_results`` reducer (test_results append + cap)
- ``_build_test_result_command`` (test_results → graph state)
- PostEditVerifyMiddleware coverage of refactor tools
"""

from __future__ import annotations

from types import SimpleNamespace

from kkoclaw.agents.middlewares.post_edit_verify_middleware import (
    _MUTATING_TOOL_NAMES,
    PostEditVerifyMiddleware,
)
from kkoclaw.agents.thread_state import merge_test_results
from kkoclaw.coding_core.change_tracking import (
    build_file_diff_entry,
    commit_edit_to_state,
)

# ---------------------------------------------------------------------------
# Fake runtime helpers
# ---------------------------------------------------------------------------


def _make_runtime(
    *,
    project_root: str | None = "/fake/project",
    thread_id: str = "t1",
    tool_call_id: str = "call_123",
):
    """Build a minimal fake runtime with .context, .config, .tool_call_id."""
    context = {}
    if project_root:
        context["project_root"] = project_root
    if thread_id:
        context["thread_id"] = thread_id
    return SimpleNamespace(
        context=context,
        config={"configurable": {"thread_id": thread_id, "project_root": project_root}},
        tool_call_id=tool_call_id,
    )


# ---------------------------------------------------------------------------
# build_file_diff_entry
# ---------------------------------------------------------------------------


class TestBuildFileDiffEntry:
    def test_modified_entry(self):
        runtime = _make_runtime(project_root="/fake/project")
        entry = build_file_diff_entry(
            runtime,
            file_path="/fake/project/src/main.py",
            before="old\n",
            after="new\n",
        )
        assert entry is not None
        assert entry["file_path"] == "src/main.py"
        assert entry["status"] == "modified"
        assert entry["additions"] == 1
        assert entry["deletions"] == 1

    def test_added_entry(self):
        runtime = _make_runtime(project_root="/fake/project")
        entry = build_file_diff_entry(
            runtime,
            file_path="/fake/project/new_file.py",
            before=None,
            after="line1\nline2\n",
        )
        assert entry is not None
        assert entry["status"] == "added"
        assert entry["additions"] == 2
        assert entry["deletions"] == 0

    def test_deleted_entry(self):
        runtime = _make_runtime(project_root="/fake/project")
        entry = build_file_diff_entry(
            runtime,
            file_path="/fake/project/deleted.py",
            before="content\n",
            after="",
        )
        assert entry is not None
        assert entry["status"] == "deleted"
        assert entry["deletions"] == 1

    def test_no_change_returns_none(self):
        runtime = _make_runtime(project_root="/fake/project")
        entry = build_file_diff_entry(
            runtime,
            file_path="/fake/project/src/main.py",
            before="same\n",
            after="same\n",
        )
        assert entry is None

    def test_no_project_root_uses_absolute_path(self):
        runtime = _make_runtime(project_root=None)
        entry = build_file_diff_entry(
            runtime,
            file_path="/abs/path/file.py",
            before="a\n",
            after="b\n",
        )
        assert entry is not None
        # Without project_root, falls back to absolute path
        assert entry["file_path"] == "/abs/path/file.py"


# ---------------------------------------------------------------------------
# commit_edit_to_state
# ---------------------------------------------------------------------------


class TestCommitEditToState:
    def test_returns_command_when_diff_available(self):
        runtime = _make_runtime()
        result = commit_edit_to_state(
            runtime,
            result_message="OK: Applied 1 hunk",
            file_path="/fake/project/src/main.py",
            before="old\n",
            after="new\n",
        )
        # Should be a Command, not a plain str
        assert not isinstance(result, str)
        update = result.update
        assert "diff" in update
        assert len(update["diff"]) == 1
        assert update["diff"][0]["file_path"] == "src/main.py"
        # ToolMessage should be in messages
        msgs = update["messages"]
        assert len(msgs) == 1
        assert msgs[0].content == "OK: Applied 1 hunk"
        assert msgs[0].tool_call_id == "call_123"

    def test_returns_str_when_no_change(self):
        runtime = _make_runtime()
        result = commit_edit_to_state(
            runtime,
            result_message="OK: nothing changed",
            file_path="/fake/project/src/main.py",
            before="same\n",
            after="same\n",
        )
        assert isinstance(result, str)
        assert result == "OK: nothing changed"

    def test_returns_str_when_no_tool_call_id(self):
        """Without tool_call_id (e.g. direct function call in tests),
        falls back to plain str instead of crashing with AttributeError."""
        runtime = _make_runtime(tool_call_id=None)
        # Simulate a runtime without tool_call_id attribute at all
        delattr(runtime, "tool_call_id")
        result = commit_edit_to_state(
            runtime,
            result_message="OK: Applied",
            file_path="/fake/project/src/main.py",
            before="old\n",
            after="new\n",
        )
        assert isinstance(result, str)
        assert result == "OK: Applied"


# ---------------------------------------------------------------------------
# merge_test_results
# ---------------------------------------------------------------------------


class TestMergeTestResults:
    def test_appends_new_results(self):
        existing = [{"command": "ruff check .", "passed": True, "output": ""}]
        new = [{"command": "pytest", "passed": False, "output": "1 failed"}]
        merged = merge_test_results(existing, new)
        assert len(merged) == 2
        assert merged[0]["command"] == "ruff check ."
        assert merged[1]["command"] == "pytest"

    def test_caps_at_20_entries(self):
        existing = [{"command": f"cmd{i}", "passed": True, "output": ""} for i in range(15)]
        new = [{"command": f"new{i}", "passed": True, "output": ""} for i in range(10)]
        merged = merge_test_results(existing, new)
        assert len(merged) == 20
        # Should keep the most recent 20
        assert merged[-1]["command"] == "new9"

    def test_none_existing(self):
        new = [{"command": "pytest", "passed": True, "output": ""}]
        merged = merge_test_results(None, new)
        assert merged == new

    def test_none_new(self):
        existing = [{"command": "pytest", "passed": True, "output": ""}]
        merged = merge_test_results(existing, None)
        assert merged == existing


# ---------------------------------------------------------------------------
# _build_test_result_command (imported from test_tools)
# ---------------------------------------------------------------------------


class TestBuildTestResultCommand:
    def test_test_result_command_has_correct_entry(self):
        from kkoclaw.tools.coding.test_tools import _build_test_result_command

        runtime = _make_runtime()
        result = {
            "framework": "pytest",
            "command": "pytest --json-report",
            "passed": True,
            "summary": {"passed": 5, "total": 5},
            "failing_tests": [],
            "raw_output": "===== 5 passed =====",
        }
        cmd = _build_test_result_command(runtime, result)
        update = cmd.update
        assert "test_results" in update
        entry = update["test_results"][0]
        assert entry["command"] == "pytest --json-report"
        assert entry["passed"] is True
        assert entry["summary"] == {"passed": 5, "total": 5}
        # Full JSON in ToolMessage
        msgs = update["messages"]
        assert len(msgs) == 1
        assert "5 passed" in msgs[0].content or "passed" in msgs[0].content

    def test_lint_result_command_has_correct_entry(self):
        from kkoclaw.tools.coding.test_tools import _build_test_result_command

        runtime = _make_runtime()
        result = {
            "linter": "ruff",
            "command": "ruff check --output-format=concise .",
            "clean": True,
            "issue_count": 0,
            "issues": [],
            "output": "All checks passed!",
        }
        cmd = _build_test_result_command(runtime, result, is_lint=True)
        entry = cmd.update["test_results"][0]
        assert entry["command"] == "ruff check --output-format=concise ."
        assert entry["passed"] is True  # clean → passed
        assert "summary" not in entry or entry.get("summary") is None

    def test_returns_json_str_when_no_tool_call_id(self):
        """Without tool_call_id, falls back to JSON string instead of crashing."""
        from kkoclaw.tools.coding.test_tools import _build_test_result_command

        runtime = _make_runtime(tool_call_id=None)
        delattr(runtime, "tool_call_id")
        result = {
            "framework": "pytest",
            "command": "pytest",
            "passed": True,
            "raw_output": "ok",
        }
        ret = _build_test_result_command(runtime, result)
        assert isinstance(ret, str)
        import json as _json
        parsed = _json.loads(ret)
        assert parsed["passed"] is True


# ---------------------------------------------------------------------------
# PostEditVerifyMiddleware covers refactor tools
# ---------------------------------------------------------------------------


class TestPostEditVerifyCoversRefactorTools:
    def test_rename_symbol_in_mutating_set(self):
        assert "rename_symbol" in _MUTATING_TOOL_NAMES

    def test_extract_function_in_mutating_set(self):
        assert "extract_function" in _MUTATING_TOOL_NAMES

    def test_middleware_triggers_on_rename_symbol(self):
        """A successful rename_symbol ToolMessage should trigger the reminder."""
        from langchain_core.messages import AIMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            AIMessage(content="I'll rename the symbol", tool_calls=[]),
            ToolMessage(
                content="Renamed 'foo' -> 'bar' (3 occurrences updated).",
                name="rename_symbol",
                tool_call_id="tc1",
            ),
        ]
        assert mw._needs_reminder(messages) is True

    def test_middleware_triggers_on_extract_function(self):
        from langchain_core.messages import AIMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            AIMessage(content="Extracting function", tool_calls=[]),
            ToolMessage(
                content="Extracted lines 10-20 into function 'helper'.",
                name="extract_function",
                tool_call_id="tc2",
            ),
        ]
        assert mw._needs_reminder(messages) is True

    def test_reminder_suppressed_after_verification(self):
        """If run_tests follows rename_symbol, no reminder."""
        from langchain_core.messages import AIMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            AIMessage(content="Renaming", tool_calls=[]),
            ToolMessage(
                content="Renamed 'foo' -> 'bar'",
                name="rename_symbol",
                tool_call_id="tc1",
            ),
            AIMessage(content="Verifying", tool_calls=[]),
            ToolMessage(
                content='{"passed": true}',
                name="run_tests",
                tool_call_id="tc2",
            ),
        ]
        assert mw._needs_reminder(messages) is False

    def test_tdd_guard_reminds_when_feature_edits_production_before_test(self):
        from langchain_core.messages import HumanMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            HumanMessage(content="请修复登录失败 bug，并补齐回归测试"),
            ToolMessage(
                content="Modified src/auth/login.py",
                name="apply_diff",
                tool_call_id="tc1",
            ),
        ]

        assert mw._needs_tdd_first_reminder(messages) is True

    def test_tdd_guard_suppressed_after_test_file_edit(self):
        from langchain_core.messages import HumanMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            HumanMessage(content="请实现支付回调功能"),
            ToolMessage(
                content="Modified tests/test_payment_callback.py",
                name="apply_diff",
                tool_call_id="tc1",
            ),
            ToolMessage(
                content="Modified src/payment/callback.py",
                name="apply_diff",
                tool_call_id="tc2",
            ),
        ]

        assert mw._needs_tdd_first_reminder(messages) is False

    def test_tdd_guard_ignores_docs_only_task(self):
        from langchain_core.messages import HumanMessage, ToolMessage

        mw = PostEditVerifyMiddleware(mode="soft")
        messages = [
            HumanMessage(content="请更新 README 文档说明"),
            ToolMessage(
                content="Modified src/auth/login.py",
                name="apply_diff",
                tool_call_id="tc1",
            ),
        ]

        assert mw._needs_tdd_first_reminder(messages) is False

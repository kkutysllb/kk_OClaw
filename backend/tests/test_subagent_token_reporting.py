"""Tests for subagent token reporting to RunJournal.

Verifies that:
1. Token extraction from AI message dicts works correctly
2. _find_run_journal locates the RunJournal through various config sources
3. _report_subagent_tokens correctly updates the RunJournal's counters
4. RunJournal.record_subagent_tokens accumulates tokens properly

NOTE: conftest.py mocks ``kkoclaw.subagents.executor`` to break a circular
import chain.  This file therefore avoids importing SubagentResult /
SubagentStatus directly and uses lightweight stand-ins instead.
"""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from kkoclaw.runtime.journal import RunJournal
from kkoclaw.tools.builtins.task_tool import _find_run_journal, _report_subagent_tokens


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_journal() -> RunJournal:
    """Create a RunJournal with a mock event store."""
    from kkoclaw.runtime.events.store import RunEventStore
    mock_store = MagicMock(spec=RunEventStore)
    return RunJournal(run_id="test-run", thread_id="test-thread", event_store=mock_store)


def _make_subagent_result(
    total_tokens: int = 500,
    total_input_tokens: int = 300,
    total_output_tokens: int = 200,
    llm_call_count: int = 2,
) -> SimpleNamespace:
    """Create a result object with token fields (avoids conftest mock)."""
    return SimpleNamespace(
        total_tokens=total_tokens,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        llm_call_count=llm_call_count,
    )


def _make_runtime_with_callbacks(callbacks: list) -> MagicMock:
    """Create a mock ToolRuntime with config.callbacks set."""
    runtime = MagicMock()
    runtime.config = {"callbacks": callbacks, "configurable": {}, "metadata": {}}
    return runtime


# ── Test: Token extraction from AI message dicts ─────────────────────────────


class TestTokenExtractionFromAIMessages:
    """Verify the token extraction logic used in SubagentExecutor._aexecute."""

    def test_extraction_with_usage_metadata(self):
        ai_messages = [
            {
                "content": "Hello",
                "usage_metadata": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "total_tokens": 150,
                },
            },
            {
                "content": "World",
                "usage_metadata": {
                    "input_tokens": 200,
                    "output_tokens": 150,
                    "total_tokens": 350,
                },
            },
            {
                "content": "No usage here",
            },
        ]
        # Simulate the extraction logic from executor._aexecute
        total_tokens = 0
        total_input = 0
        total_output = 0
        llm_calls = 0
        for msg_dict in ai_messages:
            usage = msg_dict.get("usage_metadata") or msg_dict.get("additional_kwargs", {}).get("usage_metadata")
            if not usage:
                continue
            input_tk = usage.get("input_tokens", 0) or 0
            output_tk = usage.get("output_tokens", 0) or 0
            total_tk = usage.get("total_tokens", 0) or 0
            if total_tk == 0:
                total_tk = input_tk + output_tk
            if total_tk > 0:
                total_input += input_tk
                total_output += output_tk
                total_tokens += total_tk
                llm_calls += 1

        assert total_tokens == 500
        assert total_input == 300
        assert total_output == 200
        assert llm_calls == 2

    def test_extraction_with_zero_total_uses_sum(self):
        """When total_tokens is 0 in usage_metadata, use input + output."""
        ai_messages = [
            {
                "content": "Hello",
                "usage_metadata": {
                    "input_tokens": 80,
                    "output_tokens": 40,
                    "total_tokens": 0,  # Should fallback to input+output
                },
            },
        ]
        total_tokens = 0
        for msg_dict in ai_messages:
            usage = msg_dict.get("usage_metadata")
            if not usage:
                continue
            input_tk = usage.get("input_tokens", 0) or 0
            output_tk = usage.get("output_tokens", 0) or 0
            total_tk = usage.get("total_tokens", 0) or 0
            if total_tk == 0:
                total_tk = input_tk + output_tk
            if total_tk > 0:
                total_tokens += total_tk

        assert total_tokens == 120

    def test_extraction_with_no_usage_metadata(self):
        """Messages without usage_metadata are skipped."""
        ai_messages = [
            {"content": "Hello"},
            {"content": "World", "additional_kwargs": {}},
        ]
        total_tokens = 0
        for msg_dict in ai_messages:
            usage = msg_dict.get("usage_metadata") or msg_dict.get("additional_kwargs", {}).get("usage_metadata")
            if not usage:
                continue
            total_tokens += usage.get("total_tokens", 0)

        assert total_tokens == 0


# ── Test: _find_run_journal ──────────────────────────────────────────────────


class TestFindRunJournal:
    """Verify _find_run_journal can locate RunJournal from different sources."""

    def test_find_journal_in_dict_config(self):
        journal = _make_journal()
        config = {"callbacks": [journal], "configurable": {}}
        found = _find_run_journal(config)
        assert found is journal

    def test_find_journal_in_mock_config(self):
        journal = _make_journal()
        runtime = _make_runtime_with_callbacks([journal])
        found = _find_run_journal(runtime.config)
        assert found is journal

    def test_no_journal_returns_none(self):
        config = {"callbacks": [], "configurable": {}}
        found = _find_run_journal(config)
        assert found is None

    def test_none_config_returns_none(self):
        found = _find_run_journal(None)
        assert found is None

    def test_other_callbacks_are_ignored(self):
        other_cb = MagicMock()
        config = {"callbacks": [other_cb], "configurable": {}}
        found = _find_run_journal(config)
        assert found is None

    def test_journal_among_other_callbacks(self):
        journal = _make_journal()
        other_cb = MagicMock()
        config = {"callbacks": [other_cb, journal], "configurable": {}}
        found = _find_run_journal(config)
        assert found is journal

    def test_config_with_getattr_fallback(self):
        """Test when config_source is an object with .callbacks attribute."""
        journal = _make_journal()
        config_obj = SimpleNamespace(callbacks=[journal])
        found = _find_run_journal(config_obj)
        assert found is journal


# ── Test: _report_subagent_tokens ────────────────────────────────────────────


class TestReportSubagentTokens:
    """Verify the full reporting pipeline: runtime → journal.record_subagent_tokens."""

    def test_report_updates_journal(self):
        journal = _make_journal()
        runtime = _make_runtime_with_callbacks([journal])
        result = _make_subagent_result()

        _report_subagent_tokens(runtime, "test-subagent", result)

        assert journal._subagent_tokens == 500
        assert journal._total_tokens >= 500
        assert journal._total_input_tokens >= 300
        assert journal._total_output_tokens >= 200
        assert journal._llm_call_count >= 2

    def test_report_with_zero_tokens_is_noop(self):
        journal = _make_journal()
        runtime = _make_runtime_with_callbacks([journal])
        result = _make_subagent_result(total_tokens=0, total_input_tokens=0, total_output_tokens=0, llm_call_count=0)

        _report_subagent_tokens(runtime, "test-subagent", result)

        assert journal._subagent_tokens == 0

    def test_report_without_journal_logs_warning(self, caplog):
        import logging
        runtime = MagicMock()
        runtime.config = {"callbacks": [], "configurable": {}}
        result = _make_subagent_result()

        with caplog.at_level(logging.WARNING, logger="kkoclaw.tools.builtins.task_tool"):
            _report_subagent_tokens(runtime, "test-subagent", result)

        assert "No RunJournal found" in caplog.text

    def test_multiple_reports_accumulate(self):
        journal = _make_journal()
        runtime = _make_runtime_with_callbacks([journal])

        result1 = _make_subagent_result(total_tokens=500, total_input_tokens=300, total_output_tokens=200, llm_call_count=2)
        result2 = _make_subagent_result(total_tokens=1000, total_input_tokens=600, total_output_tokens=400, llm_call_count=3)

        _report_subagent_tokens(runtime, "sub1", result1)
        _report_subagent_tokens(runtime, "sub2", result2)

        assert journal._subagent_tokens == 1500
        assert journal._total_tokens >= 1500
        assert journal._total_input_tokens >= 900
        assert journal._total_output_tokens >= 600
        assert journal._llm_call_count >= 5


# ── Test: RunJournal.record_subagent_tokens ──────────────────────────────────


class TestRunJournalRecordSubagentTokens:
    """Directly test the RunJournal.record_subagent_tokens method."""

    def test_record_positive_tokens(self):
        journal = _make_journal()
        journal.record_subagent_tokens(
            "my-subagent",
            total_tokens=1000,
            total_input_tokens=600,
            total_output_tokens=400,
            llm_call_count=3,
        )
        assert journal._subagent_tokens == 1000
        assert journal._total_tokens >= 1000
        assert journal._total_input_tokens >= 600
        assert journal._total_output_tokens >= 400
        assert journal._llm_call_count >= 3

    def test_record_zero_tokens_is_noop(self):
        journal = _make_journal()
        initial_tokens = journal._total_tokens
        journal.record_subagent_tokens(
            "my-subagent",
            total_tokens=0,
        )
        assert journal._total_tokens == initial_tokens
        assert journal._subagent_tokens == 0

    def test_record_negative_tokens_is_noop(self):
        journal = _make_journal()
        initial_tokens = journal._total_tokens
        journal.record_subagent_tokens(
            "my-subagent",
            total_tokens=-100,
        )
        assert journal._total_tokens == initial_tokens

    def test_multiple_records_accumulate(self):
        journal = _make_journal()
        journal.record_subagent_tokens("sub1", total_tokens=500, total_input_tokens=300, total_output_tokens=200, llm_call_count=2)
        journal.record_subagent_tokens("sub2", total_tokens=1000, total_input_tokens=600, total_output_tokens=400, llm_call_count=3)
        assert journal._subagent_tokens == 1500
        assert journal._total_input_tokens == 900
        assert journal._total_output_tokens == 600

"""Tests for the Token Economy system (middleware, storm breaker, volatility detector).

Covers:
- Historical tool-result truncation (head+tail, protected segments preserved).
- Concise response instruction injection.
- Storm Breaker: duplicate suppression, mutating-tool reset, turn reset.
- Prefix Volatility: UUID/ISO8601/hash/JWT detection.
- Disabled config = no changes.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from kkoclaw.agents.middlewares.token_economy_middleware import (
    TOKEN_ECONOMY_INSTRUCTION,
    TokenEconomyMiddleware,
    _truncate_head_tail,
    _with_protected_segments,
)
from kkoclaw.agents.middlewares.tool_storm_breaker import ToolStormBreaker
from kkoclaw.agents.middlewares.prefix_volatility import (
    detect_volatile_tokens_in_text,
)
from kkoclaw.config.token_economy_config import TokenEconomyConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tool_message(
    content: str,
    tool_name: str = "bash",
    tool_call_id: str = "call_1",
) -> ToolMessage:
    return ToolMessage(content=content, name=tool_name, tool_call_id=tool_call_id)


def _make_config(**overrides) -> TokenEconomyConfig:
    defaults = {"enabled": True}
    defaults.update(overrides)
    return TokenEconomyConfig(**defaults)


class _FakeModelRequest:
    """Minimal stand-in for ModelRequest to test wrap_model_call."""

    def __init__(self, messages):
        self.messages = messages

    def override(self, *, messages):
        return _FakeModelRequest(messages)


class _FakeHandler:
    """Records the request and returns a canned response."""

    def __init__(self):
        self.last_request = None

    def __call__(self, request):
        self.last_request = request
        return "model_response"


# ---------------------------------------------------------------------------
# TokenEconomyMiddleware: historical tool-result compression
# ---------------------------------------------------------------------------


class TestHistoryCompression:
    def test_old_tool_message_is_truncated(self):
        """ToolMessage beyond recent N should be compressed."""
        long_content = "A" * 5000
        config = _make_config(
            max_history_tool_result_chars=200,
            recent_tool_result_count=2,
            concise_responses=False,  # isolate compression logic
        )
        mw = TokenEconomyMiddleware(config=config)

        messages = [
            _make_tool_message(long_content, "bash", "old_1"),  # old → compress
            _make_tool_message(long_content, "bash", "old_2"),  # old → compress
            _make_tool_message(long_content, "bash", "new_1"),  # recent → skip
            _make_tool_message(long_content, "bash", "new_2"),  # recent → skip
            HumanMessage(content="Latest question"),
        ]

        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        processed = handler.last_request.messages
        # Old messages should be shorter than original
        assert len(processed[0].content) < 5000
        assert "chars omitted" in processed[0].content
        assert len(processed[1].content) < 5000
        # Recent messages should be unchanged
        assert len(processed[2].content) == 5000
        assert len(processed[3].content) == 5000

    def test_short_tool_message_not_compressed(self):
        """ToolMessage under threshold should not be touched."""
        config = _make_config(
            max_history_tool_result_chars=2000,
            concise_responses=False,  # isolate compression logic
        )
        mw = TokenEconomyMiddleware(config=config)

        short_content = "short output"
        messages = [
            _make_tool_message(short_content, "bash", "call_1"),
            HumanMessage(content="Question"),
        ]

        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        assert handler.last_request.messages[0].content == short_content

    def test_protected_segments_preserved(self):
        """Code blocks and URLs inside compressed text must survive."""
        code_block = "```python\nprint('hello world')\n```"
        url = "https://example.com/api/v1"
        filler = "X" * 3000
        content = f"{code_block}\n{url}\n{filler}"

        config = _make_config(
            max_history_tool_result_chars=500,
            recent_tool_result_count=0,
            concise_responses=False,  # isolate compression logic
        )
        mw = TokenEconomyMiddleware(config=config)

        messages = [_make_tool_message(content), HumanMessage(content="Q")]
        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        compressed = handler.last_request.messages[0].content
        assert code_block in compressed, "Code block must be preserved"
        assert url in compressed, "URL must be preserved"

    def test_signal_lines_preserved(self):
        """Lines with error/warning keywords in the omitted region are kept."""
        head = "HEAD_DATA\n"
        error_line = "FATAL ERROR: something went wrong"
        filler = "Y" * 3000
        tail = "TAIL_DATA"
        content = head + error_line + "\n" + filler + "\n" + tail

        config = _make_config(
            max_history_tool_result_chars=300,
            recent_tool_result_count=0,
            concise_responses=False,  # isolate compression logic
        )
        mw = TokenEconomyMiddleware(config=config)

        messages = [_make_tool_message(content), HumanMessage(content="Q")]
        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        compressed = handler.last_request.messages[0].content
        assert error_line in compressed, "Signal line must be preserved"


# ---------------------------------------------------------------------------
# TokenEconomyMiddleware: concise response instruction
# ---------------------------------------------------------------------------


class TestConciseInstruction:
    def test_instruction_injected(self):
        """When enabled, the concise instruction is prepended."""
        config = _make_config(compress_history_tool_results=False)
        mw = TokenEconomyMiddleware(config=config)

        messages = [HumanMessage(content="Hello")]
        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        processed = handler.last_request.messages
        assert len(processed) == 2  # instruction + original
        assert "Token economy mode is enabled" in processed[0].content

    def test_instruction_not_double_injected(self):
        """If the first message already has the instruction, don't add again."""
        config = _make_config(compress_history_tool_results=False)
        mw = TokenEconomyMiddleware(config=config)

        messages = [
            HumanMessage(content=f"<system-reminder>\n{TOKEN_ECONOMY_INSTRUCTION}\n</system-reminder>"),
            HumanMessage(content="Follow-up"),
        ]
        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        processed = handler.last_request.messages
        assert len(processed) == 2  # unchanged


# ---------------------------------------------------------------------------
# TokenEconomyMiddleware: disabled state
# ---------------------------------------------------------------------------


class TestDisabledMiddleware:
    def test_disabled_middleware_no_change(self):
        """When enabled=False, messages pass through unchanged."""
        config = TokenEconomyConfig(enabled=False)
        mw = TokenEconomyMiddleware(config=config)

        messages = [
            _make_tool_message("X" * 5000, "bash", "old"),
            HumanMessage(content="Q"),
        ]
        handler = _FakeHandler()
        result = mw.wrap_model_call(_FakeModelRequest(messages), handler)

        # Handler is called directly, no message modification
        assert handler.last_request.messages is messages


# ---------------------------------------------------------------------------
# ToolStormBreaker
# ---------------------------------------------------------------------------


class TestToolStormBreaker:
    def test_allows_first_call(self):
        sb = ToolStormBreaker(threshold=3, window_size=8)
        result = sb.inspect("read_file", {"path": "/tmp/test.py"})
        assert not result.suppress

    def test_suppresses_duplicate_after_threshold(self):
        sb = ToolStormBreaker(threshold=2, window_size=8)
        # First call: allowed
        r1 = sb.inspect("read_file", {"path": "/tmp/test.py"})
        assert not r1.suppress
        # Second call with same args: suppressed (threshold=2, count >= threshold-1=1)
        r2 = sb.inspect("read_file", {"path": "/tmp/test.py"})
        assert r2.suppress
        assert "read_file" in (r2.reason or "")

    def test_different_args_not_suppressed(self):
        sb = ToolStormBreaker(threshold=2, window_size=8)
        sb.inspect("read_file", {"path": "/tmp/a.py"})
        r2 = sb.inspect("read_file", {"path": "/tmp/b.py"})
        assert not r2.suppress

    def test_mutating_tool_clears_readonly(self):
        """A write_file call should clear read-only entries, allowing subsequent reads."""
        sb = ToolStormBreaker(threshold=2, window_size=8)
        sb.inspect("read_file", {"path": "/tmp/test.py"})
        # Mutating call clears read-only history
        sb.inspect("write_file", {"path": "/tmp/test.py", "content": "data"})
        # Same read should now be allowed again
        r = sb.inspect("read_file", {"path": "/tmp/test.py"})
        assert not r.suppress

    def test_exempt_tools_not_suppressed(self):
        """User input tools should never be suppressed."""
        sb = ToolStormBreaker(threshold=2, window_size=8)
        sb.inspect("request_user_input", {"prompt": "name"})
        r2 = sb.inspect("request_user_input", {"prompt": "name"})
        assert not r2.suppress

    def test_turn_reset(self):
        """After reset_turn, identical calls are allowed again."""
        sb = ToolStormBreaker(threshold=2, window_size=8)
        sb.inspect("read_file", {"path": "/tmp/test.py"})
        sb.reset_turn()
        r = sb.inspect("read_file", {"path": "/tmp/test.py"})
        assert not r.suppress

    def test_args_order_independence(self):
        """Dict args with different key order should canonicalize the same."""
        sb = ToolStormBreaker(threshold=2, window_size=8)
        sb.inspect("read_file", {"path": "/tmp/a", "start_line": 1})
        # Different key order, same values
        r = sb.inspect("read_file", {"start_line": 1, "path": "/tmp/a"})
        assert r.suppress, "Canonicalized args should match regardless of key order"


# ---------------------------------------------------------------------------
# PrefixVolatility
# ---------------------------------------------------------------------------


class TestPrefixVolatility:
    def test_detects_uuid(self):
        findings = detect_volatile_tokens_in_text(
            "Session ID: 550e8400-e29b-41d4-a716-446655440000",
            field="systemPrompt",
        )
        uuids = [f for f in findings if f.kind == "uuid"]
        assert len(uuids) == 1
        assert uuids[0].token == "550e8400-e29b-41d4-a716-446655440000"

    def test_detects_iso8601(self):
        findings = detect_volatile_tokens_in_text(
            "Current date: 2026-06-13T10:30:00Z",
            field="systemPrompt",
        )
        dates = [f for f in findings if f.kind == "iso8601"]
        assert len(dates) >= 1

    def test_detects_hex_hash(self):
        # 32-char hex (MD5)
        findings = detect_volatile_tokens_in_text(
            "Cache key: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
            field="systemPrompt",
        )
        hashes = [f for f in findings if f.kind == "hex_hash"]
        assert len(hashes) == 1

    def test_does_not_flag_normal_text(self):
        findings = detect_volatile_tokens_in_text(
            "Hello world, this is a normal sentence.",
            field="systemPrompt",
        )
        assert len(findings) == 0

    def test_returns_field_name(self):
        findings = detect_volatile_tokens_in_text(
            "ID: 550e8400-e29b-41d4-a716-446655440000",
            field="fewShots",
            item_id="shot_1",
        )
        assert len(findings) == 1
        assert findings[0].field == "fewShots"
        assert findings[0].item_id == "shot_1"


# ---------------------------------------------------------------------------
# Protected segments helper
# ---------------------------------------------------------------------------


class TestProtectedSegments:
    def test_preserves_code_blocks(self):
        text = "```python\nx = 1\n```"
        result = _with_protected_segments(text, lambda t: t.upper())
        assert "```python\nx = 1\n```" in result

    def test_preserves_urls(self):
        text = "Visit https://example.com/page for details."
        result = _with_protected_segments(text, lambda t: t.replace("Visit ", "").replace(" for details.", ""))
        assert "https://example.com/page" in result

    def test_preserves_version_numbers(self):
        text = "Version 1.2.3 is required."
        result = _with_protected_segments(text, lambda t: t.upper())
        assert "1.2.3" in result


# ---------------------------------------------------------------------------
# Truncation helper
# ---------------------------------------------------------------------------


class TestTruncateHeadTail:
    def test_short_text_unchanged(self):
        assert _truncate_head_tail("short", 100) == "short"

    def test_long_text_truncated(self):
        text = "A" * 1000
        result = _truncate_head_tail(text, 200)
        assert len(result) < 1000
        assert "chars omitted" in result

    def test_zero_max_chars_returns_original(self):
        text = "A" * 100
        assert _truncate_head_tail(text, 0) == text


# ---------------------------------------------------------------------------
# Integration: wrap_model_call
# ---------------------------------------------------------------------------


class TestWrapModelCallIntegration:
    def test_full_pipeline_compression_and_instruction(self):
        """Both instruction injection and compression should work together."""
        config = _make_config(
            max_history_tool_result_chars=200,
            recent_tool_result_count=1,
        )
        mw = TokenEconomyMiddleware(config=config)

        messages = [
            _make_tool_message("X" * 1000, "bash", "old"),
            _make_tool_message("Y" * 500, "bash", "recent"),
            HumanMessage(content="What happened?"),
        ]

        handler = _FakeHandler()
        mw.wrap_model_call(_FakeModelRequest(messages), handler)

        processed = handler.last_request.messages
        # First message: instruction injected
        assert "Token economy mode is enabled" in processed[0].content
        # Second message: old tool message compressed
        assert len(processed[1].content) < 1000
        # Third message: recent tool message unchanged
        assert processed[2].content == "Y" * 500
        # Fourth message: original human message
        assert processed[3].content == "What happened?"

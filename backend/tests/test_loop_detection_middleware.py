"""Tests for LoopDetectionMiddleware."""

import copy
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from kkoclaw.agents.middlewares.loop_detection_middleware import (
    _HARD_STOP_MSG,
    LoopDetectionMiddleware,
    _hash_tool_calls,
)


def _make_runtime(thread_id="test-thread"):
    """Build a minimal Runtime mock with context."""
    runtime = MagicMock()
    runtime.context = {"thread_id": thread_id}
    return runtime


def _make_state(tool_calls=None, content=""):
    """Build a minimal AgentState dict with an AIMessage.

    Deep-copies *content* when it is mutable (e.g. list) so that
    successive calls never share the same object reference.
    """
    safe_content = copy.deepcopy(content) if isinstance(content, list) else content
    msg = AIMessage(content=safe_content, tool_calls=tool_calls or [])
    return {"messages": [msg]}


def _bash_call(cmd="ls"):
    return {"name": "bash", "id": f"call_{cmd}", "args": {"command": cmd}}


class TestHashToolCalls:
    def test_same_calls_same_hash(self):
        a = _hash_tool_calls([_bash_call("ls")])
        b = _hash_tool_calls([_bash_call("ls")])
        assert a == b

    def test_different_calls_different_hash(self):
        a = _hash_tool_calls([_bash_call("ls")])
        b = _hash_tool_calls([_bash_call("pwd")])
        assert a != b

    def test_order_independent(self):
        a = _hash_tool_calls([_bash_call("ls"), {"name": "read_file", "args": {"path": "/tmp"}}])
        b = _hash_tool_calls([{"name": "read_file", "args": {"path": "/tmp"}}, _bash_call("ls")])
        assert a == b

    def test_empty_calls(self):
        h = _hash_tool_calls([])
        assert isinstance(h, str)
        assert len(h) > 0

    def test_stringified_dict_args_match_dict_args(self):
        dict_call = {
            "name": "read_file",
            "args": {"path": "/tmp/demo.py", "start_line": "1", "end_line": "150"},
        }
        string_call = {
            "name": "read_file",
            "args": '{"path":"/tmp/demo.py","start_line":"1","end_line":"150"}',
        }

        assert _hash_tool_calls([dict_call]) == _hash_tool_calls([string_call])

    def test_reversed_read_file_range_matches_forward_range(self):
        forward_call = {
            "name": "read_file",
            "args": {"path": "/tmp/demo.py", "start_line": 10, "end_line": 300},
        }
        reversed_call = {
            "name": "read_file",
            "args": {"path": "/tmp/demo.py", "start_line": 300, "end_line": 10},
        }

        assert _hash_tool_calls([forward_call]) == _hash_tool_calls([reversed_call])

    def test_stringified_non_dict_args_do_not_crash(self):
        non_dict_json_call = {"name": "bash", "args": '"echo hello"'}
        plain_string_call = {"name": "bash", "args": "echo hello"}

        json_hash = _hash_tool_calls([non_dict_json_call])
        plain_hash = _hash_tool_calls([plain_string_call])

        assert isinstance(json_hash, str)
        assert isinstance(plain_hash, str)
        assert json_hash
        assert plain_hash

    def test_grep_pattern_affects_hash(self):
        grep_foo = {"name": "grep", "args": {"path": "/tmp", "pattern": "foo"}}
        grep_bar = {"name": "grep", "args": {"path": "/tmp", "pattern": "bar"}}

        assert _hash_tool_calls([grep_foo]) != _hash_tool_calls([grep_bar])

    def test_glob_pattern_affects_hash(self):
        glob_py = {"name": "glob", "args": {"path": "/tmp", "pattern": "*.py"}}
        glob_ts = {"name": "glob", "args": {"path": "/tmp", "pattern": "*.ts"}}

        assert _hash_tool_calls([glob_py]) != _hash_tool_calls([glob_ts])

    def test_write_file_content_affects_hash(self):
        v1 = {"name": "write_file", "args": {"path": "/tmp/a.py", "content": "v1"}}
        v2 = {"name": "write_file", "args": {"path": "/tmp/a.py", "content": "v2"}}
        assert _hash_tool_calls([v1]) != _hash_tool_calls([v2])

    def test_str_replace_content_affects_hash(self):
        a = {
            "name": "str_replace",
            "args": {"path": "/tmp/a.py", "old_str": "foo", "new_str": "bar"},
        }
        b = {
            "name": "str_replace",
            "args": {"path": "/tmp/a.py", "old_str": "foo", "new_str": "baz"},
        }
        assert _hash_tool_calls([a]) != _hash_tool_calls([b])


class TestLoopDetection:
    def test_no_tool_calls_returns_none(self):
        mw = LoopDetectionMiddleware()
        runtime = _make_runtime()
        state = {"messages": [AIMessage(content="hello")]}
        result = mw._apply(state, runtime)
        assert result is None

    def test_below_threshold_returns_none(self):
        mw = LoopDetectionMiddleware(warn_threshold=3)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        # First two identical calls — no warning
        for _ in range(2):
            result = mw._apply(_make_state(tool_calls=call), runtime)
            assert result is None

    def test_warn_at_threshold(self):
        mw = LoopDetectionMiddleware(warn_threshold=3, hard_limit=5)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        for _ in range(2):
            mw._apply(_make_state(tool_calls=call), runtime)

        # Third identical call triggers warning
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        msgs = result["messages"]
        assert len(msgs) == 1
        assert isinstance(msgs[0], AIMessage)
        assert "LOOP DETECTED" in msgs[0].content

    def test_warn_only_injected_once(self):
        """Warning for the same hash should only be injected once per thread."""
        mw = LoopDetectionMiddleware(warn_threshold=3, hard_limit=10)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        # First two — no warning
        for _ in range(2):
            mw._apply(_make_state(tool_calls=call), runtime)

        # Third — warning injected
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

        # Fourth — warning already injected, should return None
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None

    def test_hard_stop_at_limit(self):
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=4)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        for _ in range(3):
            mw._apply(_make_state(tool_calls=call), runtime)

        # Fourth call triggers hard stop
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        msgs = result["messages"]
        assert len(msgs) == 1
        # Hard stop strips tool_calls
        assert isinstance(msgs[0], AIMessage)
        assert msgs[0].tool_calls == []
        assert _HARD_STOP_MSG in msgs[0].content

    def test_different_calls_dont_trigger(self):
        mw = LoopDetectionMiddleware(warn_threshold=2)
        runtime = _make_runtime()

        # Each call is different
        for i in range(10):
            result = mw._apply(_make_state(tool_calls=[_bash_call(f"cmd_{i}")]), runtime)
            assert result is None

    def test_window_sliding(self):
        mw = LoopDetectionMiddleware(warn_threshold=3, window_size=5)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        # Fill with 2 identical calls
        mw._apply(_make_state(tool_calls=call), runtime)
        mw._apply(_make_state(tool_calls=call), runtime)

        # Push them out of the window with different calls
        for i in range(5):
            mw._apply(_make_state(tool_calls=[_bash_call(f"other_{i}")]), runtime)

        # Now the original call should be fresh again — no warning
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None

    def test_reset_clears_state(self):
        mw = LoopDetectionMiddleware(warn_threshold=2)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        mw._apply(_make_state(tool_calls=call), runtime)
        mw._apply(_make_state(tool_calls=call), runtime)

        # Would trigger warning, but reset first
        mw.reset()
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None

    def test_non_ai_message_ignored(self):
        mw = LoopDetectionMiddleware()
        runtime = _make_runtime()
        state = {"messages": [SystemMessage(content="hello")]}
        result = mw._apply(state, runtime)
        assert result is None

    def test_empty_messages_ignored(self):
        mw = LoopDetectionMiddleware()
        runtime = _make_runtime()
        result = mw._apply({"messages": []}, runtime)
        assert result is None

    def test_thread_id_from_runtime_context(self):
        """Thread ID should come from runtime.context, not state."""
        mw = LoopDetectionMiddleware(warn_threshold=2)
        runtime_a = _make_runtime("thread-A")
        runtime_b = _make_runtime("thread-B")
        call = [_bash_call("ls")]

        # One call on thread A
        mw._apply(_make_state(tool_calls=call), runtime_a)
        # One call on thread B
        mw._apply(_make_state(tool_calls=call), runtime_b)

        # Second call on thread A — triggers warning (2 >= warn_threshold)
        result = mw._apply(_make_state(tool_calls=call), runtime_a)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

        # Second call on thread B — also triggers (independent tracking)
        result = mw._apply(_make_state(tool_calls=call), runtime_b)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

    def test_lru_eviction(self):
        """Old threads should be evicted when max_tracked_threads is exceeded."""
        mw = LoopDetectionMiddleware(warn_threshold=2, max_tracked_threads=3)
        call = [_bash_call("ls")]

        # Fill up 3 threads
        for i in range(3):
            runtime = _make_runtime(f"thread-{i}")
            mw._apply(_make_state(tool_calls=call), runtime)

        # Add a 4th thread — should evict thread-0
        runtime_new = _make_runtime("thread-new")
        mw._apply(_make_state(tool_calls=call), runtime_new)

        assert "thread-0" not in mw._history
        assert "thread-0" not in mw._tool_freq
        assert "thread-0" not in mw._tool_freq_warned
        assert "thread-new" in mw._history
        assert len(mw._history) == 3

    def test_thread_safe_mutations(self):
        """Verify lock is used for mutations (basic structural test)."""
        mw = LoopDetectionMiddleware()
        # The middleware should have a lock attribute
        assert hasattr(mw, "_lock")
        assert isinstance(mw._lock, type(mw._lock))

    def test_fallback_thread_id_when_missing(self):
        """When runtime context has no thread_id, should use 'default'."""
        mw = LoopDetectionMiddleware(warn_threshold=2)
        runtime = MagicMock()
        runtime.context = {}
        call = [_bash_call("ls")]

        mw._apply(_make_state(tool_calls=call), runtime)
        assert "default" in mw._history

    def test_no_double_kill_after_hard_stop(self):
        """After a hard stop, tracking state is cleared so the next response
        does NOT immediately trigger another hard stop (regression for double
        hard stop in 2 seconds seen in production logs)."""
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=3)
        runtime = _make_runtime()
        call = [_bash_call("python3 gen_report.py")]

        # Build up to hard stop
        for _ in range(2):
            mw._apply(_make_state(tool_calls=call), runtime)
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        assert "FORCED STOP" in result["messages"][0].content
        assert result["messages"][0].tool_calls == []

        # Verify tracking state was cleared by the hard stop
        thread_id = "test-thread"
        assert thread_id not in mw._history
        assert thread_id not in mw._warned
        assert thread_id not in mw._tool_freq
        assert thread_id not in mw._error_rounds

        # Simulate the model responding with a new call after hard stop.
        # Without the state clear, this would immediately trigger another
        # hard stop because the hash history still contained the old pattern.
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None, (
            "Expected no hard stop after state clear — the model should get "
            "a clean slate"
        )


class TestAppendText:
    """Unit tests for LoopDetectionMiddleware._append_text."""

    def test_none_content_returns_text(self):
        result = LoopDetectionMiddleware._append_text(None, "hello")
        assert result == "hello"

    def test_str_content_concatenates(self):
        result = LoopDetectionMiddleware._append_text("existing", "appended")
        assert result == "existing\n\nappended"

    def test_empty_str_content_concatenates(self):
        result = LoopDetectionMiddleware._append_text("", "appended")
        assert result == "\n\nappended"

    def test_list_content_appends_text_block(self):
        """List content (e.g. Anthropic thinking mode) should get a new text block."""
        content = [
            {"type": "thinking", "text": "Let me think..."},
            {"type": "text", "text": "Here is my answer"},
        ]
        result = LoopDetectionMiddleware._append_text(content, "stop msg")
        assert isinstance(result, list)
        assert len(result) == 3
        assert result[0] == content[0]
        assert result[1] == content[1]
        assert result[2] == {"type": "text", "text": "\n\nstop msg"}

    def test_empty_list_content_appends_text_block(self):
        result = LoopDetectionMiddleware._append_text([], "stop msg")
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0] == {"type": "text", "text": "\n\nstop msg"}

    def test_unexpected_type_coerced_to_str(self):
        """Unexpected content types should be coerced to str as a fallback."""
        result = LoopDetectionMiddleware._append_text(42, "stop msg")
        assert isinstance(result, str)
        assert result == "42\n\nstop msg"

    def test_list_content_not_mutated_in_place(self):
        """_append_text must not modify the original list."""
        original = [{"type": "text", "text": "hello"}]
        result = LoopDetectionMiddleware._append_text(original, "appended")
        assert len(original) == 1  # original unchanged
        assert len(result) == 2  # new list has the appended block


class TestHardStopWithListContent:
    """Regression tests: hard stop must not crash when AIMessage.content is a list."""

    def test_hard_stop_with_list_content(self):
        """Hard stop on list content should not raise TypeError (regression)."""
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=4)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        # Build state with list content (e.g. Anthropic thinking mode)
        list_content = [
            {"type": "thinking", "text": "Let me think..."},
            {"type": "text", "text": "I'll run ls"},
        ]

        for _ in range(3):
            mw._apply(_make_state(tool_calls=call, content=list_content), runtime)

        # Fourth call triggers hard stop — must not raise TypeError
        result = mw._apply(_make_state(tool_calls=call, content=list_content), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg, AIMessage)
        assert msg.tool_calls == []
        # Content should remain a list with the stop message appended
        assert isinstance(msg.content, list)
        assert len(msg.content) == 3
        assert msg.content[2]["type"] == "text"
        assert _HARD_STOP_MSG in msg.content[2]["text"]

    def test_hard_stop_with_none_content(self):
        """Hard stop on None content should produce a plain string."""
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=4)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        for _ in range(3):
            mw._apply(_make_state(tool_calls=call), runtime)

        # Fourth call with default empty-string content
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg.content, str)
        assert _HARD_STOP_MSG in msg.content

    def test_hard_stop_with_str_content(self):
        """Hard stop on str content should concatenate the stop message."""
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=4)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        for _ in range(3):
            mw._apply(_make_state(tool_calls=call, content="thinking..."), runtime)

        result = mw._apply(_make_state(tool_calls=call, content="thinking..."), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg.content, str)
        assert msg.content.startswith("thinking...")
        assert _HARD_STOP_MSG in msg.content

    def test_hard_stop_clears_raw_tool_call_metadata(self):
        """Forced-stop messages must not retain provider-level raw tool-call payloads."""
        mw = LoopDetectionMiddleware(warn_threshold=2, hard_limit=4)
        runtime = _make_runtime()
        call = [_bash_call("ls")]

        def _make_provider_state():
            return {
                "messages": [
                    AIMessage(
                        content="thinking...",
                        tool_calls=call,
                        additional_kwargs={
                            "tool_calls": [
                                {
                                    "id": "call_ls",
                                    "type": "function",
                                    "function": {"name": "bash", "arguments": '{"command":"ls"}'},
                                    "thought_signature": "sig-1",
                                }
                            ],
                            "function_call": {"name": "bash", "arguments": '{"command":"ls"}'},
                        },
                        response_metadata={"finish_reason": "tool_calls"},
                    )
                ]
            }

        for _ in range(3):
            mw._apply(_make_provider_state(), runtime)

        result = mw._apply(_make_provider_state(), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert msg.tool_calls == []
        assert "tool_calls" not in msg.additional_kwargs
        assert "function_call" not in msg.additional_kwargs
        assert msg.response_metadata["finish_reason"] == "stop"


class TestToolFrequencyDetection:
    """Tests for per-tool-type frequency detection (Layer 2).

    This catches the case where an agent calls the same tool type many times
    with *different* arguments (e.g. read_file on 40 different files), which
    bypasses hash-based detection.
    """

    def _read_call(self, path):
        return {"name": "read_file", "id": f"call_read_{path}", "args": {"path": path}}

    def test_below_freq_warn_returns_none(self):
        mw = LoopDetectionMiddleware(tool_freq_warn=5, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        for i in range(4):
            result = mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)
            assert result is None

    def test_freq_warn_at_threshold(self):
        mw = LoopDetectionMiddleware(tool_freq_warn=5, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        for i in range(4):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)

        # 5th call to read_file (different file each time) triggers freq warning
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_4.py")]), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg, AIMessage)
        assert "read_file" in msg.content
        assert "LOOP DETECTED" in msg.content

    def test_freq_warn_only_injected_once(self):
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)

        # 3rd triggers warning
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_2.py")]), runtime)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

        # 4th should not re-warn (already warned for read_file)
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_3.py")]), runtime)
        assert result is None

    def test_freq_hard_stop_at_limit(self):
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=6)
        runtime = _make_runtime()

        for i in range(5):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)

        # 6th call triggers hard stop
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_5.py")]), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg, AIMessage)
        assert msg.tool_calls == []
        assert "FORCED STOP" in msg.content
        assert "read_file" in msg.content

    def test_different_tools_tracked_independently(self):
        """read_file and bash should have independent frequency counters."""
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        # 2 read_file calls
        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)

        # 2 bash calls — should not trigger (bash count = 2, read_file count = 2)
        for i in range(2):
            result = mw._apply(_make_state(tool_calls=[_bash_call(f"cmd_{i}")]), runtime)
            assert result is None

        # 3rd read_file triggers (read_file count = 3)
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_2.py")]), runtime)
        assert result is not None
        assert "read_file" in result["messages"][0].content

    def test_freq_reset_clears_state(self):
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime)

        mw.reset()

        # After reset, count restarts — should not trigger
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_new.py")]), runtime)
        assert result is None

    def test_freq_reset_per_thread_clears_only_target(self):
        """reset(thread_id=...) should clear frequency state for that thread only."""
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=10)
        runtime_a = _make_runtime("thread-A")
        runtime_b = _make_runtime("thread-B")

        # 2 calls on each thread
        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/a_{i}.py")]), runtime_a)
            mw._apply(_make_state(tool_calls=[self._read_call(f"/b_{i}.py")]), runtime_b)

        # Reset only thread-A
        mw.reset(thread_id="thread-A")

        assert "thread-A" not in mw._tool_freq
        assert "thread-A" not in mw._tool_freq_warned

        # thread-B state should still be intact — 3rd call triggers warn
        result = mw._apply(_make_state(tool_calls=[self._read_call("/b_2.py")]), runtime_b)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

        # thread-A restarted from 0 — should not trigger
        result = mw._apply(_make_state(tool_calls=[self._read_call("/a_new.py")]), runtime_a)
        assert result is None

    def test_freq_per_thread_isolation(self):
        """Frequency counts should be independent per thread."""
        mw = LoopDetectionMiddleware(tool_freq_warn=3, tool_freq_hard_limit=10)
        runtime_a = _make_runtime("thread-A")
        runtime_b = _make_runtime("thread-B")

        # 2 calls on thread A
        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/file_{i}.py")]), runtime_a)

        # 2 calls on thread B — should NOT push thread A over threshold
        for i in range(2):
            mw._apply(_make_state(tool_calls=[self._read_call(f"/other_{i}.py")]), runtime_b)

        # 3rd call on thread A — triggers (count=3 for thread A only)
        result = mw._apply(_make_state(tool_calls=[self._read_call("/file_2.py")]), runtime_a)
        assert result is not None
        assert "LOOP DETECTED" in result["messages"][0].content

    def test_multi_tool_single_response_counted(self):
        """When a single response has multiple tool calls, each is counted."""
        mw = LoopDetectionMiddleware(tool_freq_warn=5, tool_freq_hard_limit=10)
        runtime = _make_runtime()

        # Response 1: 2 read_file calls → count = 2
        call = [self._read_call("/a.py"), self._read_call("/b.py")]
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None

        # Response 2: 2 more → count = 4
        call = [self._read_call("/c.py"), self._read_call("/d.py")]
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is None

        # Response 3: 1 more → count = 5 → triggers warn
        result = mw._apply(_make_state(tool_calls=[self._read_call("/e.py")]), runtime)
        assert result is not None
        assert "read_file" in result["messages"][0].content

    def test_hash_detection_takes_priority(self):
        """Hash-based hard stop fires before frequency check for identical calls."""
        mw = LoopDetectionMiddleware(
            warn_threshold=2,
            hard_limit=3,
            tool_freq_warn=100,
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._read_call("/same_file.py")]

        for _ in range(2):
            mw._apply(_make_state(tool_calls=call), runtime)

        # 3rd identical call → hash hard_limit=3 fires (not freq)
        result = mw._apply(_make_state(tool_calls=call), runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg, AIMessage)
        assert _HARD_STOP_MSG in msg.content


class TestErrorConvergenceDetection:
    """Tests for Layer 3: error-based early convergence detection.

    When an agent persistently hits unrecoverable tool errors across
    multiple rounds, Layer 3 triggers forced stop before the general
    frequency limit would be reached.
    """

    def _skill_mgr_call(self):
        return {"name": "skill_manage", "id": "call_sm", "args": {"action": "create", "name": "test-skill", "content": "---\nname: test-skill\ndescription: test\n---"}}

    def _read_call(self, path):
        return {"name": "read_file", "id": f"call_{path}", "args": {"path": path}}

    def _error_state(self, tool_calls, error_content, prev_messages=None):
        """Build a state with error ToolMessages in history and an AIMessage with tool_calls."""
        msgs = list(prev_messages) if prev_messages else []
        from langchain_core.messages import ToolMessage

        msgs.append(
            ToolMessage(
                content=error_content,
                tool_call_id="prev-call",
                name="skill_manage",
                status="error",
            )
        )
        msgs.append(AIMessage(content="retrying...", tool_calls=tool_calls or []))
        return {"messages": msgs}

    def test_below_error_threshold_no_stop(self):
        """When error count is below threshold, no forced stop should occur."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=15,
            tool_freq_hard_limit=200,  # ensure Layer 2 doesn't fire first
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        # Build state with 3 unrecoverable errors (below threshold of 8)
        from langchain_core.messages import ToolMessage

        prev = []
        for _ in range(3):
            prev.append(
                ToolMessage(
                    content="Custom skill 'test-skill' already exists.",
                    tool_call_id="prev",
                    name="skill_manage",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        result = mw._apply(state, runtime)
        assert result is None

    def test_error_threshold_triggers_forced_stop(self):
        """When unrecoverable errors reach threshold, forced stop triggers."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=15,
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        # Build state with 8 unrecoverable errors (reaches threshold)
        from langchain_core.messages import ToolMessage

        prev = []
        for _ in range(8):
            prev.append(
                ToolMessage(
                    content="Custom skill 'test-skill' already exists.",
                    tool_call_id="prev",
                    name="skill_manage",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        result = mw._apply(state, runtime)
        assert result is not None
        msg = result["messages"][0]
        assert isinstance(msg, AIMessage)
        assert msg.tool_calls == []
        assert "FORCED STOP" in msg.content
        assert "Persistent unrecoverable errors" in msg.content

    def test_normal_errors_not_counted(self):
        """Normal (recoverable) errors should NOT count toward Layer 3 threshold."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=15,
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        from langchain_core.messages import ToolMessage

        # Build state with 10 normal errors (network timeout, etc.)
        prev = []
        for _ in range(10):
            prev.append(
                ToolMessage(
                    content="Error: Tool 'web_search' failed with ConnectTimeout: network down",
                    tool_call_id="prev",
                    name="web_search",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        result = mw._apply(state, runtime)
        assert result is None  # Should NOT trigger — errors are recoverable

    def test_mixed_errors_only_count_unrecoverable(self):
        """Only unrecoverable errors count; normal errors are ignored."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=15,
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        from langchain_core.messages import ToolMessage

        prev = []
        # 7 unrecoverable errors + 3 normal errors = 10 total, but only 7 count
        for _ in range(7):
            prev.append(
                ToolMessage(
                    content="Security scan rejected executable content: unsafe",
                    tool_call_id="prev",
                    name="skill_manage",
                    status="error",
                )
            )
        for _ in range(3):
            prev.append(
                ToolMessage(
                    content="Error: network timeout",
                    tool_call_id="prev2",
                    name="web_search",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        # 7 < 8 → no forced stop
        result = mw._apply(state, runtime)
        assert result is None

    def test_error_rounds_sliding_window(self):
        """Only errors within the window count; older ones are ignored."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=5,  # small window
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        from langchain_core.messages import ToolMessage

        prev = []
        # 10 unrecoverable errors, but only the last 5 are in the window
        for _ in range(10):
            prev.append(
                ToolMessage(
                    content="Supporting files must live under one of: assets, references",
                    tool_call_id="prev",
                    name="skill_manage",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        # Only 5 errors in window, threshold is 8 → no stop
        result = mw._apply(state, runtime)
        assert result is None

    def test_error_convergence_reset(self):
        """reset() should clear error round tracking."""
        mw = LoopDetectionMiddleware(
            error_round_threshold=8,
            error_round_window=15,
            tool_freq_hard_limit=200,
        )
        runtime = _make_runtime()
        call = [self._skill_mgr_call()]

        from langchain_core.messages import ToolMessage

        # Build up 6 errors
        prev = []
        for _ in range(6):
            prev.append(
                ToolMessage(
                    content="Custom skill 'test' already exists.",
                    tool_call_id="prev",
                    name="skill_manage",
                    status="error",
                )
            )
        prev.append(AIMessage(content="retrying...", tool_calls=call))
        state = {"messages": prev}

        mw._apply(state, runtime)
        assert mw._error_rounds["test-thread"] == 6

        # Reset
        mw.reset()
        assert "test-thread" not in mw._error_rounds

    def test_error_convergence_per_thread_isolation(self):
        """Error tracking should be per-thread, not shared."""
        mw = LoopDetectionMiddleware(
            warn_threshold=10,  # suppress hash-based detection
            error_round_threshold=3,
            error_round_window=10,
            tool_freq_hard_limit=200,
        )
        runtime_a = _make_runtime("thread-A")
        runtime_b = _make_runtime("thread-B")
        call = [self._skill_mgr_call()]

        from langchain_core.messages import ToolMessage

        def _make_err_turn():
            """Return one turn: ToolMessage (error) + AIMessage (retry)."""
            return [
                ToolMessage(
                    content="Security scan blocked the write",
                    tool_call_id=f"p{id(self)}",
                    name="skill_manage",
                    status="error",
                ),
                AIMessage(content="retrying...", tool_calls=call),
            ]

        # Accumulate messages across turns so _count_unrecoverable_error_rounds
        # sees the full history (mirrors real LangGraph state accumulation).
        messages_a: list = []

        # 3 error rounds on thread-A → triggers forced stop on round 3
        for turn_idx in range(3):
            messages_a.extend(_make_err_turn())
            state = {"messages": list(messages_a)}
            result = mw._apply(state, runtime_a)
            if turn_idx < 2:
                assert result is None, f"Expected None at turn {turn_idx}, got hard stop too early"
            else:
                assert result is not None, "Expected forced stop on turn 3"
                assert "FORCED STOP" in result["messages"][0].content

        # Thread B starts fresh — one error round should NOT trigger
        messages_b: list = []
        messages_b.extend(_make_err_turn())
        result_b = mw._apply({"messages": list(messages_b)}, runtime_b)
        assert result_b is None

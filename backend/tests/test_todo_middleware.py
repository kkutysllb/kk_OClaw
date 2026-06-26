"""Tests for TodoMiddleware context-loss detection."""

import asyncio
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage

from kkoclaw.agents.middlewares.todo_middleware import (
    TodoMiddleware,
    _completion_reminder_count,
    _format_todos,
    _is_user_facing_response,
    _reminder_in_messages,
    _todos_in_messages,
)


def _ai_with_write_todos():
    return AIMessage(content="", tool_calls=[{"name": "write_todos", "id": "tc_1", "args": {}}])


def _reminder_msg():
    return HumanMessage(name="todo_reminder", content="reminder")


def _make_runtime():
    runtime = MagicMock()
    runtime.context = {"thread_id": "test-thread"}
    return runtime


def _sample_todos():
    return [
        {"status": "completed", "content": "Set up project"},
        {"status": "in_progress", "content": "Write tests"},
        {"status": "pending", "content": "Deploy"},
    ]


class TestTodosInMessages:
    def test_true_when_write_todos_present(self):
        msgs = [HumanMessage(content="hi"), _ai_with_write_todos()]
        assert _todos_in_messages(msgs) is True

    def test_false_when_no_write_todos(self):
        msgs = [
            HumanMessage(content="hi"),
            AIMessage(content="hello", tool_calls=[{"name": "bash", "id": "tc_1", "args": {}}]),
        ]
        assert _todos_in_messages(msgs) is False

    def test_false_for_empty_list(self):
        assert _todos_in_messages([]) is False

    def test_false_for_ai_without_tool_calls(self):
        msgs = [AIMessage(content="hello")]
        assert _todos_in_messages(msgs) is False


class TestReminderInMessages:
    def test_true_when_reminder_present(self):
        msgs = [HumanMessage(content="hi"), _reminder_msg()]
        assert _reminder_in_messages(msgs) is True

    def test_false_when_no_reminder(self):
        msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert _reminder_in_messages(msgs) is False

    def test_false_for_empty_list(self):
        assert _reminder_in_messages([]) is False

    def test_false_for_human_without_name(self):
        msgs = [HumanMessage(content="todo_reminder")]
        assert _reminder_in_messages(msgs) is False


class TestFormatTodos:
    def test_formats_multiple_items(self):
        todos = _sample_todos()
        result = _format_todos(todos)
        assert "- [completed] Set up project" in result
        assert "- [in_progress] Write tests" in result
        assert "- [pending] Deploy" in result

    def test_empty_list(self):
        assert _format_todos([]) == ""

    def test_missing_fields_use_defaults(self):
        todos = [{"content": "No status"}, {"status": "done"}]
        result = _format_todos(todos)
        assert "- [pending] No status" in result
        assert "- [done] " in result


class TestBeforeModel:
    def test_returns_none_when_no_todos(self):
        mw = TodoMiddleware()
        state = {"messages": [HumanMessage(content="hi")], "todos": []}
        assert mw.before_model(state, _make_runtime()) is None

    def test_returns_none_when_todos_is_none(self):
        mw = TodoMiddleware()
        state = {"messages": [HumanMessage(content="hi")], "todos": None}
        assert mw.before_model(state, _make_runtime()) is None

    def test_returns_none_when_write_todos_still_visible(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_with_write_todos()],
            "todos": _sample_todos(),
        }
        assert mw.before_model(state, _make_runtime()) is None

    def test_returns_none_when_reminder_already_present(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi"), _reminder_msg()],
            "todos": _sample_todos(),
        }
        assert mw.before_model(state, _make_runtime()) is None

    def test_injects_reminder_when_todos_exist_but_truncated(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi"), AIMessage(content="sure")],
            "todos": _sample_todos(),
        }
        result = mw.before_model(state, _make_runtime())
        assert result is not None
        msgs = result["messages"]
        assert len(msgs) == 1
        assert isinstance(msgs[0], HumanMessage)
        assert msgs[0].name == "todo_reminder"
        assert msgs[0].additional_kwargs["hide_from_ui"] is True
        assert msgs[0].additional_kwargs["internal_middleware_message"] == "todo_reminder"

    def test_reminder_contains_formatted_todos(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi")],
            "todos": _sample_todos(),
        }
        result = mw.before_model(state, _make_runtime())
        content = result["messages"][0].content
        assert "Set up project" in content
        assert "Write tests" in content
        assert "Deploy" in content
        assert "system_reminder" in content


class TestAbeforeModel:
    def test_delegates_to_sync(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi")],
            "todos": _sample_todos(),
        }
        result = asyncio.run(mw.abefore_model(state, _make_runtime()))
        assert result is not None
        assert result["messages"][0].name == "todo_reminder"


def _completion_reminder_msg():
    return HumanMessage(name="todo_completion_reminder", content="finish your todos")


def _ai_no_tool_calls():
    return AIMessage(content="I'm done!")


def _incomplete_todos():
    return [
        {"status": "completed", "content": "Step 1"},
        {"status": "in_progress", "content": "Step 2"},
        {"status": "pending", "content": "Step 3"},
    ]


def _all_completed_todos():
    return [
        {"status": "completed", "content": "Step 1"},
        {"status": "completed", "content": "Step 2"},
    ]


class TestCompletionReminderCount:
    def test_zero_when_no_reminders(self):
        msgs = [HumanMessage(content="hi"), _ai_no_tool_calls()]
        assert _completion_reminder_count(msgs) == 0

    def test_counts_completion_reminders(self):
        msgs = [_completion_reminder_msg(), _completion_reminder_msg()]
        assert _completion_reminder_count(msgs) == 2

    def test_does_not_count_todo_reminders(self):
        msgs = [_reminder_msg(), _completion_reminder_msg()]
        assert _completion_reminder_count(msgs) == 1


class TestAfterModel:
    def test_returns_none_when_agent_still_using_tools(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_with_write_todos()],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_returns_none_when_no_todos(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": [],
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_returns_none_when_todos_is_none(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": None,
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_returns_none_when_all_completed(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": _all_completed_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_returns_none_when_no_messages(self):
        mw = TodoMiddleware()
        state = {
            "messages": [],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_injects_reminder_and_jumps_to_model_when_incomplete(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi"), _ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["jump_to"] == "model"
        assert len(result["messages"]) == 1
        reminder = result["messages"][0]
        assert isinstance(reminder, HumanMessage)
        assert reminder.name == "todo_completion_reminder"
        assert reminder.additional_kwargs["hide_from_ui"] is True
        assert reminder.additional_kwargs["internal_middleware_message"] == "todo_completion_reminder"
        assert "Step 2" in reminder.content
        assert "Step 3" in reminder.content

    def test_reminder_lists_only_incomplete_items(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        content = result["messages"][0].content
        assert "Step 1" not in content  # completed — should not appear
        assert "Step 2" in content
        assert "Step 3" in content

    def test_allows_exit_after_max_reminders(self):
        mw = TodoMiddleware()
        # Cap is config-driven (default 10). Override to 2 so the test
        # stays compact while still exercising the exit-at-cap branch.
        mw._effective_max_reminders = lambda: 2
        state = {
            "messages": [
                _completion_reminder_msg(),
                _completion_reminder_msg(),
                _ai_no_tool_calls(),
            ],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_allows_exit_after_default_max_reminders(self):
        # Production default is intentionally low so repeated reminders do not
        # dominate long tasks when the model cannot make more progress.
        mw = TodoMiddleware()
        state = {
            "messages": [
                _completion_reminder_msg(),
                _completion_reminder_msg(),
                _ai_no_tool_calls(),
            ],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_still_sends_reminder_before_cap(self):
        mw = TodoMiddleware()
        state = {
            "messages": [
                _completion_reminder_msg(),  # 1 reminder so far
                _ai_no_tool_calls(),
            ],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["jump_to"] == "model"

    def test_records_completion_reminder_state_for_progress_aware_cap(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi"), _ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["todo_completion_control"]["reminder_count"] == 1
        assert result["todo_completion_control"]["snapshot"]

    def test_resets_completion_reminder_cap_when_todos_progress(self):
        mw = TodoMiddleware()
        mw._effective_max_reminders = lambda: 2
        previous_snapshot = mw._todo_progress_snapshot(_incomplete_todos())
        progressed_todos = [
            {"status": "completed", "content": "Step 1"},
            {"status": "completed", "content": "Step 2"},
            {"status": "in_progress", "content": "Step 3"},
        ]
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": progressed_todos,
            "todo_completion_control": {
                "snapshot": previous_snapshot,
                "reminder_count": 2,
            },
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["jump_to"] == "model"
        assert result["todo_completion_control"]["reminder_count"] == 1


class TestAafterModel:
    def test_delegates_to_sync(self):
        mw = TodoMiddleware()
        state = {
            "messages": [_ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = asyncio.run(mw.aafter_model(state, _make_runtime()))
        assert result is not None
        assert result["jump_to"] == "model"
        assert result["messages"][0].name == "todo_completion_reminder"


# ---------------------------------------------------------------------------
# User-facing-response gate (prevents TodoMiddleware from steamrolling
# natural-language questions that have no tool calls)
# ---------------------------------------------------------------------------


class TestIsUserFacingResponse:
    def test_true_when_ends_with_question_mark(self):
        assert _is_user_facing_response(AIMessage(content="Which option do you prefer?"))

    def test_true_when_ends_with_fullwidth_question_mark(self):
        assert _is_user_facing_response(AIMessage(content="请确认是否继续？"))

    def test_true_with_chinese_confirmation_phrase(self):
        msg = AIMessage(content="我已经完成了分析。请确认是否继续实现。")
        assert _is_user_facing_response(msg) is True

    def test_true_with_english_shall_i(self):
        msg = AIMessage(content="I've finished the analysis. Shall I proceed?")
        assert _is_user_facing_response(msg) is True

    def test_false_for_plain_done(self):
        assert not _is_user_facing_response(AIMessage(content="I've completed all the tasks."))

    def test_false_for_self_talk_with_excluded_phrase(self):
        # '是否' alone is excluded — it appears in self-talk like this:
        assert not _is_user_facing_response(
            AIMessage(content="我需要检查文件是否存在，然后再继续。")
        )

    def test_false_for_empty_content(self):
        assert not _is_user_facing_response(AIMessage(content=""))

    def test_true_with_multipart_content_ending_in_question(self):
        msg = AIMessage(content=[{"type": "text", "text": "Here's my plan. Does this look good?"}])
        assert _is_user_facing_response(msg) is True


class TestUserFacingGateInAfterModel:
    """When the agent asks a question, after_model must let it through."""

    def test_lets_user_facing_question_through(self):
        mw = TodoMiddleware()
        state = {
            "messages": [
                HumanMessage(content="hi"),
                AIMessage(content="我已经完成了分析。请确认是否继续实现？"),
            ],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_force_continues_on_plain_done(self):
        mw = TodoMiddleware()
        state = {
            "messages": [HumanMessage(content="hi"), _ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["jump_to"] == "model"

    def test_user_facing_gate_does_not_override_all_completed(self):
        """Even if the message ends with ?, all-completed todos should exit."""
        mw = TodoMiddleware()
        state = {
            "messages": [AIMessage(content="All done, anything else?")],
            "todos": _all_completed_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None


class TestStrictCompletionSwitch:
    """Config switch todo_strict_completion=False disables force-continue."""

    def test_disabled_switch_lets_plain_done_through(self):
        mw = TodoMiddleware()
        mw._effective_strict_completion = lambda: False
        state = {
            "messages": [HumanMessage(content="hi"), _ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        assert mw.after_model(state, _make_runtime()) is None

    def test_enabled_switch_still_force_continues(self):
        mw = TodoMiddleware()
        mw._effective_strict_completion = lambda: True
        state = {
            "messages": [HumanMessage(content="hi"), _ai_no_tool_calls()],
            "todos": _incomplete_todos(),
        }
        result = mw.after_model(state, _make_runtime())
        assert result is not None
        assert result["jump_to"] == "model"

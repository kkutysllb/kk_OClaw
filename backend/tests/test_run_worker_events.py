"""Tests for file_changed custom SSE event publishing in run_agent.

The gateway does not support ``events`` stream mode, so ``on_tool_end``
never fires in the frontend SDK.  The ``file_changed`` custom event
emitted by :func:`_publish_file_changed_if_diff_updated` is the primary
real-time signal for file mutations during a coding agent run.
"""

from unittest.mock import AsyncMock

import pytest

from kkoclaw.runtime.runs.worker import (
    _StateDiffTracker,
    _publish_file_changed_if_diff_updated,
)


def _make_bridge() -> AsyncMock:
    """Return a mock StreamBridge with an async ``publish`` method."""
    bridge = AsyncMock()
    return bridge


@pytest.mark.anyio
async def test_publishes_file_changed_on_new_diff():
    bridge = _make_bridge()
    tracker = _StateDiffTracker()
    chunk = {
        "diff": [
            {"file_path": "src/app.py", "status": "modified", "additions": 5, "deletions": 2},
        ],
    }

    await _publish_file_changed_if_diff_updated(
        "run-1", chunk, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )

    bridge.publish.assert_awaited_once()
    _run_id, event_type, payload = bridge.publish.await_args.args
    assert event_type == "custom"
    assert payload["type"] == "file_changed"
    assert payload["files"] == ["src/app.py"]
    assert payload["thread_id"] == "thread-1"


@pytest.mark.anyio
async def test_no_event_on_unchanged_diff():
    """A second chunk with the same diff fingerprint does not re-publish."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()
    chunk = {
        "diff": [
            {"file_path": "src/app.py", "status": "modified", "additions": 5, "deletions": 2},
        ],
    }

    # First call: publishes
    await _publish_file_changed_if_diff_updated(
        "run-1", chunk, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    assert bridge.publish.await_count == 1
    bridge.reset_mock()

    # Second call: same fingerprint -> no publish
    await _publish_file_changed_if_diff_updated(
        "run-1", chunk, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    bridge.publish.assert_not_awaited()


@pytest.mark.anyio
async def test_publishes_on_updated_diff_fingerprint():
    """A changed additions/deletions count re-publishes the file."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()
    chunk1 = {
        "diff": [
            {"file_path": "src/app.py", "status": "modified", "additions": 5, "deletions": 2},
        ],
    }
    chunk2 = {
        "diff": [
            {"file_path": "src/app.py", "status": "modified", "additions": 10, "deletions": 3},
        ],
    }

    await _publish_file_changed_if_diff_updated(
        "run-1", chunk1, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    bridge.reset_mock()

    await _publish_file_changed_if_diff_updated(
        "run-1", chunk2, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    bridge.publish.assert_awaited_once()
    _run_id, _event_type, payload = bridge.publish.await_args.args
    assert payload["files"] == ["src/app.py"]


@pytest.mark.anyio
async def test_ignores_non_values_mode():
    """Non-values mode chunks are ignored (no diff field in messages/updates)."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()

    await _publish_file_changed_if_diff_updated(
        "run-1", {"messages": []}, mode="messages", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    bridge.publish.assert_not_awaited()


@pytest.mark.anyio
async def test_ignores_values_chunk_without_diff():
    """A values chunk without a diff field is ignored."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()

    await _publish_file_changed_if_diff_updated(
        "run-1", {"messages": []}, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )
    bridge.publish.assert_not_awaited()


@pytest.mark.anyio
async def test_publishes_multiple_new_files():
    """Multiple new files in one chunk are all included in one event."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()
    chunk = {
        "diff": [
            {"file_path": "src/a.py", "status": "added", "additions": 10, "deletions": 0},
            {"file_path": "src/b.py", "status": "added", "additions": 20, "deletions": 0},
        ],
    }

    await _publish_file_changed_if_diff_updated(
        "run-1", chunk, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )

    _run_id, _event_type, payload = bridge.publish.await_args.args
    assert set(payload["files"]) == {"src/a.py", "src/b.py"}


@pytest.mark.anyio
async def test_skips_non_dict_and_missing_path_entries():
    """Malformed diff entries are silently skipped."""
    bridge = _make_bridge()
    tracker = _StateDiffTracker()
    chunk = {
        "diff": [
            "not-a-dict",
            {"status": "added"},  # missing file_path
            {"file_path": "", "status": "added"},  # empty path
            {"file_path": "src/real.py", "status": "added", "additions": 1, "deletions": 0},
        ],
    }

    await _publish_file_changed_if_diff_updated(
        "run-1", chunk, mode="values", bridge=bridge,
        state_tracker=tracker, thread_id="thread-1",
    )

    _run_id, _event_type, payload = bridge.publish.await_args.args
    assert payload["files"] == ["src/real.py"]

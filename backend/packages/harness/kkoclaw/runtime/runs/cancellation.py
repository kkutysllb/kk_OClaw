"""Run-scoped cancellation registry.

Long-running work can outlive the asyncio task that started it when that work
is running in a blocking subprocess or a background thread.  This module lets
those pieces register a small cancellation callback under the current run id so
``RunManager.cancel()`` can stop them promptly.
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger(__name__)

CancelCallback = Callable[[], None]

_registry_lock = threading.Lock()
_registry: dict[str, dict[str, CancelCallback]] = {}
_cancelled_runs: set[str] = set()


def register_run_cancellable(run_id: str | None, cancel: CancelCallback) -> Callable[[], None]:
    """Register a cancellable callback for *run_id*.

    Returns an idempotent unregister function.  A missing run id is accepted so
    callers can use this helper without conditional boilerplate.
    """
    if not run_id:
        return lambda: None

    with _registry_lock:
        already_cancelled = run_id in _cancelled_runs
    if already_cancelled:
        try:
            cancel()
        except Exception:
            logger.warning("Late run cancellation callback failed for run %s", run_id, exc_info=True)
        return lambda: None

    token = str(uuid.uuid4())
    active = True

    with _registry_lock:
        _registry.setdefault(run_id, {})[token] = cancel

    def unregister() -> None:
        nonlocal active
        if not active:
            return
        active = False
        with _registry_lock:
            callbacks = _registry.get(run_id)
            if callbacks is None:
                return
            callbacks.pop(token, None)
            if not callbacks:
                _registry.pop(run_id, None)

    return unregister


@contextmanager
def run_cancellable(run_id: str | None, cancel: CancelCallback) -> Iterator[None]:
    unregister = register_run_cancellable(run_id, cancel)
    try:
        yield
    finally:
        unregister()


def cancel_registered_run_work(run_id: str) -> None:
    """Invoke and remove all cancellation callbacks registered for *run_id*."""
    with _registry_lock:
        _cancelled_runs.add(run_id)
        callbacks = list(_registry.pop(run_id, {}).values())

    for cancel in callbacks:
        try:
            cancel()
        except Exception:
            logger.warning("Run cancellation callback failed for run %s", run_id, exc_info=True)


def registered_cancellable_count(run_id: str) -> int:
    """Return the number of currently registered callbacks for tests/debugging."""
    with _registry_lock:
        return len(_registry.get(run_id, {}))


def clear_run_cancellation(run_id: str) -> None:
    """Forget cancellation bookkeeping for a run after its record is cleaned up."""
    with _registry_lock:
        _registry.pop(run_id, None)
        _cancelled_runs.discard(run_id)

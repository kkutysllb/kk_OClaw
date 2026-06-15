"""Regression tests for gateway restart ownership."""

from __future__ import annotations

import sys
from unittest.mock import Mock, patch

from app.gateway.routers import config as config_router


def test_restart_watcher_skips_desktop_dev_mode(monkeypatch):
    monkeypatch.setenv("KKOCLAW_DESKTOP_DEV", "1")
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    with patch.object(config_router.subprocess, "Popen") as popen:
        config_router._spawn_watcher_process()

    popen.assert_not_called()


def test_restart_watcher_still_spawns_for_regular_unfrozen_gateway(monkeypatch):
    monkeypatch.delenv("KKOCLAW_DESKTOP_DEV", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    with patch.object(config_router.subprocess, "Popen", Mock()) as popen:
        config_router._spawn_watcher_process()

    popen.assert_called_once()

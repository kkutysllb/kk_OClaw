"""Coding Agent home directory resolution.

The Coding Agent keeps its scratch workspace, session state and project-scoped
skills under a dedicated home (``~/.oclaw-coding`` on web, ``~/.oclaw-coding-desktop``
on desktop). Historically every call site used ``Path.home() / ".oclaw-coding"``
directly, which made it impossible to redirect the desktop shell to an isolated
location. All call sites now go through :func:`coding_home` so the environment
variable ``KKOCLAW_CODING_HOME`` (injected by the Electron ``backend.ts``) can
override the default.
"""

from __future__ import annotations

import os
from pathlib import Path

#: The default coding home suffix relative to the user's real home directory.
#: The desktop shell overrides this via ``KKOCLAW_CODING_HOME``.
DEFAULT_CODING_HOME_SUFFIX = ".oclaw-coding"


def coding_home() -> Path:
    """Return the Coding Agent home directory.

    Resolution order:

    1. ``KKOCLAW_CODING_HOME`` environment variable (desktop sets this to
       ``~/.oclaw-coding-desktop`` so desktop sessions never collide with a
       co-located web deployment's ``~/.oclaw-coding``).
    2. ``~/.oclaw-coding`` (web / standalone default).

    The result is fully resolved (no symlinks, absolute) so downstream
    ``startswith`` prefix checks against project roots are reliable.
    """
    env_home = os.getenv("KKOCLAW_CODING_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return (Path.home() / DEFAULT_CODING_HOME_SUFFIX).resolve()

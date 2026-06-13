"""Standalone entry point for PyInstaller bundling.

This module provides a minimal uvicorn launcher that works both in
development (from source tree) and when frozen with PyInstaller.

When frozen, the bundle root (next to the executable) is added to
``sys.path`` so that the ``app`` and ``kkoclaw`` packages — which are
shipped as plain source directories inside the bundle — can be imported.
"""

import os
import sys


def _setup_frozen_path() -> None:
    """Add the bundle directory to sys.path when running as a frozen app."""
    if getattr(sys, "frozen", False):
        # PyInstaller sets sys.frozen = True and sys.executable points to
        # the bundled executable. The _MEIPASS dir (for onefile) or the
        # executable's directory (for onedir) contains all bundled modules.
        bundle_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        if bundle_dir not in sys.path:
            sys.path.insert(0, bundle_dir)


def main() -> None:
    _setup_frozen_path()

    # Deferred import so sys.path manipulation takes effect first.
    import uvicorn

    host = os.environ.get("GATEWAY_HOST", "127.0.0.1")
    port = int(os.environ.get("GATEWAY_PORT", "9987"))
    log_level = os.environ.get("GATEWAY_LOG_LEVEL", "info")

    uvicorn.run(
        "app.gateway.app:app",
        host=host,
        port=port,
        log_level=log_level,
        # Avoid reload in production/frozen mode
        reload=False,
        # Use a single worker to keep things simple in desktop mode
        workers=1,
    )


if __name__ == "__main__":
    main()

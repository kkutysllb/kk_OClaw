# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller hook for uvicorn server.

uvicorn dynamically loads protocol/loop implementations via import_string()
which PyInstaller cannot trace. This ensures all optional protocol backends
are available.
"""

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for OClaw Gateway backend.

This spec bundles the entire Python backend (FastAPI gateway + kkoclaw harness)
into a standalone directory executable that can be embedded inside the Tauri
desktop application.

Build command (run from backend/ directory):
    uv run pyinstaller ../desktop/backend-build/oclaw-gateway.spec

Output: dist/oclaw-gateway/ (directory containing the executable + all deps)
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

# ── Resolve paths ───────────────────────────────────────────────────────────
# The spec file lives in desktop/backend-build/. We need:
#   REPO_ROOT  = the git repository root
#   BACKEND_DIR = backend/ source directory
SPEC_DIR = Path(SPECPATH).resolve()  # desktop/backend-build/
REPO_ROOT = SPEC_DIR.parent.parent  # repo root
BACKEND_DIR = REPO_ROOT / "backend"
SKILLS_DIR = REPO_ROOT / "skills"

# ── Packages that need full collection (data + submodules + binaries) ──────
# LangChain/LangGraph ecosystem relies heavily on dynamic imports and
# package-relative data files. collect_all() grabs everything.
COLLECT_ALL_PACKAGES = [
    # ASGI server — must be collected in full because gateway_main.py
    # imports uvicorn lazily inside main(), which PyInstaller's static
    # analyser misses. Without this, the frozen executable aborts with
    # "ModuleNotFoundError: No module named 'uvicorn'" before it ever
    # starts listening, causing the desktop splash screen to hang until
    # the 120 s health-check timeout.
    "uvicorn",
    "starlette",
    "fastapi",
    "pydantic",
    # LangChain core & providers
    "langchain",
    "langchain_core",
    "langchain_openai",
    "langchain_anthropic",
    "langchain_deepseek",
    "langchain_google_genai",
    "langchain_mcp_adapters",
    "langchain_protocol",
    # LangGraph ecosystem
    "langgraph",
    "langgraph_api",
    "langgraph_sdk",
    "langgraph_runtime_inmem",
    "langgraph_checkpoint",
    "langgraph_checkpoint_sqlite",
    "langgraph_prebuilt",
    "langgraph_cli",
    "langgraph_api",
    # Document processing
    "markitdown",
    "markdownify",
    "readabilipy",
    "pymupdf",
    "pdfplumber",
    "openpyxl",
    # MCP
    "mcp",
    # Tokenizer
    "tiktoken",
    # Search tools
    "tavily",
    "firecrawl",
    "exa",
    "ddgs",
    # Google GenAI (different import name)
    "google.genai",
    # Anthropic SDK
    "anthropic",
    # Database
    "duckdb",
    "sqlalchemy",
    "alembic",
    "aiosqlite",
    "sqlite_vec",
    # LangGraph store backends
    "langgraph.store",
    "langgraph.checkpoint",
    "langgraph.checkpoint.sqlite",
    # Vector / embedding support
    "numpy",
    "scipy",
    # IM Channels
    "lark_oapi",
    "slack_sdk",
    "telegram",
    "dingtalk_stream",
    # Web content extraction
    "lxml",
    "PIL",
]

datas = []
binaries = []
hiddenimports = []

for pkg in COLLECT_ALL_PACKAGES:
    try:
        pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hiddenimports
    except Exception:
        # Some packages may not be installed on all platforms; skip silently
        pass

# ── Explicit hidden imports for known dynamic-loading edge cases ────────────
EXTRA_HIDDEN_IMPORTS = [
    # uvicorn workers and protocols
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
    # uvicorn standard extras
    "httptools",
    "websockets",
    "h11",
    # LangChain provider model classes (loaded via string paths in config)
    "langchain_openai",
    "langchain_openai.chat_models",
    "langchain_openai.chat_models.base",
    "langchain_anthropic",
    "langchain_anthropic.chat_models",
    "langchain_deepseek",
    "langchain_google_genai",
    # email validator
    "email_validator",
    "dnspython",
    # bcrypt / JWT
    "bcrypt",
    "jwt",
    "jwt.algorithms",
    # multipart upload
    "multipart",
    # Markdown
    "markdown",
    "markdown.extensions",
    # SSE
    "sse_starlette",
    "sse_starlette.sse",
    # MCP transport
    "mcp.server.stdio",
    "mcp.server.sse",
    "mcp.client.stdio",
    "mcp.client.sse",
    "mcp.client.session",
    # markitdown converters
    "markitdown.converters",
    # Volcengine SDK (for firecrawl)
    "volcenginesdkseccenter20240508",
    # openai resources
    "openai",
    "openai.types",
    "openai.resources",
    # tiktoken encodings are loaded dynamically
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    # CORS
    "starlette.middleware.cors",
    # sqlite_vec (C extension for vector search in LangGraph store)
    "sqlite_vec",
    # LangGraph store sqlite backend
    "langgraph.store.sqlite",
    "langgraph.store.sqlite.aio",
    "langgraph.checkpoint.sqlite",
]
hiddenimports += EXTRA_HIDDEN_IMPORTS

# ── Package metadata (some libs read their own version via importlib.metadata) ──
METADATA_PACKAGES = [
    "langchain",
    "langchain-core",
    "langchain-openai",
    "langchain-anthropic",
    "langchain-deepseek",
    "langchain-google-genai",
    "langgraph",
    "langgraph-sdk",
    "langgraph-api",
    "fastapi",
    "uvicorn",
    "pydantic",
    "openai",
    "anthropic",
    "tiktoken",
    "kkoclaw-harness",
    "kkoclaw",
]
for pkg in METADATA_PACKAGES:
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass

# ── Application source code (shipped as plain .py) ─────────────────────────
# The app/ and kkoclaw/ packages are pure Python and must be bundled as data
# so the frozen executable can import them via sys.path.
datas += [
    # FastAPI gateway application code
    (str(BACKEND_DIR / "app"), "app"),
    # kkoclaw harness framework (installed as editable from packages/harness/)
    (str(BACKEND_DIR / "packages" / "harness" / "kkoclaw"), "kkoclaw"),
]

# ── Default skills (bundled, copied to app data on first run) ──────────────
if SKILLS_DIR.joinpath("public").exists():
    datas += [
        (str(SKILLS_DIR / "public"), "skills/public"),
    ]

# ── Config template ────────────────────────────────────────────────────────
embedded_config = SPEC_DIR / "config.embedded.yaml"
if embedded_config.exists():
    datas += [
        (str(embedded_config), "."),
    ]

# ── Exclude large/unused packages to reduce bundle size ────────────────────
excludes = [
    # Test frameworks
    "pytest",
    "pytest_asyncio",
    "ruff",
    "prompt_toolkit",
    # Matplotlib (pulled in by pandas but not used at runtime)
    "matplotlib",
    "matplotlib.pyplot",
    # IPython / Jupyter
    "IPython",
    "jupyter",
    "notebook",
    # Tkinter (not used in server context)
    "tkinter",
    "tkinterdialog",
    # PostgreSQL async driver (we use SQLite by default in desktop)
    "asyncpg",
    "psycopg",
    "psycopg2",
    # Ollama (optional, can be added if user configures it)
    # NOTE: Keep commented out — user may configure Ollama
    # "langchain_ollama",
]

# ── Analysis ───────────────────────────────────────────────────────────────
a = Analysis(
    [str(BACKEND_DIR / "gateway_main.py")],
    pathex=[
        str(BACKEND_DIR),
        str(BACKEND_DIR / "packages" / "harness"),
    ],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[str(SPEC_DIR)],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

# ── PYZ (Python zip archive) ───────────────────────────────────────────────
pyz = PYZ(a.pure, a.zipped_data, cipher=None)

# ── Directory-mode executable (faster startup than onefile) ────────────────
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="oclaw-gateway",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # Keep console for log output
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="oclaw-gateway",
)

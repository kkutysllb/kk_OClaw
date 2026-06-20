# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for OClaw Gateway backend (Electron build).

This spec bundles the entire Python backend (FastAPI gateway + kkoclaw harness)
into a standalone directory executable that can be embedded inside the
Electron desktop application.

Build command (run from backend/ directory):
    uv run pyinstaller ../desktop-electron/backend-build/oclaw-gateway.spec

Output: dist/oclaw-gateway/ (directory containing the executable + all deps)
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

# ── Resolve paths ───────────────────────────────────────────────────────────
# The spec file lives in desktop-electron/backend-build/. We need:
#   REPO_ROOT   = the git repository root
#   BACKEND_DIR = backend/ source directory
SPEC_DIR = Path(SPECPATH).resolve()  # desktop-electron/backend-build/
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
    # ── tree-sitter grammars for symbol-level code navigation ──
    # _symbol_parser.py imports these LAZILY inside functions and via
    # __import__() with runtime-resolved module names (see
    # _GRAMMAR_MODULES mapping). PyInstaller's static ModuleGraph cannot
    # follow these dynamic imports, so without collect_all() the .so
    # binaries and the queries/ data dir (used by importlib.resources in
    # tree_sitter_typescript) are silently dropped — at runtime the import
    # fails inside a try/except and find_symbols/read_symbol silently
    # degrade to the regex fallback, losing AST-accurate navigation.
    "tree_sitter",
    "tree_sitter_python",
    "tree_sitter_javascript",
    "tree_sitter_typescript",
    "tree_sitter_go",
    "tree_sitter_rust",
]

datas = []
binaries = []
hiddenimports = []

# Track which packages were successfully collected so we can fail loudly if
# a critical ASGI/server package is missing — otherwise the build succeeds but
# the frozen executable crashes at runtime with ModuleNotFoundError.
_collected_ok = []
_collected_failed = []

# Some packages have optional sub-packages that pull in heavy or missing
# dependencies not needed at runtime (e.g. mcp.cli imports typer). For those
# we use targeted collection that skips the problematic sub-package instead
# of the all-or-nothing collect_all().
_PACKAGES_WITH_SKIP = {
    "mcp": ("mcp.cli",),  # CLI not needed in the gateway; typer not installed
}

for pkg in COLLECT_ALL_PACKAGES:
    try:
        skip_prefixes = _PACKAGES_WITH_SKIP.get(pkg)
        if skip_prefixes:
            # Targeted collection: data files + filtered submodules
            pkg_datas = collect_data_files(pkg, include_py_files=False)
            try:
                pkg_hiddenimports = collect_submodules(
                    pkg,
                    filter=lambda name, _sp=skip_prefixes: (
                        not any(name == s or name.startswith(s + ".") for s in _sp)
                    ),
                )
            except Exception:
                pkg_hiddenimports = []
            pkg_binaries = []
            datas += pkg_datas
            binaries += pkg_binaries
            hiddenimports += pkg_hiddenimports
            _collected_ok.append(pkg)
        else:
            pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
            datas += pkg_datas
            binaries += pkg_binaries
            hiddenimports += pkg_hiddenimports
            _collected_ok.append(pkg)
    except Exception as exc:
        # Some packages may not be installed on all platforms; record but
        # don't abort yet — we validate critical packages below.
        _collected_failed.append((pkg, str(exc)))

# Critical packages that MUST be present or the gateway will crash at runtime.
# If any of these failed to collect, abort the build with a clear message
# instead of shipping a broken bundle.
_CRITICAL_PACKAGES = {"uvicorn", "starlette", "fastapi", "pydantic"}
_missing_critical = [
    (p, e) for p, e in _collected_failed if p in _CRITICAL_PACKAGES
]
if _missing_critical:
    msg = "\n[FATAL] Critical packages failed to collect for PyInstaller bundle:\n"
    for pkg, err in _missing_critical:
        msg += f"  - {pkg}: {err}\n"
    msg += (
        "\nThese are required for the gateway to start. Ensure they are "
        "installed in the build environment (check pyproject.toml / uv.lock) "
        "before running PyInstaller.\n"
    )
    raise SystemExit(msg)

# Log a summary so CI output shows what was collected.
print(f"\n[PyInstaller spec] Collected {len(_collected_ok)} packages successfully.")
if _collected_failed:
    print(f"[PyInstaller spec] {len(_collected_failed)} packages skipped (non-critical):")
    for pkg, err in _collected_failed:
        print(f"  - {pkg}: {err[:80]}")
print()

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
    # MCP CLI (pulls in typer/rich which are not installed; the gateway
    # never uses the CLI entry-point at runtime)
    "mcp.cli",
    "typer",
    "rich",
    # speech_recognition: pulled in as a transitive dep, but the gateway
    # never imports it (0 references in the codebase). The wheel ships a
    # pre-built `flac-mac` binary compiled against an SDK OLDER than the
    # macOS 10.9 SDK. Apple's notarization service HARDFAILS on any such
    # binary with:
    #   "The binary uses an SDK older than the 10.9 SDK."
    # status=Invalid / statusCode=4000. Excluding the whole package keeps
    # the offending binary out of the bundle entirely.
    "speech_recognition",
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

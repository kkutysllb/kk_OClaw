#!/usr/bin/env bash
#
# setup.sh — KKOCLAW Desktop development environment setup (macOS / Linux)
#
# Usage:
#   cd desktop && ./setup.sh          # Full setup
#   ./setup.sh --check                # Only check prerequisites
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}   $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC}  $*"; }

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

echo ""
echo "=========================================="
echo "  KKOCLAW Desktop - Environment Setup"
echo "=========================================="
echo ""

ERRORS=0

# ── 1. Rust toolchain ────────────────────────────────────────────────────
echo "Checking Rust toolchain..."
if command -v rustc &>/dev/null && command -v cargo &>/dev/null; then
    RUST_VERSION=$(rustc --version)
    ok "Rust: $RUST_VERSION"
else
    err "Rust not found. Install via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    ERRORS=$((ERRORS + 1))
fi

# ── 2. Tauri CLI ─────────────────────────────────────────────────────────
echo "Checking Tauri CLI..."
if cargo install --list 2>/dev/null | grep -q "tauri-cli"; then
    ok "tauri-cli installed"
else
    if $CHECK_ONLY; then
        warn "tauri-cli not installed. Install via: cargo install tauri-cli"
    else
        echo "Installing tauri-cli..."
        cargo install tauri-cli
        ok "tauri-cli installed"
    fi
fi

# ── 3. System dependencies (Linux) ───────────────────────────────────────
if [[ "$(uname)" == "Linux" ]]; then
    echo "Checking Linux system dependencies..."
    if command -v apt-get &>/dev/null; then
        REQUIRED_PKGS=(libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev)
        MISSING=()
        for pkg in "${REQUIRED_PKGS[@]}"; do
            if ! dpkg -s "$pkg" &>/dev/null 2>&1; then
                MISSING+=("$pkg")
            fi
        done
        if [[ ${#MISSING[@]} -gt 0 ]]; then
            if $CHECK_ONLY; then
                warn "Missing packages: ${MISSING[*]}"
                warn "Install via: sudo apt-get install ${MISSING[*]}"
            else
                echo "Installing missing packages..."
                sudo apt-get update
                sudo apt-get install -y "${MISSING[@]}"
                ok "System dependencies installed"
            fi
        else
            ok "All Linux system dependencies satisfied"
        fi
    else
        warn "Non-apt Linux detected. You may need to install webkit2gtk, gtk3, and appindicator dependencies manually."
    fi
fi

# ── 4. Python ────────────────────────────────────────────────────────────
echo "Checking Python..."
if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 --version 2>&1 | grep -oP '\d+\.\d+')
    PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)

    if [[ "$PY_MAJOR" -ge 3 ]] && [[ "$PY_MINOR" -ge 12 ]]; then
        ok "Python: $(python3 --version)"
    else
        err "Python 3.12+ required, found $(python3 --version)"
        ERRORS=$((ERRORS + 1))
    fi
else
    err "Python3 not found. Install Python 3.12+"
    ERRORS=$((ERRORS + 1))
fi

# ── 5. uv ────────────────────────────────────────────────────────────────
echo "Checking uv..."
if command -v uv &>/dev/null; then
    ok "uv: $(uv --version)"
else
    err "uv not found. Install via: curl -LsSf https://astral.sh/uv/install.sh | sh"
    ERRORS=$((ERRORS + 1))
fi

# ── 6. pnpm ──────────────────────────────────────────────────────────────
echo "Checking pnpm..."
if command -v pnpm &>/dev/null; then
    ok "pnpm: $(pnpm --version)"
else
    err "pnpm not found. Install via: corepack enable && corepack prepare pnpm@latest --activate"
    ERRORS=$((ERRORS + 1))
fi

# ── 7. Install backend dependencies ──────────────────────────────────────
if ! $CHECK_ONLY; then
    echo ""
    echo "Installing backend dependencies..."
    cd "$REPO_ROOT/backend"
    uv sync
    ok "Backend dependencies installed"
fi

# ── 8. Install frontend dependencies ─────────────────────────────────────
if ! $CHECK_ONLY; then
    echo "Installing frontend dependencies..."
    cd "$REPO_ROOT/frontend"
    pnpm install
    ok "Frontend dependencies installed"
fi

# ── 9. Install desktop npm dependencies ──────────────────────────────────
if ! $CHECK_ONLY; then
    echo "Installing desktop dependencies..."
    cd "$SCRIPT_DIR"
    pnpm install
    ok "Desktop dependencies installed"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -eq 0 ]]; then
    ok "All prerequisites satisfied!"
    echo ""
    echo "To start development:"
    echo "  cd $SCRIPT_DIR"
    echo "  pnpm dev"
    echo ""
else
    err "$ERRORS prerequisite(s) missing. Please install them and re-run."
    exit 1
fi

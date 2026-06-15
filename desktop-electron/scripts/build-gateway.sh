#!/usr/bin/env bash
#
# build-gateway.sh — Bundle the Python gateway backend via PyInstaller.
#
# This script MUST be run before `electron-builder`. It:
#   1. Runs PyInstaller from backend/ using oclaw-gateway.spec
#   2. Copies the output directory to desktop-electron/resources/gateway/
#
# electron-builder then bundles everything in resources/gateway/ into the
# final .app/.dmg/.exe/.deb as `process.resourcesPath/gateway`.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
SPEC_FILE="$DESKTOP_DIR/backend-build/oclaw-gateway.spec"
RESOURCES_DIR="$DESKTOP_DIR/resources/gateway"

# ── Colours ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Building OClaw Gateway (PyInstaller)"
echo "=========================================="
echo ""

[[ -f "$SPEC_FILE" ]] || fail "Spec file not found: $SPEC_FILE"
[[ -d "$BACKEND_DIR" ]] || fail "Backend directory not found: $BACKEND_DIR"

# Ensure backend venv exists
if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
    info "Backend venv not found, running 'uv sync'..."
    (cd "$BACKEND_DIR" && uv sync)
fi

# Ensure PyInstaller is installed
info "Checking PyInstaller..."
(cd "$BACKEND_DIR" && uv run python -c "import PyInstaller; print(PyInstaller.__version__)" 2>/dev/null) || {
    warn "PyInstaller not installed, adding to dev dependencies..."
    (cd "$BACKEND_DIR" && uv add --dev pyinstaller)
}

# ── Run PyInstaller ──────────────────────────────────────────────────────
info "Running PyInstaller (this may take several minutes)..."
echo ""

(cd "$BACKEND_DIR" && uv run pyinstaller "$SPEC_FILE" --noconfirm --clean)

echo ""

# ── Verify output ────────────────────────────────────────────────────────
PYINSTALLER_OUTPUT="$BACKEND_DIR/dist/oclaw-gateway"

[[ -d "$PYINSTALLER_OUTPUT" ]] || fail "PyInstaller output not found: $PYINSTALLER_OUTPUT"
[[ -f "$PYINSTALLER_OUTPUT/oclaw-gateway" || -f "$PYINSTALLER_OUTPUT/oclaw-gateway.exe" ]] || \
    fail "Gateway executable not found in output"

OUTPUT_SIZE=$(du -sh "$PYINSTALLER_OUTPUT" | cut -f1)
ok "PyInstaller build complete (${OUTPUT_SIZE})"

# ── Copy to resources/gateway/ ──────────────────────────────────────────
info "Copying gateway bundle to resources/gateway/ ..."

mkdir -p "$RESOURCES_DIR"
# Clean old contents (preserve .gitkeep)
find "$RESOURCES_DIR" -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true

# Copy the entire PyInstaller output directory
cp -R "$PYINSTALLER_OUTPUT/"* "$RESOURCES_DIR/"

FINAL_SIZE=$(du -sh "$RESOURCES_DIR" | cut -f1)
ok "Gateway bundle copied to resources/gateway/ (${FINAL_SIZE})"

# ── Summary ─────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
ok "Gateway bundle ready for electron-builder packaging"
echo "=========================================="
echo ""

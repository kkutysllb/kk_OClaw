#!/usr/bin/env bash
#
# build-all.sh — Full pre-build pipeline for Tauri packaging
#
# Runs as Tauri's `beforeBuildCommand`. Performs two steps in order:
#   1. Bundle the Python gateway backend via PyInstaller → resources/gateway/
#   2. Build the Next.js frontend static export → frontend/out/
#
# After both succeed, Tauri bundles frontend/out/ + resources/gateway/ into
# the final .app / .dmg.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
fail() { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

echo ""
echo "=========================================="
echo "  OClaw Desktop — Full Build Pipeline"
echo "=========================================="

# ── Step 1: Build Python gateway ──────────────────────────────────────────
info "Step 1/2: Building Python gateway (PyInstaller)..."
bash "$SCRIPT_DIR/build-gateway.sh"

# ── Step 2: Build frontend static export ──────────────────────────────────
info "Step 2/2: Building frontend static export..."
echo ""

[[ -d "$FRONTEND_DIR" ]] || fail "Frontend directory not found: $FRONTEND_DIR"

(cd "$FRONTEND_DIR" && node scripts/desktop-build.mjs)

[[ -d "$FRONTEND_DIR/out" ]] || fail "Frontend build output not found: $FRONTEND_DIR/out"

echo ""
echo "=========================================="
ok "All build steps complete — handing off to Tauri"
echo "=========================================="
echo ""

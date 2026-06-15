#!/usr/bin/env bash
#
# generate-icons.sh — Produce electron-builder icon assets from icon-source.svg
#
# Outputs (in build/):
#   icon.icns       macOS app icon
#   icon.ico        Windows app icon
#   icon.png        generic 512×512 (tray fallback)
#   icons/          Linux PNG set (16,32,48,64,128,256,512,1024)
#
# Requires: rsvg-convert (librsvg), iconutil + sips (macOS).
# On macOS these are all available via Homebrew / the system.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$(cd "$SCRIPT_DIR/../build" && pwd)"
SRC="$BUILD_DIR/icon-source.svg"

# ── Colours ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
fail() { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

[[ -f "$SRC" ]] || fail "SVG source not found: $SRC"
command -v rsvg-convert >/dev/null || fail "rsvg-convert not found (brew install librsvg)"

PNG_SIZES=(16 32 48 64 128 256 512 1024)
ICONS_DIR="$BUILD_DIR/icons"
ICONSET_DIR="$BUILD_DIR/icon.iconset"

mkdir -p "$ICONS_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

info "Rendering PNGs from SVG..."
for size in "${PNG_SIZES[@]}"; do
  rsvg-convert -w "$size" -h "$size" "$SRC" -o "$ICONS_DIR/${size}x${size}.png"
done

# Generic 512×512 icon.png (used by main.ts as a tray/window fallback).
rsvg-convert -w 512 -h 512 "$SRC" -o "$BUILD_DIR/icon.png"
ok "PNGs rendered: ${PNG_SIZES[*]} + icon.png"

# ── macOS .icns ──────────────────────────────────────────────────────────
# iconutil requires an .iconset dir with the conventional names.
build_iconset() {
  local s=$1 ext=$2
  cp "$ICONS_DIR/${s}x${s}.png" "$ICONSET_DIR/icon_${ext}${s}x${s}.png"
}

info "Building macOS iconset..."
build_iconset 16 ""
build_iconset 32 ""
build_iconset 128 ""
build_iconset 256 ""
build_iconset 512 ""
build_iconset 1024 ""
build_iconset 32 "@2x"   # 16@2x = 32
build_iconset 64 "@2x"   # 32@2x = 64
build_iconset 256 "@2x"  # 128@2x = 256
build_iconset 512 "@2x"  # 256@2x = 512
build_iconset 1024 "@2x" # 512@2x = 1024

if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"
  ok "icon.icns created"
else
  warn "iconutil not found — skipping icon.icns (build on macOS to generate)"
fi
rm -rf "$ICONSET_DIR"

# ── Windows .ico ─────────────────────────────────────────────────────────
# ICO = 6-byte header + directory entries + PNG blobs. We embed PNGs directly
# (supported by Windows Vista+ and all Electron targets).
info "Building icon.ico..."
node - "$BUILD_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const buildDir = process.argv[2];
const iconsDir = path.join(buildDir, "icons");
// ICO-embedded PNG sizes (power-of-two, multi-resolution).
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((s) => {
  const file = path.join(iconsDir, `${s}x${s}.png`);
  return { size: s, data: fs.readFileSync(file) };
});
// 6-byte ICONDIR + 16-byte ICONDIRENTRY per image.
const headerSize = 6;
const entrySize = 16;
const dirSize = headerSize + entrySize * images.length;
let offset = dirSize;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(images.length, 4);
const entries = images.map((img) => {
  const e = Buffer.alloc(entrySize);
  e.writeUInt8(img.size === 256 ? 0 : img.size, 0); // width
  e.writeUInt8(img.size === 256 ? 0 : img.size, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(img.data.length, 8); // byte size
  e.writeUInt32LE(offset, 12); // offset to image data
  offset += img.data.length;
  return e;
});
const out = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
fs.writeFileSync(path.join(buildDir, "icon.ico"), out);
NODE
ok "icon.ico created"

echo ""
ok "All icons generated in build/"
ls -la "$BUILD_DIR"/icon.* "$ICONS_DIR" 2>/dev/null

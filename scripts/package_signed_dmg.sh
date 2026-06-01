#!/usr/bin/env bash
# Developer ID 签名后的 DMG 打包。
#
# Tauri 的 app-build 会先生成 dmg；如果之后才手动 codesign .app，旧 dmg
# 里仍是未签名 app。这个脚本从当前已签名 / 已 staple 的 .app 重新生成 dmg，
# 并给 dmg 本身做 Developer ID 签名。
#
# 用法：
#   bash scripts/package_signed_dmg.sh [path/to/Video2Blog.app] [path/to/output.dmg]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-frontend/src-tauri/target/release/bundle/macos/Video2Blog.app}"
DMG_DIR="frontend/src-tauri/target/release/bundle/dmg"
APP_NAME="$(basename "$APP")"

resolve_identity() {
  if [ -n "${SIGN_IDENTITY:-}" ]; then
    printf '%s\n' "$SIGN_IDENTITY"
    return
  fi

  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^.*"\(Developer ID Application:.*\)"$/\1/p' \
    | head -n 1
}

if [ ! -d "$APP" ]; then
  echo "[dmg] ✗ 找不到 .app：$APP（先 make app-build && make sign-app）"; exit 1
fi

IDENTITY="$(resolve_identity)"
if [ -z "$IDENTITY" ]; then
  echo "[dmg] ✗ 找不到 Developer ID Application 签名身份。"
  echo "      证书装好后可让脚本自动发现，或手动 export SIGN_IDENTITY。"
  exit 1
fi

PRODUCT="$(node -e "const c=require('./frontend/src-tauri/tauri.conf.json'); console.log(c.productName)")"
VERSION="$(node -e "const c=require('./frontend/src-tauri/tauri.conf.json'); console.log(c.version)")"

DEFAULT_DMG="$DMG_DIR/${PRODUCT}_${VERSION}_$(uname -m).dmg"
if [ "$(uname -m)" = "arm64" ]; then
  DEFAULT_DMG="$DMG_DIR/${PRODUCT}_${VERSION}_aarch64.dmg"
fi

DMG="${2:-$DEFAULT_DMG}"
ROOT=".build-backend/dmg-root"

echo "[dmg] App：$APP"
echo "[dmg] DMG：$DMG"
echo "[dmg] 身份：$IDENTITY"

echo "[dmg] 验证 .app 签名…"
codesign --verify --deep --strict --verbose=2 "$APP"

rm -rf "$ROOT"
mkdir -p "$ROOT" "$DMG_DIR"
ditto "$APP" "$ROOT/$APP_NAME"
ln -s /Applications "$ROOT/Applications"

rm -f "$DMG"
echo "[dmg] 生成 dmg…"
hdiutil create -volname "$PRODUCT" -srcfolder "$ROOT" -ov -format UDZO "$DMG"

echo "[dmg] 签名 dmg…"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
codesign --verify --deep --strict --verbose=2 "$DMG"

echo "[dmg] ✓ 已生成签名 dmg：$DMG"

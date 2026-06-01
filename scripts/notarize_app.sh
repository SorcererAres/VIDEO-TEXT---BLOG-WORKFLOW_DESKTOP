#!/usr/bin/env bash
# 阶段 B · Notarization + Staple（脚手架）。
#
# 把已签名的 .app 提交 Apple 公证，通过后 staple 票据进 bundle，
# 之后用户双击不再被 Gatekeeper 拦「未识别开发者」，也不再重弹钥匙串。
#
# 前置（二选一，证书/账号到位后填）：
#   A. 钥匙串配置档（推荐，一次性）：
#        xcrun notarytool store-credentials video2blog-notary \
#          --apple-id "you@example.com" --team-id TEAMID --password "app-专用密码"
#        export NOTARY_PROFILE=video2blog-notary
#   B. 直接传：
#        export APPLE_ID="you@example.com"
#        export TEAM_ID="TEAMID"
#        export APP_PASSWORD="app-专用密码"   # appleid.apple.com 生成的 App 专用密码
#
# 用法：
#   bash scripts/notarize_app.sh [path/to/Video2Blog.app]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-frontend/src-tauri/target/release/bundle/macos/Video2Blog.app}"
if [ ! -d "$APP" ]; then
  echo "[notarize] ✗ 找不到 .app：$APP（先 make app-build && bash scripts/sign_app.sh）"; exit 1
fi

# 组装 notarytool 鉴权参数
AUTH=()
if [ -n "${NOTARY_PROFILE:-}" ]; then
  AUTH=(--keychain-profile "$NOTARY_PROFILE")
elif [ -n "${APPLE_ID:-}" ] && [ -n "${TEAM_ID:-}" ] && [ -n "${APP_PASSWORD:-}" ]; then
  AUTH=(--apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PASSWORD")
else
  echo "[notarize] ✗ 缺鉴权。设 NOTARY_PROFILE，或 APPLE_ID/TEAM_ID/APP_PASSWORD。"
  echo "           （见本脚本头部注释）"
  exit 1
fi

# 公证只收 zip/dmg/pkg，.app 要先打包成 zip
ZIP=".build-backend/Video2Blog-notarize.zip"
mkdir -p .build-backend
echo "[notarize] 打包 → $ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "[notarize] 提交公证（--wait，可能几分钟）…"
xcrun notarytool submit "$ZIP" "${AUTH[@]}" --wait

echo "[notarize] staple 票据进 .app…"
xcrun stapler staple "$APP"

echo "[notarize] 验证 Gatekeeper 评估…"
spctl -a -vvv --type execute "$APP" || true

echo "[notarize] ✓ 公证完成。可打 .dmg 分发了。"

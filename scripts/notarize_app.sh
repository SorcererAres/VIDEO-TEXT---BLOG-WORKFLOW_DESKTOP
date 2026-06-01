#!/usr/bin/env bash
# 阶段 B · Notarization + Staple。
#
# 把已签名的 .app 或 .dmg 提交 Apple 公证，通过后 staple 票据，
# 之后用户双击不再被 Gatekeeper 拦「未识别开发者」，也不再重弹钥匙串。
#
# 智能双模式：
#   - 传 .app：ditto 打包成 zip 再 submit；staple .app；spctl 用 execute 上下文校验。
#   - 传 .dmg：直接 submit（notarytool 原生收 dmg）；staple .dmg；spctl 用 open 上下文校验。
# 一般分发要两者都公证：.app 公证让脱离 dmg 直接分发也干净；.dmg 公证让双击 dmg 不被拦。
#
# 前置（二选一）：
#   A. 钥匙串配置档（推荐，一次性）：
#        xcrun notarytool store-credentials app \
#          --apple-id "you@example.com" --team-id TEAMID --password "app-专用密码"
#        export NOTARY_PROFILE=app
#   B. 直接传：
#        export APPLE_ID="you@example.com"
#        export TEAM_ID="TEAMID"
#        export APP_PASSWORD="app-专用密码"   # appleid.apple.com 生成的 App 专用密码
#
# 用法：
#   bash scripts/notarize_app.sh [path/to/Video2Blog.app | path/to/xxx.dmg]
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-frontend/src-tauri/target/release/bundle/macos/Video2Blog.app}"
if [ ! -e "$TARGET" ]; then
  echo "[notarize] ✗ 找不到目标：$TARGET（先 make app-build && make sign-app）"; exit 1
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

case "$TARGET" in
  *.dmg|*.pkg)
    # notarytool 原生收 dmg/pkg，直接提交
    SUBMIT="$TARGET"
    SPCTL_TYPE="open"
    ;;
  *)
    # .app：公证只收 zip/dmg/pkg，先 ditto 打包成 zip
    SUBMIT=".build-backend/$(basename "$TARGET")-notarize.zip"
    mkdir -p .build-backend
    echo "[notarize] 打包 → $SUBMIT"
    ditto -c -k --keepParent "$TARGET" "$SUBMIT"
    SPCTL_TYPE="execute"
    ;;
esac

echo "[notarize] 提交公证（--wait，可能几分钟）…"
xcrun notarytool submit "$SUBMIT" "${AUTH[@]}" --wait

echo "[notarize] staple 票据进 $TARGET…"
xcrun stapler staple "$TARGET"

echo "[notarize] 验证 Gatekeeper 评估…"
if [ "$SPCTL_TYPE" = "open" ]; then
  spctl -a -t open --context context:primary-signature -vv "$TARGET" || true
else
  spctl -a -t execute -vv "$TARGET" || true
fi

echo "[notarize] ✓ 公证完成：$TARGET"

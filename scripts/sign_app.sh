#!/usr/bin/env bash
# 阶段 B · Developer ID 签名（脚手架）。
#
# 对 make app-build 出的 .app 做深度签名（含 PyInstaller sidecar 内的所有
# dylib/.so/可执行）。先内后外逐个签——Apple 已不推荐 codesign --deep，
# 嵌套 Mach-O 必须从里到外签，最后签 .app 外壳。
#
# 前置（证书到位后可选）：
#   export SIGN_IDENTITY="Developer ID Application: 你的名字 (TEAMID)"
#   # 查可用身份：security find-identity -v -p codesigning
#
# 如果未设置 SIGN_IDENTITY，本脚本会自动使用钥匙串里的第一个
# "Developer ID Application: ..." 身份。
#
# 用法：
#   bash scripts/sign_app.sh [path/to/Video2Blog.app]
#   缺省路径 = frontend/src-tauri/target/release/bundle/macos/Video2Blog.app
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-frontend/src-tauri/target/release/bundle/macos/Video2Blog.app}"
ENTITLEMENTS="frontend/src-tauri/entitlements.plist"

resolve_identity() {
  if [ -n "${SIGN_IDENTITY:-}" ]; then
    printf '%s\n' "$SIGN_IDENTITY"
    return
  fi

  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^.*"\(Developer ID Application:.*\)"$/\1/p' \
    | head -n 1
}

IDENTITY="$(resolve_identity)"
if [ -z "$IDENTITY" ]; then
  echo "[sign] ✗ 找不到 Developer ID Application 签名身份。"
  echo "       证书装好后可让脚本自动发现，或手动指定："
  echo "         security find-identity -v -p codesigning"
  echo "         export SIGN_IDENTITY=\"Developer ID Application: NAME (TEAMID)\""
  exit 1
fi
if [ ! -d "$APP" ]; then
  echo "[sign] ✗ 找不到 .app：$APP（先 make app-build）"; exit 1
fi
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "[sign] ✗ 缺 entitlements：$ENTITLEMENTS"; exit 1
fi

echo "[sign] 目标：$APP"
echo "[sign] 身份：$IDENTITY"

# 1) 先签所有内部 Mach-O（dylib / .so / 主执行文件 / PyInstaller 依赖），从里到外。
#    --options runtime 开 Hardened Runtime（公证必需）。
echo "[sign] 深签内部 Mach-O…"
while IFS= read -r f; do
  # 跳过非 Mach-O（脚本/数据文件）。
  if file "$f" | grep -q "Mach-O"; then
    codesign --force --timestamp --options runtime \
             --entitlements "$ENTITLEMENTS" \
             --sign "$IDENTITY" "$f"
  fi
done < <(find "$APP/Contents" -type f -print 2>/dev/null | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

# 2) 最后签 .app 外壳。
echo "[sign] 签 .app 外壳…"
codesign --force --timestamp --options runtime \
         --entitlements "$ENTITLEMENTS" \
         --sign "$IDENTITY" "$APP"

# 3) 验证。
echo "[sign] 验证签名…"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vvv --type execute "$APP" || true
echo "[sign] ✓ 签名完成。下一步：bash scripts/notarize_app.sh \"$APP\""

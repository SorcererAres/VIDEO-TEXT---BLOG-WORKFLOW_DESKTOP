#!/usr/bin/env bash
# 阶段 B · Developer ID 签名（脚手架）。
#
# 对 make app-build 出的 .app 做深度签名（含 PyInstaller sidecar 内的所有
# dylib/.so/可执行）。先内后外逐个签——Apple 已不推荐 codesign --deep，
# 嵌套 Mach-O 必须从里到外签，最后签 .app 外壳。
#
# 前置（证书到位后填）：
#   export SIGN_IDENTITY="Developer ID Application: 你的名字 (TEAMID)"
#   # 查可用身份：security find-identity -v -p codesigning
#
# 用法：
#   bash scripts/sign_app.sh [path/to/Video2Blog.app]
#   缺省路径 = frontend/src-tauri/target/release/bundle/macos/Video2Blog.app
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-frontend/src-tauri/target/release/bundle/macos/Video2Blog.app}"
ENTITLEMENTS="frontend/src-tauri/entitlements.plist"

if [ -z "${SIGN_IDENTITY:-}" ]; then
  echo "[sign] ✗ 未设置 SIGN_IDENTITY。"
  echo "       证书装好后："
  echo "         security find-identity -v -p codesigning   # 查身份全名"
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
echo "[sign] 身份：$SIGN_IDENTITY"

# 1) 先签所有内部 Mach-O（dylib / .so / 无扩展名可执行），从里到外。
#    --options runtime 开 Hardened Runtime（公证必需）。
echo "[sign] 深签内部 Mach-O…"
find "$APP/Contents/Resources/backend" \
     \( -name "*.dylib" -o -name "*.so" -o -perm -u+x -type f \) -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      # 跳过非 Mach-O（脚本/数据文件）
      if file "$f" | grep -q "Mach-O"; then
        codesign --force --timestamp --options runtime \
                 --entitlements "$ENTITLEMENTS" \
                 --sign "$SIGN_IDENTITY" "$f"
      fi
    done

# 2) 最后签 .app 外壳。
echo "[sign] 签 .app 外壳…"
codesign --force --timestamp --options runtime \
         --entitlements "$ENTITLEMENTS" \
         --sign "$SIGN_IDENTITY" "$APP"

# 3) 验证。
echo "[sign] 验证签名…"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "[sign] ✓ 签名完成。下一步：bash scripts/notarize_app.sh \"$APP\""

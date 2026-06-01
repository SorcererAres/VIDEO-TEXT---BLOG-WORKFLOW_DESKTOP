#!/usr/bin/env bash
# 收集 ffmpeg + 其递归 dylib 闭包到目标目录，重定位为 @loader_path 引用，
# 使其脱离 /opt/homebrew 也能在打包的 .app 内运行（转录第一步 extract_audio 用）。
#
# 纯 otool + install_name_tool 手写 BFS 递归收集（不依赖 dylibbundler，避免外部
# 工具下载不稳）。布局：
#   <DEST>/ffmpeg              引用 → @loader_path/libs/<name>
#   <DEST>/libs/*.dylib        互引 → @loader_path/<name>（同目录）
#
# 用法：bash scripts/bundle_ffmpeg.sh <目标目录>
set -euo pipefail

DEST="${1:?用法: bundle_ffmpeg.sh <目标目录>}"
BREW="$(brew --prefix)"
FFMPEG="$BREW/bin/ffmpeg"

if [ ! -x "$FFMPEG" ]; then
  echo "[bundle-ffmpeg] ✗ 缺 ffmpeg：先 brew install ffmpeg"; exit 1
fi

LIBS="$DEST/libs"
mkdir -p "$LIBS"
cp -L "$FFMPEG" "$DEST/ffmpeg"
chmod u+w "$DEST/ffmpeg"

# 非系统 dylib 判定：/opt/homebrew 或 /usr/local（brew）开头。
is_bundleable() {
  case "$1" in /opt/homebrew/*|/usr/local/*) return 0 ;; *) return 1 ;; esac
}

deps_of() {  # 列出某 Mach-O 的依赖路径（跳过首行自身 id）
  otool -L "$1" | tail -n +2 | awk '{print $1}'
}

# 1) BFS 收集所有非系统 dylib 到 LIBS（按 basename 去重）
worklist=("$DEST/ffmpeg")
while [ "${#worklist[@]}" -gt 0 ]; do
  cur="${worklist[0]}"
  worklist=("${worklist[@]:1}")
  while IFS= read -r dep; do
    is_bundleable "$dep" || continue
    name="$(basename "$dep")"
    if [ ! -f "$LIBS/$name" ]; then
      cp -L "$dep" "$LIBS/$name"
      chmod u+w "$LIBS/$name"
      worklist+=("$LIBS/$name")
    fi
  done < <(deps_of "$cur")
done

# 2) 重定位 ffmpeg：依赖 → @loader_path/libs/<name>
while IFS= read -r dep; do
  is_bundleable "$dep" || continue
  install_name_tool -change "$dep" "@loader_path/libs/$(basename "$dep")" "$DEST/ffmpeg"
done < <(deps_of "$DEST/ffmpeg")

# 3) 重定位各 dylib：id + 互引 → @loader_path/<name>（同 libs 目录）
for lib in "$LIBS"/*.dylib; do
  install_name_tool -id "@loader_path/$(basename "$lib")" "$lib"
  while IFS= read -r dep; do
    is_bundleable "$dep" || continue
    install_name_tool -change "$dep" "@loader_path/$(basename "$dep")" "$lib"
  done < <(deps_of "$lib")
done

# 4) ad-hoc 签（install_name_tool 改后旧签失效；arm64 必须签；打包时 sign_app.sh 重签）
codesign --remove-signature "$DEST/ffmpeg" "$LIBS"/*.dylib 2>/dev/null || true
codesign --force -s - "$DEST/ffmpeg" "$LIBS"/*.dylib

# 5) 自检：闭包内不得残留 /opt/homebrew、/usr/local 或未解析 @rpath
echo "[bundle-ffmpeg] 依赖自检："
fail=0
for f in "$DEST/ffmpeg" "$LIBS"/*.dylib; do
  bad="$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -E "/opt/homebrew|/usr/local|@rpath" || true)"
  if [ -n "$bad" ]; then
    echo "  ✗ $(basename "$f") 残留外部引用："; echo "$bad" | sed 's/^/      /'
    fail=1
  fi
done
[ "$fail" = 0 ] || { echo "[bundle-ffmpeg] ✗ 闭包不自洽"; exit 1; }

echo "[bundle-ffmpeg] ✓ 闭包自洽，libs 内 $(ls "$LIBS" | wc -l | tr -d ' ') 个 dylib，总 $(du -sh "$DEST" | cut -f1) → $DEST"

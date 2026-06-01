#!/usr/bin/env bash
# 收集 whisper.cpp 运行时闭包到目标目录，并 install_name_tool 重定位为
# @loader_path 相对引用，使其脱离 /opt/homebrew 也能在打包的 .app 内运行。
#
# 为什么必须 @loader_path（不能靠 DYLD_*_PATH）：Hardened Runtime + 签名后，
# macOS 会清除 DYLD_LIBRARY_PATH 等环境变量，只有写进 Mach-O 的 @loader_path/
# @rpath 才生效。backend 插件目录则用 GGML_BACKEND_PATH（非 DYLD_，不被清）指定。
#
# 闭包（brew whisper-cpp 1.8.x / ggml 0.13.x）：
#   核心 dylib：whisper-cli, libwhisper.1, libggml.0, libggml-base.0, libomp
#   backend 插件（运行时 dlopen，ggml 按 GGML_BACKEND_PATH 找）：
#     libggml-metal.so（Metal GPU 加速，shader embedded、无需外部 metallib）
#     libggml-cpu-apple_m1/m2_m3/m4.so（CPU，按芯片代）
#     libggml-blas.so（Accelerate BLAS）
#   全部放进同一目录，互相 @loader_path/<name> 引用。
#
# 用法：bash scripts/bundle_whisper_cpp.sh <目标目录>
set -euo pipefail

DEST="${1:?用法: bundle_whisper_cpp.sh <目标目录>}"
BREW="$(brew --prefix)"
CLI="$BREW/bin/whisper-cli"
GGML="$BREW/opt/ggml/lib"
GGML_BACKENDS="$(brew --prefix ggml)/libexec"
OMP="$BREW/opt/libomp/lib"
WHISPER_LIB="$BREW/opt/whisper-cpp/lib"

if [ ! -x "$CLI" ]; then
  echo "[bundle-whisper] ✗ 缺 whisper-cli：先 brew install whisper-cpp"; exit 1
fi

mkdir -p "$DEST"

# ── 收集核心 dylib（cp -L 解析软链到真身，统一存成「引用名」）──
cp -L "$CLI"                            "$DEST/whisper-cli"
cp -L "$WHISPER_LIB/libwhisper.1.dylib" "$DEST/libwhisper.1.dylib"
cp -L "$GGML/libggml.0.dylib"           "$DEST/libggml.0.dylib"
cp -L "$GGML/libggml-base.0.dylib"      "$DEST/libggml-base.0.dylib"
cp -L "$OMP/libomp.dylib"               "$DEST/libomp.dylib"

# ── 收集 backend 插件（.so）──
for so in "$GGML_BACKENDS"/libggml-*.so; do
  cp -L "$so" "$DEST/$(basename "$so")"
done
chmod u+w "$DEST"/whisper-cli "$DEST"/*.dylib "$DEST"/*.so

# ── 重定位核心 dylib 为 @loader_path（同目录）──
install_name_tool \
  -change @rpath/libwhisper.1.dylib       @loader_path/libwhisper.1.dylib \
  -change "$GGML/libggml.0.dylib"         @loader_path/libggml.0.dylib \
  -change "$GGML/libggml-base.0.dylib"    @loader_path/libggml-base.0.dylib \
  "$DEST/whisper-cli"

install_name_tool \
  -id @loader_path/libwhisper.1.dylib \
  -change "$GGML/libggml.0.dylib"         @loader_path/libggml.0.dylib \
  -change "$GGML/libggml-base.0.dylib"    @loader_path/libggml-base.0.dylib \
  "$DEST/libwhisper.1.dylib"

install_name_tool \
  -id @loader_path/libggml.0.dylib \
  -change @rpath/libggml-base.0.dylib     @loader_path/libggml-base.0.dylib \
  "$DEST/libggml.0.dylib"

install_name_tool \
  -id @loader_path/libggml-base.0.dylib \
  -change "$OMP/libomp.dylib"             @loader_path/libomp.dylib \
  "$DEST/libggml-base.0.dylib"

install_name_tool -id @loader_path/libomp.dylib "$DEST/libomp.dylib"

# ── 重定位 backend 插件（依赖 libggml-base，CPU 变体还依赖 libomp）──
for so in "$DEST"/libggml-*.so; do
  install_name_tool \
    -id "@loader_path/$(basename "$so")" \
    -change @rpath/libggml-base.0.dylib   @loader_path/libggml-base.0.dylib \
    -change "$OMP/libomp.dylib"           @loader_path/libomp.dylib \
    "$so" 2>/dev/null || true
done

# install_name_tool 改写后旧签名失效；arm64 必须有签名才能运行。
# 先 ad-hoc 签（测试期可直接跑）；打包时 sign_app.sh 会用 Developer ID 重签覆盖。
codesign --remove-signature "$DEST/whisper-cli" "$DEST"/*.dylib "$DEST"/*.so 2>/dev/null || true
codesign --force -s - "$DEST/whisper-cli" "$DEST"/*.dylib "$DEST"/*.so

# 自检：闭包内不得残留 /opt/homebrew 或未解析 @rpath（否则脱离 brew 跑不了）
echo "[bundle-whisper] 重定位后依赖自检："
fail=0
for f in "$DEST/whisper-cli" "$DEST"/*.dylib "$DEST"/*.so; do
  if otool -L "$f" | grep -q "/opt/homebrew\|@rpath"; then
    echo "  ✗ $(basename "$f") 仍含外部引用："
    otool -L "$f" | grep "/opt/homebrew\|@rpath" || true
    fail=1
  fi
done
[ "$fail" = 0 ] || { echo "[bundle-whisper] ✗ 闭包不自洽"; exit 1; }

echo "[bundle-whisper] ✓ 闭包自洽（@loader_path），$(ls "$DEST" | wc -l | tr -d ' ') 个文件 → $DEST"
echo "[bundle-whisper] 运行时记得设 GGML_BACKEND_PATH=$DEST （否则 ggml 找不到 backend 插件）"

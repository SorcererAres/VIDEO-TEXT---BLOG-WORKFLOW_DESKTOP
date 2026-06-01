#!/usr/bin/env bash
# 用 PyInstaller 把 FastAPI 后端冻结成一个单体可执行（onedir）。
# 产物：.build-backend/dist/video2blog-server/  （~24M，未含 mlx-whisper）
#
# 当前阶段：验证可行性 + 给 Tauri sidecar 准备弹药。
# 当前不打包：mlx-whisper（含 .metallib，体积大、需 datas 收集）→ 留到下一轮。
# 当前不签名：跑起来一切正常，但首次访问 macOS 钥匙串（GET /api/llm-profiles）
#   会弹授权对话框 —— 是 Apple Security Server 把"未签名新二进制"当作陌生进程。
#   Developer ID 签名 + Notarization 后即可解除。
#
# 用法：
#   bash scripts/build_backend_bin.sh        # 默认 clean 重打
#   bash scripts/build_backend_bin.sh --keep # 增量（用 .build-backend/cache 复用）

set -euo pipefail
cd "$(dirname "$0")/.."

PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "[backend-bin] 缺 .venv/bin/python，先 make install"; exit 1
fi

if ! "$PY" -c "import PyInstaller" 2>/dev/null; then
  echo "[backend-bin] 装 PyInstaller…"
  "$PY" -m pip install --quiet pyinstaller
fi

CLEAN="--clean"
[[ "${1:-}" == "--keep" ]] && CLEAN=""

# 关键参数说明：
#   --paths "$PWD"               让 PyInstaller 能找到 video2blog 包（绕开 run_engine_server.py 的 sys.path 动态注入）
#   --collect-submodules video2blog  收齐 server/engine/asr/cli 所有子模块（不然冻结后 import 失败）
#   --collect-submodules uvicorn     uvicorn 的 protocols/loops 是动态 import
#   --collect-all keyring            keyring 的 macOS 后端 + 元数据
#   --exclude-module mlx*/torch      暂时不打 mlx-whisper（下一轮再处理 .metallib 资源）
PYINSTALLER_CONFIG_DIR="$PWD/.build-backend/cache" \
  "$PY" -m PyInstaller scripts/run_engine_server.py \
  --name video2blog-server \
  --onedir --noconfirm $CLEAN \
  --distpath .build-backend/dist \
  --workpath .build-backend/work \
  --specpath .build-backend \
  --paths "$PWD" \
  --collect-submodules video2blog \
  --collect-submodules uvicorn \
  --collect-all keyring \
  --collect-all mlx \
  --collect-all mlx_whisper \
  --exclude-module torch \
  --exclude-module tkinter \
  --exclude-module matplotlib

# stage whisper.cpp 运行时闭包进 onedir —— frozen 后端按 <exe_dir>/whisper/ 定位
# whisper-cli + backend 插件（见 video2blog/engine/whisper_assets.py）。
echo
# mlx metallib 顶层兜底：mlx.core 按 libmlx.dylib 同目录找 mlx.metallib。PyInstaller
# 把 libmlx 放 _internal/ 顶层，但 metallib 只在 _internal/mlx/lib/——.app 内加载顶层
# libmlx 时同目录没 metallib → "Failed to load the default metallib"。复制一份到顶层。
_MLX_METALLIB=".build-backend/dist/video2blog-server/_internal/mlx/lib/mlx.metallib"
if [ -f "$_MLX_METALLIB" ]; then
  cp "$_MLX_METALLIB" ".build-backend/dist/video2blog-server/_internal/mlx.metallib"
  echo "[backend-bin] mlx.metallib 已复制到 _internal/ 顶层（修 .app 内 metallib 定位）"
fi

# 合同模板进 onedir/contracts/ —— 打包版首启复制到工作目录（开箱即用，见 app_bootstrap.py）。
echo "[backend-bin] 收集合同模板进 onedir…"
bash "$(dirname "$0")/bundle_contracts.sh" .build-backend/dist/video2blog-server/contracts

echo "[backend-bin] 收集 whisper.cpp 闭包进 onedir…"
bash "$(dirname "$0")/bundle_whisper_cpp.sh" .build-backend/dist/video2blog-server/whisper 2>&1 \
  | grep -v "install_name_tool: warning" || true

# stage ffmpeg 闭包进 onedir —— frozen 后端按 <exe_dir>/ffmpeg/ 定位（提音频用）。
echo "[backend-bin] 收集 ffmpeg 闭包进 onedir…"
bash "$(dirname "$0")/bundle_ffmpeg.sh" .build-backend/dist/video2blog-server/ffmpeg 2>&1 \
  | grep -v "install_name_tool: warning" || true

BIN=".build-backend/dist/video2blog-server/video2blog-server"
echo
echo "[backend-bin] 完成。"
echo "  产物目录：$(du -sh .build-backend/dist/video2blog-server | cut -f1)  .build-backend/dist/video2blog-server/"
echo "  主二进制：$(du -sh "$BIN" | cut -f1)  $BIN"
echo
echo "  试跑：$BIN --repo-root \"\$PWD\" --port 8801"

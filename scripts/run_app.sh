#!/usr/bin/env bash
# 一键起桌面 App（Tauri 壳 · dev）。
#
# 后端不再由本脚本预启：Rust sidecar 在 App setup 时自动拉起
# （dev 模式用 .venv/bin/python scripts/run_engine_server.py --auto-port），
# 退出时一并回收。避免「脚本起一个 + sidecar 又起一个」的双后端冲突。
#
# 若想用浏览器降级开发（不进 Tauri 壳），另开两个终端：
#   make server          # 手动起后端 8765
#   npm --prefix frontend run dev
set -euo pipefail
cd "$(dirname "$0")/.."

# Tauri 需要 cargo 在 PATH
export PATH="$HOME/.cargo/bin:$PATH"
echo "[app] 启动 Tauri 壳（后端由 sidecar 自动拉起）…"
cd frontend && npm run tauri dev

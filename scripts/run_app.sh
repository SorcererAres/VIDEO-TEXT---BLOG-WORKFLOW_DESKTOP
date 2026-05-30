#!/usr/bin/env bash
# 一键起桌面 App：先确保后端（FastAPI 8765）在跑，再启动 Tauri 壳（tauri dev）。
# 后端若已在运行则复用、退出时不动它；本脚本启动的后端会在退出时一并清理。
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_PID=""
cleanup() { [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[app] 后端已在 8765 运行，复用。"
else
  echo "[app] 启动后端 FastAPI (8765)…"
  .venv/bin/python scripts/run_engine_server.py &
  BACKEND_PID=$!
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:8765/health" && break
    sleep 0.5
  done
fi

# Tauri 需要 cargo 在 PATH
export PATH="$HOME/.cargo/bin:$PATH"
echo "[app] 启动 Tauri 壳…"
cd frontend && npm run tauri dev

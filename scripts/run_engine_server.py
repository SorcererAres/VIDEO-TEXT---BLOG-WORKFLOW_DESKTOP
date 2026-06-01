#!/usr/bin/env python3
"""Run the local FastAPI service for the Video2Blog engine.

桌面化 sidecar 集成 (2026-06)：新增 --auto-port 与端口握手文件，
让 Tauri 壳在仓库外（用户 Library）也能知道后端实际跑在哪个端口。
"""

from __future__ import annotations

import argparse
import atexit
import os
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# macOS：~/Library/Application Support/com.sorcerer.video2blog/port
# 其他平台：~/.config/video2blog/port（Linux），%APPDATA%/video2blog/port（Windows）
# 跟 Tauri 的 app_local_data_dir() 对齐，前后端共识同一个路径。
def _default_state_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "com.sorcerer.video2blog"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        return Path(appdata) / "video2blog" if appdata else home / "AppData" / "Roaming" / "video2blog"
    return Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "video2blog"


def _pick_port(host: str, preferred: int, scan_range: int = 64) -> int:
    """从 preferred 起向上扫，找第一个能 bind 的端口。

    用 SO_REUSEADDR 关掉，避免误判 TIME_WAIT 状态的端口为可用；
    bind 失败立即向上探 64 个候选位（8765..8828），全占满才放弃。
    """
    for port in range(preferred, preferred + scan_range):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(
        f"端口 {preferred}..{preferred + scan_range - 1} 全部被占，无法启动后端。"
    )


def _write_port_file(state_dir: Path, host: str, port: int) -> Path:
    """把后端实际端口握手给前端：原子写 host:port 到 state_dir/port。"""
    state_dir.mkdir(parents=True, exist_ok=True)
    port_file = state_dir / "port"
    tmp = port_file.with_suffix(".tmp")
    tmp.write_text(f"{host}:{port}\n", encoding="utf-8")
    os.replace(tmp, port_file)
    return port_file


def _clear_port_file(port_file: Path) -> None:
    try:
        port_file.unlink()
    except FileNotFoundError:
        pass


def main(argv: list[str] | None = None) -> int:
    raw_argv = sys.argv[1:] if argv is None else list(argv)
    # 子命令分发：让 frozen server 二进制（sys.executable）复用 CLI 转录链。
    # 打包版下 server_core._transcribe 调 `video2blog-server transcribe <video> ...`，
    # 绕开「frozen 下 sys.executable 是 server 二进制、不能直接跑 video2blog.py 脚本」的问题。
    # 转录仍是独立子进程，崩溃/超时不影响主 server。
    if raw_argv and raw_argv[0] == "transcribe":
        from video2blog.cli.main import main as cli_main
        cli_main(raw_argv[1:])
        return 0

    # mlx 转录 worker 子进程入口（frozen 下 sys.executable 是 server 二进制，
    # 不支持 python -c；mlx 引擎的隔离 worker 改经此子命令拉起）。
    if raw_argv and raw_argv[0] == "mlx-worker":
        from video2blog.asr.mlx import _mlx_worker_main
        return _mlx_worker_main(raw_argv[1:])

    parser = argparse.ArgumentParser(description="启动 Video2Blog 本地 Engine 服务。")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument(
        "--auto-port",
        action="store_true",
        help="端口被占时向上扫 64 个候选位（8765..8828），用于桌面 sidecar。",
    )
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=None,
        help=(
            "握手文件目录（写 host:port 到 <state-dir>/port）。"
            "默认 macOS ~/Library/Application Support/com.sorcerer.video2blog/。"
        ),
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Video2Blog 仓库根目录",
    )
    args = parser.parse_args(raw_argv)

    try:
        import uvicorn
    except ImportError:
        print("[错误] 未安装 uvicorn。请先执行: pip install -e . 或 pip install fastapi uvicorn", file=sys.stderr)
        return 1

    from video2blog.server import create_app

    # 决定实际端口：默认走指定 --port；--auto-port 时被占则向上扫。
    port = _pick_port(args.host, args.port) if args.auto_port else args.port

    # 写握手文件（仅 --auto-port 走，避免 dev 双开误覆盖）。
    port_file = None
    if args.auto_port:
        state_dir = args.state_dir or _default_state_dir()
        port_file = _write_port_file(state_dir, args.host, port)
        atexit.register(_clear_port_file, port_file)
        print(f"[server] sidecar 握手文件: {port_file}", flush=True)

    print(f"[server] 监听 http://{args.host}:{port}", flush=True)
    app = create_app(args.repo_root)
    uvicorn.run(app, host=args.host, port=port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

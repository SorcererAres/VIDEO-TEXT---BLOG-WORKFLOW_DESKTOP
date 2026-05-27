#!/usr/bin/env python3
"""Run the local FastAPI service for the Video2Blog engine."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="启动 Video2Blog 本地 Engine 服务。")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Video2Blog 仓库根目录",
    )
    args = parser.parse_args(argv)

    try:
        import uvicorn
    except ImportError:
        print("[错误] 未安装 uvicorn。请先执行: pip install -e . 或 pip install fastapi uvicorn", file=sys.stderr)
        return 1

    from video2blog.server import create_app

    app = create_app(args.repo_root)
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

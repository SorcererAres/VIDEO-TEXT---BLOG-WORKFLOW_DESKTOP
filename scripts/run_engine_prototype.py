#!/usr/bin/env python3
"""CLI harness for testing the Phase 0 Engine Prototype of Video2Blog."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Add project root to path to ensure it imports correctly if run as python3 scripts/run_engine_prototype.py
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from video2blog.engine import Engine, LLMClient


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="运行 Video2Blog Phase 0 引擎原型。")
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="输入源文本文件路径 (例如 work/example/raw.txt)",
    )
    parser.add_argument(
        "--speaker",
        default="梁老师",
        help="演讲者主体名字，默认 '梁老师'",
    )
    parser.add_argument(
        "--routing",
        default="/lecture",
        choices=["/default", "/lecture", "/dialogue", "/screencast", "/meeting"],
        help="写作角色路由，默认 '/lecture'",
    )
    parser.add_argument(
        "--mode",
        default="quick",
        choices=["full", "quick"],
        help="运行模式，默认 quick；full 会执行 Step 3→4→5→6→7→8",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=1,
        help="最大自我修正重试次数，默认 1 次",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="使用的 LLM 模型名称 (例如 gpt-4o, deepseek-chat)，默认从环境变量读取",
    )
    parser.add_argument(
        "--api-base",
        default=None,
        help="LLM API Base URL，默认从环境变量或官方端点读取",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重跑步骤，忽略已有缓存",
    )

    args = parser.parse_args(argv)

    api_key = os.environ.get("VIDEO2BLOG_API_KEY", "").strip()
    if not api_key:
        print("[错误] 未设置环境变量 VIDEO2BLOG_API_KEY，请先在终端中执行:", file=sys.stderr)
        print('  export VIDEO2BLOG_API_KEY="你的API密钥"', file=sys.stderr)
        print('  (可选) export VIDEO2BLOG_API_BASE="接口BaseURL"', file=sys.stderr)
        print('  (可选) export VIDEO2BLOG_MODEL="使用的模型"', file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parents[1]

    # Resolve source path
    source_path = args.source
    if not source_path.is_absolute():
        source_path = (repo_root / source_path).resolve()

    if not source_path.exists():
        print(f"[错误] 输入文件不存在: {source_path}", file=sys.stderr)
        return 1

    # Extract job stem name
    stem = source_path.parent.name
    if stem in ("Text", "input", "work", "output"):
        stem = source_path.stem

    print("----------------------------------------------------------------", flush=True)
    print("                      Video2Blog Engine Phase 0                 ", flush=True)
    print("----------------------------------------------------------------", flush=True)
    print(f"[*] 项目根目录: {repo_root}", flush=True)
    print(f"[*] 任务 Stem : {stem}", flush=True)
    print(f"[*] 输入文件  : {source_path}", flush=True)
    print(f"[*] 运行模式  : {args.mode}", flush=True)
    print(f"[*] 演讲者    : {args.speaker}", flush=True)
    print(f"[*] 角色路由  : {args.routing}", flush=True)
    print(f"[*] 自修正重试: {args.max_retries} 次", flush=True)
    print("----------------------------------------------------------------\n", flush=True)

    # Initialize client and engine
    client = LLMClient(
        api_key=api_key,
        api_base=args.api_base,
        model=args.model,
    )
    engine = Engine(repo_root=repo_root, client=client)

    if args.force:
        state = engine.load_state(stem)
        state["status"] = "PENDING"
        state["force_retry"] = True
        engine.save_state(stem, state)

    try:
        final_path = engine.run_job(
            stem=stem,
            source_path=source_path,
            mode=args.mode,
            routing=args.routing,
            speaker=args.speaker,
            max_retries=args.max_retries,
        )
        if final_path:
            print("================================================================", flush=True)
            print("[✓] 运行成功！", flush=True)
            print(f"[✓] 成品路径: {final_path}", flush=True)
            print(
                f"[✓] 累计 Token 消耗: Input {client.total_input_tokens} | Output {client.total_output_tokens}",
                flush=True,
            )
            print(f"[✓] 累计预估费用: ${client.total_cost:.5f} USD", flush=True)
            print("================================================================", flush=True)
            return 0
        else:
            print("[!] 运行中止：博文未被批准或落盘。", flush=True)
            return 1
    except Exception as e:
        print(f"\n[错误] 工作流执行发生异常: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

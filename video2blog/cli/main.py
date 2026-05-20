#!/usr/bin/env python3
"""本地流水线 Step 1–2：ffmpeg 抽音频 → ASR 转录为 raw.srt / raw.txt。

博文 Markdown 不在此脚本生成；按 WORKFLOW.md 由 Agent 执行后续步骤。

支持 **视频输入文件根**（`--input-root` 或环境变量 `VIDEO2BLOG_INPUT_ROOT`）：相对路径的单个文件与 `-w` 监听目录均先相对该根目录解析；`-w` 省略目录时直接监听该根。
"""

from __future__ import annotations

import argparse
import contextlib
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

from video2blog.asr.external import EXTERNAL_TRANSCRIPT_EXT
from video2blog.pipeline import process_video
from video2blog.utils import shell_join
from video2blog.watch import watch_loop

ENGINE_CHOICES = ("auto", "mlx", "whisper-cpp", "external")
FALLBACK_POLICY_CHOICES = ("ask", "auto", "stop")

WHISPER_MODEL = os.environ.get(
    "VIDEO2BLOG_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"
)
WHISPER_CPP_MODEL = os.environ.get("VIDEO2BLOG_WHISPER_CPP_MODEL", "").strip()
WHISPER_CPP_BIN = os.environ.get("VIDEO2BLOG_WHISPER_CPP_BIN", "").strip()
DEFAULT_ENGINE = os.environ.get("VIDEO2BLOG_ENGINE", "auto").strip() or "auto"
DEFAULT_FALLBACK_POLICY = os.environ.get("VIDEO2BLOG_FALLBACK_POLICY", "ask").strip() or "ask"
DEFAULT_MLX_TIMEOUT_SECONDS = int(
    os.environ.get("VIDEO2BLOG_MLX_TIMEOUT_SECONDS", "1800").strip() or "1800"
)
DEFAULT_SEGMENT_MINUTES = float(
    os.environ.get("VIDEO2BLOG_SEGMENT_MINUTES", "15").strip() or "15"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "work"


def resolved_input_root(cli_root: Path | None) -> Path | None:
    """CLI --input-root 优先；其次环境变量 VIDEO2BLOG_INPUT_ROOT。"""
    if cli_root is not None:
        return cli_root.expanduser().resolve()
    env = os.environ.get("VIDEO2BLOG_INPUT_ROOT", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return None


def resolve_maybe_relative(target: str | Path, root: Path | None) -> Path:
    """相对路径先相对输入根（未设置则相对当前工作目录）。"""
    p = Path(target).expanduser()
    if p.is_absolute():
        return p.resolve()
    base = root.resolve() if root is not None else Path.cwd()
    return (base / p).resolve()


def launch_in_macos_terminal(command: list[str], cwd: Path) -> None:
    osascript = shutil.which("osascript")
    if not osascript:
        raise RuntimeError("未找到 osascript，无法打开普通 macOS Terminal")
    shell_script = f"cd {shlex.quote(str(cwd))} && {shell_join(command)}"
    proc = subprocess.run(
        [
            osascript,
            "-e",
            "on run argv",
            "-e",
            'tell application "Terminal" to do script (item 1 of argv)',
            "-e",
            "end run",
            shell_script,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "打开 macOS Terminal 失败")


def preferred_python_executable(cwd: Path) -> str:
    current = Path(sys.executable).resolve()
    with contextlib.suppress(ValueError):
        current.relative_to(cwd.resolve())
        return str(current)
    for name in (".venv-mlx", ".venv", ".venv-codex"):
        venv_python = cwd / name / "bin" / "python"
        if venv_python.is_file():
            return str(venv_python)
    return sys.executable


def prompt_fallback_action(message: str, terminal_command: list[str] | None) -> str:
    options = [
        "1. 在普通 macOS Terminal 里跑 mlx-whisper（推荐，保留 native_asr 置信度）",
        "2. 改用 whisper.cpp（需要已安装命令和 ggml 模型）",
        "3. 停止，改用 --engine external --source <字幕/文字稿>",
        "4. 退出，稍后手动处理",
    ]
    if not sys.stdin.isatty():
        terminal_hint = shell_join(terminal_command) if terminal_command else "<无法生成 Terminal 命令>"
        raise RuntimeError(
            f"{message}\n"
            "当前不是交互式终端，默认 fallback-policy=ask，已停止自动降级。\n"
            "可选处理方式：\n"
            + "\n".join(options)
            + "\n\n普通 Terminal 命令：\n"
            + terminal_hint
            + "\n\n批量任务如需自动降级，请显式传 --fallback-policy auto。"
        )

    print(message, file=sys.stderr)
    print("请选择处理方式：", file=sys.stderr)
    print("\n".join(options), file=sys.stderr)
    while True:
        choice = input("输入 1/2/3/4：").strip()
        if choice in {"1", "2", "3", "4"}:
            return choice
        print("请输入 1、2、3 或 4。", file=sys.stderr)


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--input-root",
        type=Path,
        default=None,
        metavar="DIR",
        help=(
            "视频输入文件根目录；单次 VIDEO、-w DIR 若为相对路径，均先相对此目录再解析。"
            "可改用环境变量 VIDEO2BLOG_INPUT_ROOT。"
        ),
    )
    p.add_argument("video", nargs="?", default=None, type=str, metavar="VIDEO")
    p.add_argument(
        "-w",
        "--watch",
        nargs="?",
        const="",
        default=None,
        metavar="DIR",
        help="监听目录；不传 DIR 时监听 --input-root / VIDEO2BLOG_INPUT_ROOT",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="产出根目录（默认仓库内 work/；实际写入 <root>/<stem>/raw.*）",
    )
    p.add_argument("--force", action="store_true", help="产物已存在时仍重跑")
    p.add_argument(
        "--engine",
        choices=ENGINE_CHOICES,
        default=DEFAULT_ENGINE if DEFAULT_ENGINE in ENGINE_CHOICES else "auto",
        help="转录引擎：auto 先试 mlx，失败后按 --fallback-policy 处理；external 用 --source 指定已有文字稿/字幕",
    )
    p.add_argument(
        "--fallback-policy",
        choices=FALLBACK_POLICY_CHOICES,
        default=DEFAULT_FALLBACK_POLICY if DEFAULT_FALLBACK_POLICY in FALLBACK_POLICY_CHOICES else "ask",
        help="mlx 在 auto 模式下不可用时如何处理：ask 默认询问，auto 自动降级，stop 直接停止",
    )
    p.add_argument("--model", default=WHISPER_MODEL)
    p.add_argument("--mlx-timeout-seconds", type=int, default=DEFAULT_MLX_TIMEOUT_SECONDS)
    p.add_argument("--segment-minutes", type=float, default=DEFAULT_SEGMENT_MINUTES)
    p.add_argument(
        "--whisper-cpp-model",
        type=Path,
        default=Path(WHISPER_CPP_MODEL).expanduser() if WHISPER_CPP_MODEL else None,
    )
    p.add_argument("--whisper-cpp-bin", default=WHISPER_CPP_BIN or None)
    p.add_argument("--source", type=Path, help=f"--engine external 时使用的已有 {sorted(EXTERNAL_TRANSCRIPT_EXT)}")
    p.add_argument(
        "--run-in-terminal",
        action="store_true",
        help="在普通 macOS Terminal 中重新执行 mlx-whisper 转录（用于绕开沙箱 Metal 限制）",
    )
    ns = p.parse_args(argv)

    watch_on = ns.watch is not None
    if watch_on and ns.video:
        p.error("请二选一：VIDEO 与 -w/--watch 不要同时使用")
    if watch_on and ns.engine == "external":
        p.error("--watch 不支持 --engine external")
    if watch_on and ns.fallback_policy == "ask":
        p.error("--watch 不支持 --fallback-policy ask，请显式使用 auto 或 stop")
    if not watch_on and not ns.video:
        p.error("请提供 VIDEO，或使用 -w [DIR]（省略 DIR 时需配置输入根）")
    if ns.engine == "external" and ns.source is None:
        p.error("--engine external 需要 --source <.srt|.txt|.md|.vtt>")
    if ns.run_in_terminal and watch_on:
        p.error("--run-in-terminal 不支持 --watch")
    if ns.run_in_terminal and ns.engine == "external":
        p.error("--run-in-terminal 不支持 --engine external")
    if ns.mlx_timeout_seconds < 0:
        p.error("--mlx-timeout-seconds 不能为负数")
    if ns.segment_minutes < 0:
        p.error("--segment-minutes 不能为负数")
    return ns


def terminal_mlx_command(args: argparse.Namespace, video: Path) -> list[str]:
    command = [
        preferred_python_executable(Path.cwd()),
        str(Path(__file__).resolve()),
        str(video),
        "--engine",
        "mlx",
        "--fallback-policy",
        "stop",
        "--model",
        args.model,
        "--mlx-timeout-seconds",
        str(args.mlx_timeout_seconds),
        "--segment-minutes",
        str(args.segment_minutes),
    ]
    if args.output_dir is not None:
        command.extend(["--output-dir", str(args.output_dir)])
    if args.force:
        command.append("--force")
    return command


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or sys.argv[1:])
    root = resolved_input_root(args.input_root)

    if args.watch is not None:
        spec = args.watch
        if spec == "" and root is None:
            sys.exit("使用 `-w` 且省略监听目录时，必须设置 `--input-root` 或环境变量 VIDEO2BLOG_INPUT_ROOT")
        watch_target = root if spec == "" else resolve_maybe_relative(spec, root)
        watch_loop(
            watch_target,
            output_dir=args.output_dir,
            default_output_dir=DEFAULT_OUTPUT_DIR,
            model_repo=args.model,
            engine=args.engine,
            whisper_cpp_model=args.whisper_cpp_model,
            whisper_cpp_bin=args.whisper_cpp_bin,
            fallback_policy=args.fallback_policy,
            mlx_timeout_seconds=args.mlx_timeout_seconds,
            segment_minutes=args.segment_minutes,
            force=args.force,
            prompt_fallback_action=prompt_fallback_action,
            launch_in_macos_terminal=launch_in_macos_terminal,
        )
        return

    video = resolve_maybe_relative(args.video, root)
    if not video.is_file():
        sys.exit(f"文件不存在：{video}")
    terminal_command = terminal_mlx_command(args, video)
    if args.run_in_terminal:
        launch_in_macos_terminal(terminal_command, Path.cwd())
        print("已在普通 macOS Terminal 启动 mlx-whisper 转录。", flush=True)
        return
    process_video(
        video,
        output_dir=args.output_dir,
        default_output_dir=DEFAULT_OUTPUT_DIR,
        model_repo=args.model,
        engine=args.engine,
        whisper_cpp_model=args.whisper_cpp_model,
        whisper_cpp_bin=args.whisper_cpp_bin,
        external_source=args.source,
        fallback_policy=args.fallback_policy,
        terminal_command=terminal_command,
        mlx_timeout_seconds=args.mlx_timeout_seconds,
        segment_minutes=args.segment_minutes,
        force=args.force,
        prompt_fallback_action=prompt_fallback_action,
        launch_in_macos_terminal=launch_in_macos_terminal,
    )


if __name__ == "__main__":
    main()

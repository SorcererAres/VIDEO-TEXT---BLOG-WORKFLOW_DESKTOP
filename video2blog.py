#!/usr/bin/env python3
"""本地流水线 Step 1–2：ffmpeg 抽音频 → mlx-whisper 转录为 .srt / .txt。

博文 Markdown 不在此脚本生成；按《视频博文工作流-架构版》由 Agent 执行 Step 3–8。
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

VIDEO_EXT = frozenset({".mp4", ".mov", ".mkv"})

WHISPER_MODEL = os.environ.get(
    "VIDEO2BLOG_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"
)


def normalize_txt(text: str) -> str:
    """去多余空白、适度按句号后的空白断行便于阅读。"""
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    chunks = []
    buf: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if buf:
                chunks.append(" ".join(buf))
                buf = []
            continue
        buf.append(line)
        if line[-1:] in ".!?。！？…":
            chunks.append(" ".join(buf))
            buf = []
    if buf:
        chunks.append(" ".join(buf))
    return "\n".join(chunks).strip()


def fmt_srt_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms_total = int(round(seconds * 1000.0))
    hours, ms_total = divmod(ms_total, 3_600_000)
    minutes, ms_total = divmod(ms_total, 60_000)
    secs, ms = divmod(ms_total, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def segments_to_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    idx = 1
    for seg in segments:
        text = str(seg.get("text", "") or "").strip()
        if not text:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        lines.append(f"{idx}\n{fmt_srt_timestamp(start)} --> {fmt_srt_timestamp(end)}\n{text}\n")
        idx += 1
    return "\n".join(lines) + ("\n" if lines else "")


def extract_audio(video: Path, wav: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("未找到 ffmpeg，请先安装：brew install ffmpeg")
    cmd = [
        ffmpeg,
        "-nostdin",
        "-y",
        "-i",
        str(video),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        str(wav),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout or "ffmpeg 失败\n")
        sys.exit(proc.returncode)


def transcribe_audio(wav: Path, model_repo: str) -> dict:
    try:
        import mlx_whisper  # noqa: PLC0415
    except ImportError:
        sys.exit("缺少 mlx-whisper：pip install mlx-whisper")

    return mlx_whisper.transcribe(
        str(wav),
        path_or_hf_repo=model_repo,
        word_timestamps=False,
        verbose=False,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
    )


def output_paths(video: Path, output_dir: Path | None) -> Path:
    base = video.parent / "output" if output_dir is None else Path(output_dir)
    return base


def wait_file_stable(path: Path, repeats: int = 3, delay: float = 1.2) -> None:
    """拷贝大文件时能避免「未写完就开转」。"""
    streak = 0
    prev: int | None = None
    while streak < repeats:
        time.sleep(delay)
        if not path.exists():
            streak = 0
            prev = None
            continue
        sz = path.stat().st_size
        if sz <= 0:
            streak = 0
            prev = None
            continue
        if prev is not None and sz == prev:
            streak += 1
        else:
            streak = 1
        prev = sz


def process_video(
    video: Path,
    *,
    output_dir: Path | None,
    model_repo: str,
    force: bool,
) -> None:
    if video.suffix.lower() not in VIDEO_EXT:
        print(f"跳过（非支持格式 {sorted(VIDEO_EXT)}）：{video}", file=sys.stderr)
        return

    out_root = output_paths(video, output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    stem = video.stem
    txt_path = out_root / f"{stem}.txt"
    srt_path = out_root / f"{stem}.srt"
    if not force and txt_path.exists() and srt_path.exists():
        print(f"跳过（产物已存在，使用 --force 重跑）：{txt_path}", file=sys.stderr)
        return

    with tempfile.TemporaryDirectory(prefix="video2blog_") as td_tmp:
        wav = Path(td_tmp) / "audio.wav"
        print(f"[1/3] ffmpeg → {wav.name}: {video.name}", flush=True)
        extract_audio(video, wav)

        print(f"[2/3] mlx-whisper `{model_repo}` …", flush=True)
        result = transcribe_audio(wav, model_repo)
        segments: list[dict] = result.get("segments") or []

        plain = normalize_txt(str(result.get("text") or ""))
        if not plain and segments:
            plain = normalize_txt(
                "".join(str(s.get("text") or "") for s in segments)
            )

        srt_body = segments_to_srt(segments)
        if not srt_body.strip() and plain:
            head = plain[:800].replace("\n", " ").strip()
            srt_body = (
                "1\n00:00:00,000 --> 00:00:07,500\n"
                f"{head}\n\n"
            )

        txt_path.write_text(plain + "\n", encoding="utf-8")
        srt_path.write_text(srt_body, encoding="utf-8")
        print(f"[3/3] 完成 → {txt_path}\n           {srt_path}", flush=True)


class _VideoHandler:
    """watchdog：新视频落盘稳定后异步转写。"""

    def __init__(self, *, output_dir: Path | None, model_repo: str, force: bool) -> None:
        self._locks: dict[Path, threading.Lock] = {}
        self._output_dir = output_dir
        self._model_repo = model_repo
        self._force = force

    def _schedule(self, path: Path) -> None:
        key = path.resolve()

        lock = self._locks.setdefault(key, threading.Lock())
        if not lock.acquire(blocking=False):
            return

        def run() -> None:
            try:
                wait_file_stable(path)
                process_video(
                    path,
                    output_dir=self._output_dir,
                    model_repo=self._model_repo,
                    force=self._force,
                )
            finally:
                lock.release()

        threading.Thread(target=run, daemon=True).start()


def watch_loop(watch_root: Path, *, output_dir: Path | None, model_repo: str, force: bool) -> None:
    try:
        from watchdog.events import FileSystemEventHandler  # noqa: PLC0415
        from watchdog.observers import Observer  # noqa: PLC0415
    except ImportError:
        sys.exit("缺少 watchdog：pip install watchdog")

    watch_root = watch_root.expanduser().resolve()
    out_resolved = (watch_root / "output") if output_dir is None else Path(output_dir).resolve()
    handler_state = _VideoHandler(output_dir=output_dir, model_repo=model_repo, force=force)

    class Handler(FileSystemEventHandler):
        def on_created(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            p = Path(str(event.src_path)).resolve()
            if p.suffix.lower() not in VIDEO_EXT:
                return
            if out_resolved in p.parents or p.parent.resolve() == out_resolved:
                return
            handler_state._schedule(p)

        def on_moved(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            dest = getattr(event, "dest_path", None)
            if not dest:
                return
            p = Path(str(dest)).resolve()
            if p.suffix.lower() not in VIDEO_EXT:
                return
            if out_resolved in p.parents or p.parent.resolve() == out_resolved:
                return
            handler_state._schedule(p)

    observer = Observer()
    observer.schedule(Handler(), str(watch_root), recursive=False)
    observer.start()
    print(f"监听中：{watch_root}\n产出目录：{out_resolved}\nCtrl+C 结束", flush=True)
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("video", nargs="?", type=Path, help="单个视频路径")
    p.add_argument("--watch", type=Path, metavar="DIR", help="监听目录（收件箱），非递归")
    p.add_argument(
        "--output-dir",
        type=Path,
        help="产出目录（默认 <视频同级>/output 或监听目录/output）",
    )
    p.add_argument("--force", action="store_true", help="产物已存在时仍重跑")
    p.add_argument(
        "--model",
        default=WHISPER_MODEL,
        help=f"Hugging Face 上的 MLX Whisper 权重仓库（默认 {WHISPER_MODEL}）",
    )
    ns = p.parse_args(argv)

    if bool(ns.watch) == bool(ns.video):
        p.error("请二选一：提供 video，或传入 --watch <DIR>")
    return ns


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or sys.argv[1:])

    if args.watch:
        watch_loop(args.watch, output_dir=args.output_dir, model_repo=args.model, force=args.force)
        return

    video = Path(args.video).expanduser().resolve()
    if not video.is_file():
        sys.exit(f"文件不存在：{video}")
    process_video(video, output_dir=args.output_dir, model_repo=args.model, force=args.force)


if __name__ == "__main__":
    main()

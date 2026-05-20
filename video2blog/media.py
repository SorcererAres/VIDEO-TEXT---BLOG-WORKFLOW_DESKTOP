"""Media probing, extraction, and chunking helpers."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from video2blog.utils import append_log, shell_join


def probe_duration(path: Path, log_path: Path | None = None) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        append_log(log_path, "ffprobe not found; duration probe skipped")
        return None
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        append_log(log_path, f"ffprobe failed for {path}: {proc.stderr or proc.stdout}")
        return None
    try:
        return float(proc.stdout.strip())
    except ValueError:
        append_log(log_path, f"ffprobe returned invalid duration for {path}: {proc.stdout!r}")
        return None


def extract_audio(video: Path, wav: Path, log_path: Path | None = None) -> None:
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
    append_log(log_path, "ffmpeg extract start: " + shell_join(cmd))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        append_log(log_path, "ffmpeg extract failed:\n" + (proc.stderr or proc.stdout))
        sys.stderr.write(proc.stderr or proc.stdout or "ffmpeg 失败\n")
        sys.exit(proc.returncode)
    append_log(log_path, f"ffmpeg extract complete: {wav}")


def split_audio_for_chunks(
    wav: Path,
    *,
    work_dir: Path,
    segment_minutes: float,
    log_path: Path | None,
) -> list[tuple[Path, float]]:
    if segment_minutes <= 0:
        append_log(log_path, "audio chunking disabled")
        return [(wav, 0.0)]

    duration = probe_duration(wav, log_path)
    segment_seconds = segment_minutes * 60.0
    if duration is None or duration <= segment_seconds * 1.05:
        append_log(log_path, f"audio duration does not need chunking: duration={duration}")
        return [(wav, 0.0)]

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("未找到 ffmpeg，请先安装：brew install ffmpeg")

    chunk_dir = work_dir / "chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    pattern = chunk_dir / "chunk_%04d.wav"
    cmd = [
        ffmpeg,
        "-nostdin",
        "-y",
        "-i",
        str(wav),
        "-f",
        "segment",
        "-segment_time",
        f"{segment_seconds:.3f}",
        "-acodec",
        "pcm_s16le",
        str(pattern),
    ]
    append_log(log_path, "ffmpeg chunk start: " + shell_join(cmd))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        append_log(log_path, "ffmpeg chunk failed:\n" + (proc.stderr or proc.stdout))
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg 分段失败")

    chunks = sorted(chunk_dir.glob("chunk_*.wav"))
    if not chunks:
        raise RuntimeError("ffmpeg 分段未生成音频块")
    append_log(log_path, f"ffmpeg chunk complete: {len(chunks)} chunks, duration={duration:.2f}s")
    return [(chunk, idx * segment_seconds) for idx, chunk in enumerate(chunks)]

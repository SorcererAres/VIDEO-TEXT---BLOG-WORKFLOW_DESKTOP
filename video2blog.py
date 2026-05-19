#!/usr/bin/env python3
"""本地流水线 Step 1–2：ffmpeg 抽音频 → ASR 转录为 .srt / .txt。

博文 Markdown 不在此脚本生成；按 knowledge/工作流契约.md 由 Agent 执行 Step 3–8。

支持 **视频输入文件根**（`--input-root` 或环境变量 `VIDEO2BLOG_INPUT_ROOT`）：相对路径的单个文件与 `-w` 监听目录均先相对该根目录解析；`-w` 省略目录时直接监听该根。
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VIDEO_EXT = frozenset({".mp4", ".mov", ".mkv"})
EXTERNAL_TRANSCRIPT_EXT = frozenset({".srt", ".txt", ".md", ".vtt"})
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

# 脚本就在仓库根；五分结构下 ASR 产物默认进仓库中转侧 work/asr，
# 不再写到 <视频目录>/output（那会落回输入侧，破坏输入/中转分离）。
REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = REPO_ROOT / "work" / "asr"


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


def shell_join(args: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


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


def transcript_text_from_timed_text(text: str) -> str:
    """Extract readable text from SRT/VTT-like timed text."""
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            lines.append("")
            continue
        if line.upper() == "WEBVTT":
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if re.search(r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}", line):
            continue
        lines.append(line)
    return normalize_txt("\n".join(lines))


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


def plain_text_to_minimal_srt(plain: str) -> str:
    head = plain[:800].replace("\n", " ").strip()
    if not head:
        return ""
    return "1\n00:00:00,000 --> 00:00:07,500\n" f"{head}\n\n"


def append_log(log_path: Path | None, message: str) -> None:
    if log_path is None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().isoformat(timespec="seconds")
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(f"[{stamp}] {message}\n")


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    return str(value)


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


def transcribe_audio_mlx(
    wav: Path,
    model_repo: str,
    *,
    timeout_seconds: int,
    work_dir: Path,
    log_path: Path,
) -> dict[str, Any]:
    result_path = work_dir / f"{wav.stem}.mlx-result.json"
    error_path = work_dir / f"{wav.stem}.mlx-error.txt"
    for stale in (result_path, error_path):
        stale.unlink(missing_ok=True)

    worker_code = r'''
import contextlib
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return str(value)


wav, model_repo, result_path, error_path, log_path = sys.argv[1:6]
try:
    with Path(log_path).open("a", encoding="utf-8") as log_fh:
        log_fh.write(f"[{datetime.now().isoformat(timespec='seconds')}] mlx child start: {wav}\n")
        log_fh.flush()
        with contextlib.redirect_stdout(log_fh), contextlib.redirect_stderr(log_fh):
            import mlx_whisper

            raw = mlx_whisper.transcribe(
                wav,
                path_or_hf_repo=model_repo,
                word_timestamps=False,
                verbose=False,
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
            )
        log_fh.write(f"[{datetime.now().isoformat(timespec='seconds')}] mlx child complete: {wav}\n")
    Path(result_path).write_text(json.dumps(json_safe(raw), ensure_ascii=False), encoding="utf-8")
except BaseException:
    tb = traceback.format_exc()
    Path(error_path).write_text(tb, encoding="utf-8")
    with Path(log_path).open("a", encoding="utf-8") as log_fh:
        log_fh.write(f"[{datetime.now().isoformat(timespec='seconds')}] mlx child failed:\n{tb}\n")
    sys.exit(1)
'''

    cmd = [
        sys.executable,
        "-c",
        worker_code,
        str(wav),
        model_repo,
        str(result_path),
        str(error_path),
        str(log_path),
    ]
    append_log(log_path, f"mlx parent start: wav={wav}, timeout={timeout_seconds}s, worker=subprocess")
    with log_path.open("a", encoding="utf-8") as log_fh:
        proc = subprocess.Popen(cmd, stdout=log_fh, stderr=log_fh, text=True)
    try:
        proc.wait(timeout=None if timeout_seconds <= 0 else timeout_seconds)
    except subprocess.TimeoutExpired:
        append_log(log_path, f"mlx timeout after {timeout_seconds}s; terminating child pid={proc.pid}")
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            append_log(log_path, f"mlx child still alive after terminate; killing pid={proc.pid}")
            proc.kill()
            proc.wait(timeout=5)
        raise RuntimeError(f"mlx-whisper 超时（{timeout_seconds}s），详见日志：{log_path}")

    if error_path.exists():
        raise RuntimeError(error_path.read_text(encoding="utf-8", errors="replace").strip())
    if proc.returncode != 0:
        raise RuntimeError(f"mlx-whisper 子进程异常退出：exitcode={proc.returncode}，详见日志：{log_path}")
    if not result_path.exists():
        raise RuntimeError(f"mlx-whisper 未生成结果文件，详见日志：{log_path}")

    append_log(log_path, f"mlx parent complete: wav={wav}")
    return json.loads(result_path.read_text(encoding="utf-8"))


def transcribe_audio_mlx_chunked(
    wav: Path,
    model_repo: str,
    *,
    timeout_seconds: int,
    segment_minutes: float,
    work_dir: Path,
    log_path: Path,
) -> dict[str, Any]:
    chunks = split_audio_for_chunks(
        wav,
        work_dir=work_dir,
        segment_minutes=segment_minutes,
        log_path=log_path,
    )
    if len(chunks) == 1:
        return transcribe_audio_mlx(
            chunks[0][0],
            model_repo,
            timeout_seconds=timeout_seconds,
            work_dir=work_dir,
            log_path=log_path,
        )

    texts: list[str] = []
    segments: list[dict[str, Any]] = []
    for idx, (chunk, offset) in enumerate(chunks, start=1):
        print(f"    MLX chunk {idx}/{len(chunks)} → {chunk.name}", flush=True)
        append_log(log_path, f"mlx chunk {idx}/{len(chunks)} start: {chunk}, offset={offset:.3f}s")
        result = transcribe_audio_mlx(
            chunk,
            model_repo,
            timeout_seconds=timeout_seconds,
            work_dir=work_dir,
            log_path=log_path,
        )
        text = normalize_txt(str(result.get("text") or ""))
        if text:
            texts.append(text)
        for raw_seg in result.get("segments") or []:
            if not isinstance(raw_seg, dict):
                continue
            seg = dict(raw_seg)
            start = float(seg.get("start", 0.0) or 0.0)
            end = float(seg.get("end", start) or start)
            seg["start"] = start + offset
            seg["end"] = end + offset
            segments.append(seg)
        append_log(log_path, f"mlx chunk {idx}/{len(chunks)} complete")

    return {
        "text": normalize_txt("\n".join(texts)),
        "segments": segments,
        "chunk_count": len(chunks),
        "segment_minutes": segment_minutes,
    }


def resolve_whisper_cpp_bin(explicit_bin: str | None) -> str | None:
    candidates = []
    if explicit_bin:
        candidates.append(explicit_bin)
    if WHISPER_CPP_BIN:
        candidates.append(WHISPER_CPP_BIN)
    candidates.extend(["whisper-cli", "whisper-cpp", "main"])
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
        p = Path(candidate).expanduser()
        if p.is_file():
            return str(p.resolve())
    return None


def transcribe_audio_whisper_cpp(
    wav: Path,
    *,
    model_path: Path | None,
    whisper_cpp_bin: str | None,
    log_path: Path | None = None,
) -> dict[str, Any]:
    if model_path is None:
        raise RuntimeError(
            "缺少 whisper.cpp 模型：请传 --whisper-cpp-model /path/to/ggml-*.bin，"
            "或设置 VIDEO2BLOG_WHISPER_CPP_MODEL"
        )
    model_path = model_path.expanduser().resolve()
    if not model_path.is_file():
        raise RuntimeError(f"whisper.cpp 模型不存在：{model_path}")

    binary = resolve_whisper_cpp_bin(whisper_cpp_bin)
    if not binary:
        raise RuntimeError(
            "未找到 whisper.cpp 命令：请 brew install whisper-cpp，"
            "或用 --whisper-cpp-bin 指定 whisper-cli 路径"
        )

    with tempfile.TemporaryDirectory(prefix="video2blog_whisper_cpp_") as td_tmp:
        out_prefix = Path(td_tmp) / "transcript"
        cmd = [
            binary,
            "-m",
            str(model_path),
            "-f",
            str(wav),
            "-l",
            "auto",
            "-otxt",
            "-osrt",
            "-of",
            str(out_prefix),
        ]
        append_log(log_path, "whisper.cpp start: " + shell_join(cmd))
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            append_log(log_path, "whisper.cpp failed:\n" + (proc.stderr or proc.stdout))
            raise RuntimeError(proc.stderr or proc.stdout or "whisper.cpp 转录失败")
        append_log(log_path, "whisper.cpp complete")

        txt_candidates = [out_prefix.with_suffix(".txt"), Path(f"{out_prefix}.txt")]
        srt_candidates = [out_prefix.with_suffix(".srt"), Path(f"{out_prefix}.srt")]
        txt_path = next((p for p in txt_candidates if p.exists()), None)
        srt_path = next((p for p in srt_candidates if p.exists()), None)
        if txt_path is None and srt_path is None:
            raise RuntimeError("whisper.cpp 未生成 .txt 或 .srt 产物")

        plain = txt_path.read_text(encoding="utf-8", errors="replace") if txt_path else ""
        srt_body = srt_path.read_text(encoding="utf-8", errors="replace") if srt_path else ""
        if not plain and srt_body:
            plain = transcript_text_from_timed_text(srt_body)
        if not srt_body and plain:
            srt_body = plain_text_to_minimal_srt(normalize_txt(plain))
        return {
            "text": normalize_txt(plain),
            "srt": srt_body,
            "engine_meta": {
                "engine": "whisper-cpp",
                "model": str(model_path),
                "binary": binary,
                "confidence": "native_asr",
            },
        }


def load_external_transcript(source: Path) -> dict[str, Any]:
    source = source.expanduser().resolve()
    if not source.is_file():
        raise RuntimeError(f"外部文字稿不存在：{source}")
    if source.suffix.lower() not in EXTERNAL_TRANSCRIPT_EXT:
        raise RuntimeError(f"外部文字稿格式不支持：{source.suffix}")

    body = source.read_text(encoding="utf-8", errors="replace")
    if source.suffix.lower() in {".srt", ".vtt"}:
        plain = transcript_text_from_timed_text(body)
        srt_body = body if source.suffix.lower() == ".srt" else plain_text_to_minimal_srt(plain)
    else:
        plain = normalize_txt(body)
        srt_body = plain_text_to_minimal_srt(plain)
    return {
        "text": plain,
        "srt": srt_body,
        "engine_meta": {
            "engine": "external",
            "source": str(source),
            "confidence": "external_source",
            "requires_review": True,
        },
    }


def normalize_transcription_result(result: dict[str, Any]) -> tuple[str, str]:
    if "srt" in result:
        plain = normalize_txt(str(result.get("text") or ""))
        srt_body = str(result.get("srt") or "")
        return plain, srt_body

    segments: list[dict] = result.get("segments") or []
    plain = normalize_txt(str(result.get("text") or ""))
    if not plain and segments:
        plain = normalize_txt("".join(str(s.get("text") or "") for s in segments))

    srt_body = segments_to_srt(segments)
    if not srt_body.strip() and plain:
        srt_body = plain_text_to_minimal_srt(plain)
    return plain, srt_body


def write_meta(
    meta_path: Path,
    *,
    video: Path,
    txt_path: Path,
    srt_path: Path,
    log_path: Path,
    engine_meta: dict[str, Any],
    engine_requested: str,
    fallback_policy: str,
    execution_context: str,
) -> None:
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_video": str(video),
        "txt": str(txt_path),
        "srt": str(srt_path),
        "log": str(log_path),
        "engine_requested": engine_requested,
        "fallback_policy": fallback_policy,
        "execution_context": execution_context,
        **engine_meta,
    }
    meta_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def output_paths(video: Path, output_dir: Path | None) -> Path:
    base = DEFAULT_OUTPUT_DIR if output_dir is None else Path(output_dir)
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
    engine: str,
    whisper_cpp_model: Path | None,
    whisper_cpp_bin: str | None,
    external_source: Path | None,
    fallback_policy: str,
    terminal_command: list[str] | None,
    mlx_timeout_seconds: int,
    segment_minutes: float,
    force: bool,
) -> None:
    if video.suffix.lower() not in VIDEO_EXT:
        print(f"跳过（非支持格式 {sorted(VIDEO_EXT)}）：{video}", file=sys.stderr)
        return

    out_root = output_paths(video, output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    # iCloud Drive 会在转录的几分钟里把"空目录"驱逐；先放一颗哨兵文件占位。
    sentinel = out_root / ".video2blog-keepalive"
    sentinel.write_text("placeholder during transcription\n", encoding="utf-8")
    stem = video.stem
    txt_path = out_root / f"{stem}.txt"
    srt_path = out_root / f"{stem}.srt"
    meta_path = out_root / f"{stem}.meta.json"
    log_path = out_root / f"{stem}.log"
    if not force and txt_path.exists() and srt_path.exists():
        print(f"跳过（产物已存在，使用 --force 重跑）：{txt_path}", file=sys.stderr)
        sentinel.unlink(missing_ok=True)
        return

    try:
        append_log(
            log_path,
            (
                "process start: "
                f"video={video}, engine={engine}, fallback_policy={fallback_policy}, "
                f"mlx_timeout_seconds={mlx_timeout_seconds}, segment_minutes={segment_minutes}"
            ),
        )
        if engine == "external":
            if external_source is None:
                sys.exit("使用 --engine external 时必须传 --source <.srt|.txt|.md|.vtt>")
            print(f"[1/3] external → {external_source}", flush=True)
            append_log(log_path, f"external source start: {external_source}")
            result = load_external_transcript(external_source)
            append_log(log_path, "external source complete")
        else:
            with tempfile.TemporaryDirectory(prefix="video2blog_") as td_tmp:
                wav = Path(td_tmp) / "audio.wav"
                print(f"[1/3] ffmpeg → {wav.name}: {video.name}", flush=True)
                extract_audio(video, wav, log_path)

                failures: list[str] = []
                result = None
                if engine in {"auto", "mlx"}:
                    try:
                        print(f"[2/3] mlx-whisper `{model_repo}` …", flush=True)
                        result = transcribe_audio_mlx_chunked(
                            wav,
                            model_repo,
                            timeout_seconds=mlx_timeout_seconds,
                            segment_minutes=segment_minutes,
                            work_dir=Path(td_tmp),
                            log_path=log_path,
                        )
                        result["engine_meta"] = {
                            "engine": "mlx-whisper",
                            "model": model_repo,
                            "confidence": "native_asr",
                            "chunk_count": result.get("chunk_count", 1),
                            "segment_minutes": result.get("segment_minutes", 0),
                            "timeout_seconds": mlx_timeout_seconds,
                        }
                    except Exception as exc:  # noqa: BLE001 - report and optionally fall back
                        message = f"mlx-whisper 不可用：{exc}"
                        append_log(log_path, message)
                        if engine == "mlx":
                            raise RuntimeError(message) from exc
                        failures.append(message)
                        if fallback_policy == "stop":
                            raise RuntimeError(message) from exc
                        if fallback_policy == "ask":
                            choice = prompt_fallback_action(message, terminal_command)
                            if choice == "1":
                                if terminal_command is None:
                                    raise RuntimeError("无法生成普通 macOS Terminal 命令")
                                launch_in_macos_terminal(terminal_command, Path.cwd())
                                print("已在普通 macOS Terminal 启动 mlx-whisper 转录。", flush=True)
                                return
                            if choice == "3":
                                raise RuntimeError("请改用 --engine external --source <.srt|.txt|.md|.vtt>")
                            if choice == "4":
                                raise RuntimeError("用户选择退出")
                            print("用户选择 fallback 到 whisper.cpp …", file=sys.stderr, flush=True)
                        else:
                            print(f"{message}\n尝试 fallback 到 whisper.cpp …", file=sys.stderr, flush=True)

                if result is None and engine in {"auto", "whisper-cpp"}:
                    try:
                        print("[2/3] whisper.cpp …", flush=True)
                        result = transcribe_audio_whisper_cpp(
                            wav,
                            model_path=whisper_cpp_model,
                            whisper_cpp_bin=whisper_cpp_bin,
                            log_path=log_path,
                        )
                    except Exception as exc:  # noqa: BLE001
                        failures.append(f"whisper.cpp 不可用：{exc}")
                        append_log(log_path, f"whisper.cpp 不可用：{exc}")
                        raise RuntimeError("\n".join(failures)) from exc

                if result is None:
                    raise RuntimeError("没有可用转录引擎")

        plain, srt_body = normalize_transcription_result(result)
        if not plain.strip():
            raise RuntimeError("转录结果为空")

        # 防御性再 mkdir：iCloud Drive 偶发在长任务中驱逐空目录
        out_root.mkdir(parents=True, exist_ok=True)
        txt_path.write_text(plain + "\n", encoding="utf-8")
        srt_path.write_text(srt_body, encoding="utf-8")
        write_meta(
            meta_path,
            video=video,
            txt_path=txt_path,
            srt_path=srt_path,
            log_path=log_path,
            engine_meta=result.get("engine_meta") or {},
            engine_requested=engine,
            fallback_policy=fallback_policy,
            execution_context="current_process",
        )
        print(f"[3/3] 完成 → {txt_path}\n           {srt_path}\n           {meta_path}", flush=True)
        append_log(log_path, f"process complete: txt={txt_path}, srt={srt_path}, meta={meta_path}")
    finally:
        sentinel.unlink(missing_ok=True)


class _VideoHandler:
    """watchdog：新视频落盘稳定后异步转写。"""

    def __init__(
        self,
        *,
        output_dir: Path | None,
        model_repo: str,
        engine: str,
        whisper_cpp_model: Path | None,
        whisper_cpp_bin: str | None,
        fallback_policy: str,
        mlx_timeout_seconds: int,
        segment_minutes: float,
        force: bool,
    ) -> None:
        self._locks: dict[Path, threading.Lock] = {}
        self._output_dir = output_dir
        self._model_repo = model_repo
        self._engine = engine
        self._whisper_cpp_model = whisper_cpp_model
        self._whisper_cpp_bin = whisper_cpp_bin
        self._fallback_policy = fallback_policy
        self._mlx_timeout_seconds = mlx_timeout_seconds
        self._segment_minutes = segment_minutes
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
                    engine=self._engine,
                    whisper_cpp_model=self._whisper_cpp_model,
                    whisper_cpp_bin=self._whisper_cpp_bin,
                    external_source=None,
                    fallback_policy=self._fallback_policy,
                    terminal_command=None,
                    mlx_timeout_seconds=self._mlx_timeout_seconds,
                    segment_minutes=self._segment_minutes,
                    force=self._force,
                )
            finally:
                lock.release()

        threading.Thread(target=run, daemon=True).start()


def watch_loop(
    watch_root: Path,
    *,
    output_dir: Path | None,
    model_repo: str,
    engine: str,
    whisper_cpp_model: Path | None,
    whisper_cpp_bin: str | None,
    fallback_policy: str,
    mlx_timeout_seconds: int,
    segment_minutes: float,
    force: bool,
) -> None:
    try:
        from watchdog.events import FileSystemEventHandler  # noqa: PLC0415
        from watchdog.observers import Observer  # noqa: PLC0415
    except ImportError:
        sys.exit("缺少 watchdog：pip install watchdog")

    watch_root = watch_root.expanduser().resolve()
    out_resolved = DEFAULT_OUTPUT_DIR if output_dir is None else Path(output_dir).resolve()
    handler_state = _VideoHandler(
        output_dir=output_dir,
        model_repo=model_repo,
        engine=engine,
        whisper_cpp_model=whisper_cpp_model,
        whisper_cpp_bin=whisper_cpp_bin,
        fallback_policy=fallback_policy,
        mlx_timeout_seconds=mlx_timeout_seconds,
        segment_minutes=segment_minutes,
        force=force,
    )

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
    p.add_argument(
        "video",
        nargs="?",
        default=None,
        type=str,
        metavar="VIDEO",
        help="单个视频文件路径（可与输入根组合成绝对路径）",
    )
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
        help="产出目录（默认仓库内 work/asr/，五分结构中转侧；显式指定可覆盖）",
    )
    p.add_argument("--force", action="store_true", help="产物已存在时仍重跑")
    p.add_argument(
        "--engine",
        choices=ENGINE_CHOICES,
        default=DEFAULT_ENGINE if DEFAULT_ENGINE in ENGINE_CHOICES else "auto",
        help=(
            "转录引擎：auto 先试 mlx，失败后按 --fallback-policy 处理；"
            "external 用 --source 指定已有文字稿/字幕"
        ),
    )
    p.add_argument(
        "--fallback-policy",
        choices=FALLBACK_POLICY_CHOICES,
        default=DEFAULT_FALLBACK_POLICY if DEFAULT_FALLBACK_POLICY in FALLBACK_POLICY_CHOICES else "ask",
        help="mlx 在 auto 模式下不可用时如何处理：ask 默认询问，auto 自动降级，stop 直接停止",
    )
    p.add_argument(
        "--model",
        default=WHISPER_MODEL,
        help=f"Hugging Face 上的 MLX Whisper 权重仓库（默认 {WHISPER_MODEL}）",
    )
    p.add_argument(
        "--mlx-timeout-seconds",
        type=int,
        default=DEFAULT_MLX_TIMEOUT_SECONDS,
        help=(
            "单个 MLX 转录子进程的超时秒数；0 表示不设超时。"
            f"默认 {DEFAULT_MLX_TIMEOUT_SECONDS}，可用 VIDEO2BLOG_MLX_TIMEOUT_SECONDS 覆盖"
        ),
    )
    p.add_argument(
        "--segment-minutes",
        type=float,
        default=DEFAULT_SEGMENT_MINUTES,
        help=(
            "MLX 转录前按多少分钟切分长音频；0 表示不分段。"
            f"默认 {DEFAULT_SEGMENT_MINUTES:g}，可用 VIDEO2BLOG_SEGMENT_MINUTES 覆盖"
        ),
    )
    p.add_argument(
        "--whisper-cpp-model",
        type=Path,
        default=Path(WHISPER_CPP_MODEL).expanduser() if WHISPER_CPP_MODEL else None,
        help="whisper.cpp ggml 模型路径；也可用 VIDEO2BLOG_WHISPER_CPP_MODEL",
    )
    p.add_argument(
        "--whisper-cpp-bin",
        default=WHISPER_CPP_BIN or None,
        help="whisper.cpp 命令路径；默认查找 whisper-cli / whisper-cpp / main",
    )
    p.add_argument(
        "--source",
        type=Path,
        help="--engine external 时使用的已有 .srt/.txt/.md/.vtt",
    )
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
            model_repo=args.model,
            engine=args.engine,
            whisper_cpp_model=args.whisper_cpp_model,
            whisper_cpp_bin=args.whisper_cpp_bin,
            fallback_policy=args.fallback_policy,
            mlx_timeout_seconds=args.mlx_timeout_seconds,
            segment_minutes=args.segment_minutes,
            force=args.force,
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
    )


if __name__ == "__main__":
    main()

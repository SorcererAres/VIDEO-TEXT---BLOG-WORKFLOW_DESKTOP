"""Raw transcription pipeline orchestration."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Callable

from video2blog.asr.external import load_external_transcript
from video2blog.asr.mlx import transcribe_audio_mlx_chunked
from video2blog.asr.whisper_cpp import transcribe_audio_whisper_cpp
from video2blog.media import extract_audio
from video2blog.output import output_paths, write_meta
from video2blog.transcript import normalize_transcription_result
from video2blog.utils import append_log, atomic_write

VIDEO_EXT = frozenset({".mp4", ".mov", ".mkv"})


def process_video(
    video: Path,
    *,
    output_dir: Path | None,
    default_output_dir: Path,
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
    prompt_fallback_action: Callable[[str, list[str] | None], str],
    launch_in_macos_terminal: Callable[[list[str], Path], None],
) -> None:
    if video.suffix.lower() not in VIDEO_EXT:
        print(f"跳过（非支持格式 {sorted(VIDEO_EXT)}）：{video}", file=sys.stderr)
        return

    out_root = output_paths(video, output_dir, default_output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    sentinel = out_root / ".video2blog-keepalive"
    sentinel.write_text("placeholder during transcription\n", encoding="utf-8")
    txt_path = out_root / "raw.txt"
    srt_path = out_root / "raw.srt"
    meta_path = out_root / "meta.json"
    log_path = out_root / "raw.log"
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

        out_root.mkdir(parents=True, exist_ok=True)
        atomic_write(txt_path, plain + "\n")
        atomic_write(srt_path, srt_body)
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

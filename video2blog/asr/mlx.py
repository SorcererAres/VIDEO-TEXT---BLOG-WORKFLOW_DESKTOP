"""MLX Whisper transcription engine."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from video2blog.media import split_audio_for_chunks
from video2blog.transcript import normalize_txt
from video2blog.utils import append_log, atomic_write


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def _mlx_worker_main(argv: list[str]) -> int:
    """mlx 转录 worker 子进程入口：import mlx_whisper 跑转录，结果/错误写文件。

    隔离子进程跑（mlx Metal 是最大不稳定源，崩溃/OOM/超时不波及主进程）。
    - dev：经 `python -c "...; _mlx_worker_main(sys.argv[1:])"` 调（sys.executable 是 python）。
    - frozen：经 server 二进制 `mlx-worker` 子命令调（frozen 下 sys.executable 是
      server 二进制，不支持 python -c）。
    argv: [wav, model_repo, result_path, error_path, log_path]
    """
    import contextlib
    import traceback
    from datetime import datetime

    wav, model_repo, result_path, error_path, log_path = argv[:5]
    try:
        with Path(log_path).open("a", encoding="utf-8") as log_fh:
            log_fh.write(
                f"[{datetime.now().isoformat(timespec='seconds')}] mlx child start: {wav}\n"
            )
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
            log_fh.write(
                f"[{datetime.now().isoformat(timespec='seconds')}] mlx child complete: {wav}\n"
            )
        atomic_write(Path(result_path), json.dumps(_json_safe(raw), ensure_ascii=False))
        return 0
    except BaseException:
        tb = traceback.format_exc()
        atomic_write(Path(error_path), tb)
        with Path(log_path).open("a", encoding="utf-8") as log_fh:
            log_fh.write(
                f"[{datetime.now().isoformat(timespec='seconds')}] mlx child failed:\n{tb}\n"
            )
        return 1


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

    worker_args = [str(wav), model_repo, str(result_path), str(error_path), str(log_path)]
    if getattr(sys, "frozen", False):
        # 打包版：sys.executable 是 server 二进制，经 mlx-worker 子命令跑 worker。
        cmd = [sys.executable, "mlx-worker", *worker_args]
    else:
        # 开发态：python -c 调本模块的 worker（不再内联大段字符串）。
        cmd = [
            sys.executable,
            "-c",
            "import sys; from video2blog.asr.mlx import _mlx_worker_main;"
            " sys.exit(_mlx_worker_main(sys.argv[1:]))",
            *worker_args,
        ]
    append_log(
        log_path, f"mlx parent start: wav={wav}, timeout={timeout_seconds}s, worker=subprocess"
    )
    with log_path.open("a", encoding="utf-8") as log_fh:
        proc = subprocess.Popen(cmd, stdout=log_fh, stderr=log_fh, text=True)
    try:
        proc.wait(timeout=None if timeout_seconds <= 0 else timeout_seconds)
    except subprocess.TimeoutExpired:
        append_log(
            log_path, f"mlx timeout after {timeout_seconds}s; terminating child pid={proc.pid}"
        )
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            append_log(log_path, f"mlx child still alive after terminate; killing pid={proc.pid}")
            proc.kill()
            proc.wait(timeout=5)
        raise RuntimeError(
            f"mlx-whisper 超时（{timeout_seconds}s），详见日志：{log_path}"
        ) from None

    if error_path.exists():
        raise RuntimeError(error_path.read_text(encoding="utf-8", errors="replace").strip())
    if proc.returncode != 0:
        raise RuntimeError(
            f"mlx-whisper 子进程异常退出：exitcode={proc.returncode}，详见日志：{log_path}"
        )
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

"""whisper.cpp transcription engine."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from video2blog.transcript import (
    normalize_txt,
    plain_text_to_minimal_srt,
    transcript_text_from_timed_text,
)
from video2blog.utils import append_log, shell_join


def resolve_whisper_cpp_bin(explicit_bin: str | None) -> str | None:
    candidates = []
    if explicit_bin:
        candidates.append(explicit_bin)
    env_bin = os.environ.get("VIDEO2BLOG_WHISPER_CPP_BIN", "").strip()
    if env_bin:
        candidates.append(env_bin)
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

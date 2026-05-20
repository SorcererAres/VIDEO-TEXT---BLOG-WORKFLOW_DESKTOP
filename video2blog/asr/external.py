"""External transcript loader."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from video2blog.transcript import (
    normalize_txt,
    plain_text_to_minimal_srt,
    transcript_text_from_timed_text,
)

EXTERNAL_TRANSCRIPT_EXT = frozenset({".srt", ".txt", ".md", ".vtt"})


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

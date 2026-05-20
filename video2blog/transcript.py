"""Transcript normalization and timed-text conversion helpers."""

from __future__ import annotations

import re
from typing import Any


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

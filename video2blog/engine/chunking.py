"""Deterministic text chunking helpers for long transcript workflow steps."""

from __future__ import annotations

import re
from dataclasses import dataclass

try:
    from scripts.update_fingerprint import SENTENCE_RE
except ImportError:  # pragma: no cover - scripts package may be excluded in installs.
    SENTENCE_RE = re.compile(r"[^。！？!?]+[。！？!?]?")


@dataclass(frozen=True)
class TextChunk:
    index: int
    total: int
    text: str
    previous_context: str


def split_text_chunks(text: str, max_chars: int, context_chars: int) -> list[TextChunk]:
    """Split text on sentence boundaries, carrying previous context as read-only input."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []
    if max_chars <= 0 or len(normalized) <= max_chars:
        return [TextChunk(index=1, total=1, text=normalized, previous_context="")]

    sentences = [s.strip() for s in SENTENCE_RE.findall(normalized) if s.strip()]
    if not sentences:
        sentences = [p.strip() for p in re.split(r"\n\s*\n", normalized) if p.strip()] or [
            normalized
        ]

    raw_chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        sentence_len = len(sentence)
        if current and current_len + sentence_len + 1 > max_chars:
            raw_chunks.append("\n".join(current).strip())
            current = [sentence]
            current_len = sentence_len
        else:
            current.append(sentence)
            current_len += sentence_len + 1

        # Very long sentence fallback: split deterministically by hard length.
        if len(current) == 1 and current_len > max_chars:
            long = current.pop()
            for start in range(0, len(long), max_chars):
                raw_chunks.append(long[start : start + max_chars].strip())
            current_len = 0

    if current:
        raw_chunks.append("\n".join(current).strip())

    chunks: list[TextChunk] = []
    total = len(raw_chunks)
    previous_text = ""
    for idx, chunk in enumerate(raw_chunks, start=1):
        context = previous_text[-context_chars:] if context_chars > 0 else ""
        chunks.append(TextChunk(index=idx, total=total, text=chunk, previous_context=context))
        previous_text = chunk
    return chunks


def chunk_prompt(chunk: TextChunk, step_label: str) -> str:
    """Build chunk-specific input with read-only prior context and current output scope."""
    parts = [
        "### 分块执行说明",
        f"这是 {step_label} 的第 {chunk.index}/{chunk.total} 个分块。",
        "上一分块尾部上下文只用于理解指代和转折，禁止把上下文内容重复输出。",
        "只处理“当前分块正文”里的新增内容，并严格遵守本步骤输出格式。",
        "",
    ]
    if chunk.previous_context:
        parts.extend(["### 上一分块尾部上下文（只读，不要重复输出）", chunk.previous_context, ""])
    parts.extend(["### 当前分块正文", chunk.text])
    return "\n".join(parts)

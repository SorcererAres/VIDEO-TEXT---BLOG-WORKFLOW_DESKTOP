#!/usr/bin/env python3
"""Generate paragraph-level style fingerprints for published posts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]*|[\u4e00-\u9fff]+")
SENTENCE_RE = re.compile(r"[^。！？!?]+[。！？!?]?")
STOP_TERMS = {
    "这个",
    "一个",
    "我们",
    "他们",
    "自己",
    "不是",
    "就是",
    "如果",
    "因为",
    "所以",
    "但是",
    "可以",
}


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---", 4)
    return text[end + 4 :] if end != -1 else text


def title_from_text(text: str, path: Path) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def extract_terms(text: str) -> list[str]:
    terms: list[str] = []
    for raw in WORD_RE.findall(text):
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", raw):
            terms.append(raw)
            continue
        if len(raw) == 2:
            terms.append(raw)
            continue
        for idx in range(0, len(raw) - 1):
            terms.append(raw[idx : idx + 2])
    return [term for term in terms if term not in STOP_TERMS and not term.startswith("video2blog")]


def fingerprint(path: Path, repo: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    body = strip_frontmatter(text)
    paragraphs = [
        p.strip()
        for p in re.split(r"\n\s*\n", body)
        if p.strip() and not p.strip().startswith("<!--") and not p.strip().startswith("#")
    ]
    sentences = [s.strip() for s in SENTENCE_RE.findall("\n".join(paragraphs)) if s.strip()]
    sentence_lengths = [len(re.sub(r"\s+", "", s)) for s in sentences]
    paragraph_lengths = [len(re.sub(r"\s+", "", p)) for p in paragraphs]
    terms = extract_terms("\n".join(paragraphs))
    top_terms = [term for term, _ in Counter(terms).most_common(20)]
    return {
        "path": str(path.relative_to(repo) if path.is_relative_to(repo) else path),
        "title": title_from_text(body, path),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paragraph_count": len(paragraphs),
        "avg_paragraph_len": round(sum(paragraph_lengths) / len(paragraph_lengths), 2)
        if paragraph_lengths
        else 0,
        "sentence_count": len(sentences),
        "avg_sentence_len": round(sum(sentence_lengths) / len(sentence_lengths), 2)
        if sentence_lengths
        else 0,
        "opening": sentences[0][:80] if sentences else "",
        "top_terms": top_terms,
    }


def upsert_jsonl(path: Path, record: dict) -> None:
    records: list[dict] = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
    records = [item for item in records if item.get("path") != record["path"]]
    records.append(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False, sort_keys=True) for item in records) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("post", type=Path)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    post = args.post if args.post.is_absolute() else repo / args.post
    if not post.exists():
        print(f"post not found: {post}", file=sys.stderr)
        return 2
    out = args.output or repo / "memory/fingerprints.jsonl"
    record = fingerprint(post.resolve(), repo)
    upsert_jsonl(out, record)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Static validation for the Video2Blog workflow repository."""

from __future__ import annotations

import argparse
import re
import sys
import json
from pathlib import Path

PLACEHOLDER_RE = re.compile(r"_{4,}|YYYY-MM-DD|\[(?:填写|TODO|占位)\]")
VIEWER_RE = re.compile(r"我看完|这场分享让我|我作为读者|编者按|补充观察|我抄走")
REQUIRED_FRONTMATTER = {"title", "date", "entry", "mode", "routing", "speaker", "source", "pass_score"}
ENTRY_CHOICES = {"video", "transcript"}
MODE_CHOICES = {"full", "quick"}
ROUTING_CHOICES = {"/default", "/lecture", "/dialogue", "/screencast", "/meeting"}
PASS_SCORE_RE = re.compile(r"^\d{1,2}/60$")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def strip_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    data: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            data[key.strip()] = value.strip()
    return data, text[end + 4 :]


def is_draft_post(path: Path) -> bool:
    return path.name.startswith("DRAFT-")


def markdown_rows(path: Path) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in read(path).splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and not all(re.fullmatch(r"-+", cell) for cell in cells):
            rows.append(cells)
    return rows


def check_placeholders(repo: Path, errors: list[str]) -> None:
    for rel in ("memory/PREFERENCES.md", "memory/CONFIG.md", "memory/HISTORY.md"):
        path = repo / rel
        if not path.exists():
            errors.append(f"missing {rel}")
            continue
        for lineno, line in enumerate(read(path).splitlines(), start=1):
            if line.strip().startswith(">") or line.strip().startswith("```"):
                continue
            if PLACEHOLDER_RE.search(line):
                errors.append(f"placeholder {rel}:{lineno}: {line.strip()}")


def check_workflow_docs(repo: Path, errors: list[str]) -> None:
    workflow = repo / "WORKFLOW.md"
    if not workflow.exists():
        errors.append("missing WORKFLOW.md")
    elif len(read(workflow).splitlines()) > 70:
        errors.append("WORKFLOW.md exceeds 70 lines")
    for rel in ("AGENTS.md", "CLAUDE.md"):
        text = read(repo / rel) if (repo / rel).exists() else ""
        if "knowledge/ROUTER.md" in text or "knowledge/工作流契约.md" in text:
            errors.append(f"{rel} still references old workflow docs")


def check_history(repo: Path, errors: list[str]) -> None:
    path = repo / "memory/HISTORY.md"
    if not path.exists():
        errors.append("missing memory/HISTORY.md")
        return
    rows = [
        row
        for row in markdown_rows(path)
        if row and row[0] not in {"日期", "---"} and not row[0].startswith("-")
    ]
    if len(rows) > 10:
        errors.append(f"memory/HISTORY.md has {len(rows)} records; max is 10")
    for idx, row in enumerate(rows, start=1):
        if len(row) < 5 or not row[4]:
            errors.append(f"memory/HISTORY.md row {idx} missing post path")


def check_posts(repo: Path, errors: list[str], *, lenient: bool) -> None:
    posts_root = repo / "output/Posts"
    if not posts_root.exists():
        return
    for path in posts_root.glob("**/*.md"):
        data, body = strip_frontmatter(read(path))
        if lenient and (not data or REQUIRED_FRONTMATTER - set(data)):
            continue
        missing = sorted(REQUIRED_FRONTMATTER - set(data))
        if missing:
            errors.append(f"{path.relative_to(repo)} missing frontmatter: {', '.join(missing)}")
            continue
        if data["entry"] not in ENTRY_CHOICES:
            errors.append(f"{path.relative_to(repo)} invalid entry: {data['entry']}")
        if data["mode"] not in MODE_CHOICES:
            errors.append(f"{path.relative_to(repo)} invalid mode: {data['mode']}")
        if data["routing"] not in ROUTING_CHOICES:
            errors.append(f"{path.relative_to(repo)} invalid routing: {data['routing']}")
        if not data["source"]:
            errors.append(f"{path.relative_to(repo)} empty source")
        if not PASS_SCORE_RE.fullmatch(data["pass_score"]):
            errors.append(f"{path.relative_to(repo)} invalid pass_score: {data['pass_score']}")
        if VIEWER_RE.search(body):
            errors.append(f"{path.relative_to(repo)} contains viewer/editor viewpoint phrase")


def check_fingerprints(repo: Path, errors: list[str]) -> None:
    posts_root = repo / "output/Posts"
    fingerprints_path = repo / "memory/fingerprints.jsonl"
    if not posts_root.exists():
        return
    if not fingerprints_path.exists():
        errors.append("missing memory/fingerprints.jsonl")
        return

    records: set[str] = set()
    for lineno, line in enumerate(read(fingerprints_path).splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"invalid memory/fingerprints.jsonl:{lineno}: {exc}")
            continue
        path = record.get("path")
        if isinstance(path, str) and path:
            records.add(path)

    for path in posts_root.glob("**/*.md"):
        if is_draft_post(path):
            continue
        rel = str(path.relative_to(repo))
        if rel not in records:
            errors.append(f"{rel} missing fingerprint record")


def check_reviews(repo: Path, errors: list[str]) -> None:
    reviews_root = repo / "output/Reviews"
    if not reviews_root.exists():
        return
    for path in reviews_root.glob("*.review.md"):
        text = read(path)
        if "## 评分" not in text or "## Re-Brief" not in text:
            errors.append(f"{path.relative_to(repo)} missing score table or Re-Brief")


def check_work_stage(repo: Path, errors: list[str]) -> None:
    work = repo / "work"
    if not work.exists():
        return
    for meta in work.glob("*/meta.json"):
        text = read(meta)
        if '"stages"' not in text:
            errors.append(f"{meta.relative_to(repo)} missing stages field")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--lenient", action="store_true", help="skip posts with incomplete frontmatter")
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    errors: list[str] = []
    check_placeholders(repo, errors)
    check_workflow_docs(repo, errors)
    check_history(repo, errors)
    check_posts(repo, errors, lenient=args.lenient)
    check_fingerprints(repo, errors)
    check_reviews(repo, errors)
    check_work_stage(repo, errors)
    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

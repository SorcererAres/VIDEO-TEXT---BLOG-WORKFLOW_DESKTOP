#!/usr/bin/env python3
"""Normalize published post frontmatter for the current Video2Blog contract."""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

FIELD_ORDER = ("title", "date", "entry", "mode", "routing", "speaker", "source", "pass_score")
REMOVED_FIELDS = {"structure", "style", "style_guide"}
DEFAULTS = {"mode": "full"}


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Return loose YAML-ish frontmatter data and body.

    Some legacy posts have malformed frontmatter (for example, `## title:` and
    no closing fence). This parser is deliberately forgiving so migration can
    repair those files without touching the article body.
    """
    if not text.startswith("---\n"):
        return {}, text

    lines = text.splitlines(keepends=True)
    end_idx: int | None = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end_idx = idx
            break

    if end_idx is None:
        for idx in range(1, len(lines)):
            stripped = lines[idx].lstrip()
            if stripped.startswith("# ") or stripped.startswith("<!--"):
                end_idx = idx
                break

    if end_idx is None:
        return {}, text

    raw_frontmatter = lines[1:end_idx]
    body_start = end_idx + 1 if lines[end_idx].strip() == "---" else end_idx
    data: dict[str, str] = {}
    for raw_line in raw_frontmatter:
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r"^#+\s*", "", line)
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        data[key] = value

    body = "".join(lines[body_start:])
    return data, body


def yaml_value(value: str) -> str:
    if value == "":
        return '""'
    if re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        return value
    return json.dumps(value, ensure_ascii=False)


def normalize_post_text(text: str) -> str:
    data, body = split_frontmatter(text)
    for field in REMOVED_FIELDS:
        data.pop(field, None)
    for key, value in DEFAULTS.items():
        data.setdefault(key, value)

    frontmatter = ["---\n"]
    for field in FIELD_ORDER:
        if field in data:
            frontmatter.append(f"{field}: {yaml_value(data[field])}\n")
    frontmatter.append("---\n")

    body = body.lstrip("\n")
    return "".join(frontmatter) + "\n" + body


def migrate_file(path: Path, *, check: bool) -> bool:
    original = path.read_text(encoding="utf-8", errors="replace")
    migrated = normalize_post_text(original)
    if migrated == original:
        return False

    if check:
        print(f"would update {path}")
        diff = difflib.unified_diff(
            original.splitlines(),
            migrated.splitlines(),
            fromfile=str(path),
            tofile=str(path),
            lineterm="",
        )
        for line in diff:
            print(line)
        return True

    path.write_text(migrated, encoding="utf-8")
    print(f"updated {path}")
    return True


def iter_posts(repo: Path) -> list[Path]:
    return sorted((repo / "output/Posts").glob("**/*.md"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument(
        "--check", action="store_true", help="show pending migrations without writing files"
    )
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    changed = False
    for path in iter_posts(repo):
        changed = migrate_file(path, check=args.check) or changed

    if args.check and changed:
        return 1
    print("frontmatter migration clean" if not changed else "frontmatter migration complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())

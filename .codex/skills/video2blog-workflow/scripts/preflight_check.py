#!/usr/bin/env python3
"""Pre-flight helper for the Video2Blog Codex skill.

The script summarizes repository context, validates SOURCE, suggests routing
when absent, and scans real context files for unfilled placeholders.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROUTES = {"/default", "/lecture", "/dialogue", "/screencast", "/meeting"}
PLACEHOLDER_RE = re.compile(r"_{4,}|YYYY-MM-DD|\[(?:填写|TODO|占位)\]")


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SystemExit(f"missing required file: {path}") from None


def strip_explanatory_lines(text: str) -> list[tuple[int, str]]:
    """Return non-template lines for placeholder scanning.

    Context docs intentionally explain placeholder tokens in blockquotes and
    fenced examples. Those are not actionable missing fields, so ignore them.
    """
    kept: list[tuple[int, str]] = []
    in_fence = False
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or stripped.startswith(">"):
            continue
        kept.append((lineno, line))
    return kept


def placeholder_hits(repo: Path) -> list[str]:
    hits: list[str] = []
    for rel in ("memory/PREFERENCES.md", "memory/CONFIG.md", "memory/HISTORY.md"):
        path = repo / rel
        text = read(path)
        for lineno, line in strip_explanatory_lines(text):
            if PLACEHOLDER_RE.search(line):
                hits.append(f"{rel}:{lineno}: {line.strip()}")
    return hits


def preference_summary(text: str) -> str:
    language = find_after(text, r"正文语言：\*\*(.+?)\*\*") or "未声明"
    persona = find_after(text, r"叙述人称：\*\*(.+?)\*\*") or "未声明"
    length = find_after(text, r"目标字数：\*\*(.+?)\*\*") or "未声明"
    ban_section = text.split("## 禁用套话", 1)[-1].split("## ", 1)[0]
    ban_count = len(re.findall(r"^\s*-\s+", ban_section, flags=re.M))
    return f"{language}｜{persona}｜{length}｜禁用套话 {ban_count} 条"


def find_after(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    return match.group(1).strip() if match else None


def config_input_root(text: str) -> str:
    if "VIDEO2BLOG_INPUT_ROOT" in text:
        return "$VIDEO2BLOG_INPUT_ROOT（或 --input-root）"
    return "见 memory/CONFIG.md"


def history_summary(text: str) -> str:
    rows: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in {"日期", "----------"}:
            continue
        if re.fullmatch(r"-+", cells[0]):
            continue
        rows.append((cells[0], cells[1], cells[3]))
    if not rows:
        return "无可比"
    recent = rows[-3:]
    return "；".join(f"{date}《{title}》{summary}" for date, title, summary in recent)


def suggest_route(source_path: Path, sample: str) -> tuple[str, str]:
    haystack = f"{source_path.name}\n{sample[:200]}".lower()
    signals: list[str] = []
    scores = {route: 0 for route in ROUTES}

    def hit(route: str, score: int, label: str) -> None:
        scores[route] += score
        signals.append(label)

    if re.search(r"访谈|对谈|interview|dialogue|q&a|你觉得|我想问|那您", haystack, re.I):
        hit("/dialogue", 3, "访谈/问答信号")
    if re.search(r"讲座|分享|talk|keynote|第一点|第二点|今天我要讲", haystack, re.I):
        hit("/lecture", 3, "讲座/分享信号")
    if re.search(r"demo|录屏|教程|screencast|walkthrough|点击|打开|命令行", haystack, re.I):
        hit("/screencast", 3, "教程/录屏信号")
    if re.search(r"会议|复盘|周会|standup|决议|行动项|ddl|下周|上周", haystack, re.I):
        hit("/meeting", 3, "会议/决议信号")

    route = max(scores, key=scores.get)
    if scores[route] <= 0:
        return "/default", "无强信号"
    return route, "、".join(signals)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--entry", choices=["video", "transcript"], required=True)
    parser.add_argument("--mode", choices=["full", "quick"], default="full")
    parser.add_argument("--source", required=True)
    parser.add_argument("--routing", choices=sorted(ROUTES))
    args = parser.parse_args()

    repo = args.repo.expanduser().resolve()
    read(repo / "WORKFLOW.md")
    prefs = read(repo / "memory/PREFERENCES.md")
    config = read(repo / "memory/CONFIG.md")
    read(repo / "knowledge/STYLE_GUIDE.md")
    history = read(repo / "memory/HISTORY.md")

    hits = placeholder_hits(repo)
    if hits:
        print("STOP: placeholders found")
        for hit in hits:
            print(f"- {hit}")
        return 2

    source = Path(args.source).expanduser()
    if not source.is_absolute():
        source = repo / source
    if not source.exists():
        print(f"STOP: SOURCE not found: {source}")
        return 2
    if source.is_file() and source.stat().st_size == 0:
        print(f"STOP: SOURCE is empty: {source}")
        return 2

    sample = source.read_text(encoding="utf-8", errors="replace")[:500] if source.is_file() else ""
    routing = args.routing
    signal = "用户声明"
    if routing is None:
        routing, signal = suggest_route(source, sample)

    print("> Pre-Flight ✓")
    print(f"> PREFERENCES: {preference_summary(prefs)}")
    print(f"> CONFIG: input_root={config_input_root(config)}｜skills=.cursor/skills/video2blog/")
    print(f"> HISTORY: {history_summary(history)}")
    print(f"> ENTRY → {args.entry}")
    print(f"> MODE → {args.mode}")
    print(f"> ROUTING → {routing}（{signal}）")
    print(f"> SOURCE → {source.relative_to(repo) if source.is_relative_to(repo) else source}")
    print("> STYLE → knowledge/STYLE_GUIDE.md + knowledge/Examples/<pick-one>")
    return 0


if __name__ == "__main__":
    sys.exit(main())

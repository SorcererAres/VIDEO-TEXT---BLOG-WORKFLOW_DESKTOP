"""Shared utility helpers for Video2Blog."""

from __future__ import annotations

import os
import re
import shlex
import tempfile
from datetime import datetime
from pathlib import Path

import yaml


def atomic_write(file_path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write a text file via same-directory temp file + os.replace."""
    file_path = Path(file_path).resolve()
    parent = file_path.parent
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        dir=parent,
        delete=False,
        suffix=".tmp",
        encoding=encoding,
    ) as temp_file:
        temp_file.write(content)
        temp_path = Path(temp_file.name)
    try:
        os.replace(temp_path, file_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def shell_join(args: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


def append_log(log_path: Path | None, message: str) -> None:
    if log_path is None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().isoformat(timespec="seconds")
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(f"[{stamp}] {message}\n")


def strip_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """切出 YAML frontmatter 并解析。

    返回 ``({}, text)`` 表示没有 frontmatter / 未闭合 / 解析失败 / 顶层不是映射。
    解析结果统一字符串化（None 转空串），保持调用方按 ``dict[str, str]`` 使用的语义。
    """
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    try:
        parsed = yaml.safe_load(raw)
    except yaml.YAMLError:
        return {}, text
    if not isinstance(parsed, dict):
        return {}, text
    data = {str(k): "" if v is None else str(v) for k, v in parsed.items()}
    return data, text[end + 4 :]


VIEWER_RE = re.compile(r"我看完|这场分享让我|我作为读者|编者按|补充观察|我抄走")
PLACEHOLDER_RE = re.compile(r"_{4,}|YYYY-MM-DD|\[(?:填写|TODO|占位)\]")

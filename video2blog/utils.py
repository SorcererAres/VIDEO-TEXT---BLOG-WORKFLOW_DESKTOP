"""Shared utility helpers for Video2Blog."""

from __future__ import annotations

import shlex
from datetime import datetime
from pathlib import Path


def shell_join(args: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


def append_log(log_path: Path | None, message: str) -> None:
    if log_path is None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().isoformat(timespec="seconds")
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(f"[{stamp}] {message}\n")

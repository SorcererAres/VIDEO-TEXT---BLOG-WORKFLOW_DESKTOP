"""Utility functions for the Video2Blog engine."""

from __future__ import annotations

from pathlib import Path

from video2blog.utils import atomic_write as shared_atomic_write


def atomic_write(file_path: Path, content: str, encoding: str = "utf-8") -> None:
    """Engine-facing wrapper for the shared atomic write helper."""
    shared_atomic_write(file_path, content, encoding=encoding)

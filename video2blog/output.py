"""Output path and raw-stage metadata helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    return str(value)


def write_meta(
    meta_path: Path,
    *,
    video: Path,
    txt_path: Path,
    srt_path: Path,
    log_path: Path,
    engine_meta: dict[str, Any],
    engine_requested: str,
    fallback_policy: str,
    execution_context: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "created_at": now,
        "source_video": str(video),
        "txt": str(txt_path),
        "srt": str(srt_path),
        "log": str(log_path),
        "engine_requested": engine_requested,
        "fallback_policy": fallback_policy,
        "execution_context": execution_context,
        "stages": {
            "raw": {
                "created_at": now,
                "tool": "video2blog.py",
                "txt": str(txt_path),
                "srt": str(srt_path),
                "log": str(log_path),
            }
        },
        **_json_safe(engine_meta),
    }
    meta_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def output_paths(video: Path, output_dir: Path | None, default_output_dir: Path) -> Path:
    base = default_output_dir if output_dir is None else Path(output_dir)
    return base / video.stem

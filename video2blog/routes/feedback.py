"""成品处置反馈（质量学习闭环的信号）。

用户读完成品后标「直接用了 / 改了改 / 重写了」，按成品 path 存 memory/dispositions.json。
未来用来校准 Step 7 质检阈值（自评分 vs 真实采纳）。只读写本地、无密钥。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from video2blog.engine.utils import atomic_write
from video2blog.routes.models import DispositionRequest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService

_VALID = {"used", "edited", "rewrote"}


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    from fastapi import HTTPException

    store = root / "memory" / "dispositions.json"

    def _load() -> dict[str, Any]:
        if not store.exists():
            return {}
        try:
            data = json.loads(store.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    @app.get("/api/dispositions")
    def get_dispositions() -> dict[str, Any]:
        """返回全部处置标记 {成品path: {value, updated_at}}。前端按 path 查。"""
        return _load()

    @app.post("/api/dispositions")
    def set_disposition(payload: DispositionRequest) -> dict[str, Any]:
        """标记/清除某篇成品的处置。value=null 删除该条。"""
        rel = (payload.path or "").strip()
        if not rel:
            raise HTTPException(status_code=400, detail="path 必填")
        if payload.value is not None and payload.value not in _VALID:
            raise HTTPException(status_code=400, detail=f"value 必须为 {sorted(_VALID)} 之一或 null")

        data = _load()
        if payload.value is None:
            data.pop(rel, None)
        else:
            data[rel] = {"value": payload.value, "updated_at": datetime.now(timezone.utc).isoformat()}
        atomic_write(store, json.dumps(data, ensure_ascii=False, indent=2))
        return data

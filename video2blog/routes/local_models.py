"""本地转录模型管理：列出 / 后台下载 / 删除 whisper.cpp ggml 模型。

「设置 → 本地模型」分区调这些端点。下载是后台线程，前端轮询 GET 看进度。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException
from pydantic import BaseModel

from video2blog.engine.whisper_assets import (
    delete_ggml_model,
    delete_mlx_model,
    list_ggml_models,
    list_mlx_models,
    start_ggml_download,
    start_mlx_download,
)

if TYPE_CHECKING:
    from fastapi import FastAPI

    from video2blog.server_core import EngineJobService


class ModelActionRequest(BaseModel):
    name: str
    engine: str = "whisper-cpp"  # "whisper-cpp"（ggml）或 "mlx"


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    @app.get("/api/local-models")
    def local_models() -> dict[str, Any]:
        """两个转录引擎的本地模型 + 状态（已下载大小 / 下载中进度 / 可下载）。"""
        return {"whisper_cpp": list_ggml_models(), "mlx": list_mlx_models()}

    @app.post("/api/local-models/download")
    def download_model(payload: ModelActionRequest) -> dict[str, Any]:
        """后台启动下载（幂等：已在下不重复）。前端轮询 GET 看进度。"""
        try:
            if payload.engine == "mlx":
                start_mlx_download(payload.name)
            else:
                start_ggml_download(payload.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "name": payload.name}

    @app.post("/api/local-models/delete")
    def delete_model(payload: ModelActionRequest) -> dict[str, Any]:
        """删除已下载模型（ggml 单文件 / mlx 整个 HF cache 目录）。"""
        try:
            removed = (
                delete_mlx_model(payload.name)
                if payload.engine == "mlx"
                else delete_ggml_model(payload.name)
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "removed": removed}

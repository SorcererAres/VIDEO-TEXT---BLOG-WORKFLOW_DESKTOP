"""FastAPI app for the local Video2Blog engine service.

本文件只做「装配」：建 FastAPI 实例、挂 CORS、管 lifespan，再把按域拆分的路由
（见 video2blog/routes/）注册上去。具体端点实现都在各 routes 子模块里。

Pydantic 请求模型从 video2blog.routes.models 重导出，保持历史 import 兼容。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

try:
    from fastapi import FastAPI
except ImportError as exc:  # pragma: no cover - exercised when optional deps are absent.
    raise RuntimeError(
        "FastAPI 服务依赖未安装。请先运行: pip install -e . 或 pip install fastapi uvicorn"
    ) from exc

from video2blog.routes import register_all
from video2blog.routes.models import (  # noqa: F401 - 重导出，保持向后兼容的 import 路径
    ApproveDraftRequest,
    ApproveOutlineRequest,
    DetectSpeakerRequest,
    JobCreateRequest,
    KnowledgeFileRequest,
    LlmProfileRequest,
    TestLLMRequest,
)
from video2blog.server_core import EngineJobService


def create_app(repo_root: Path | str | None = None) -> FastAPI:
    root = Path(repo_root or os.environ.get("VIDEO2BLOG_REPO_ROOT", ".")).resolve()
    service = EngineJobService(root)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        service.shutdown()

    app = FastAPI(title="Video2Blog Local Engine", version="0.1.0", lifespan=lifespan)

    from fastapi.middleware.cors import CORSMiddleware
    configured_origins = [
        item.strip()
        for item in os.environ.get("VIDEO2BLOG_CORS_ORIGINS", "").split(",")
        if item.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        # 允许本机浏览器（localhost/127.0.0.1，任意端口）以及 Tauri 壳的 webview 源：
        # 开发时 webview = http://localhost:5173；打包后 = tauri://localhost（mac）/ http://tauri.localhost（win）。
        allow_origin_regex=r"^(https?|tauri)://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.video2blog_service = service

    register_all(app, service, root)

    return app


app = create_app()

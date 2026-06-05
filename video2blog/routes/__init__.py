"""HTTP 路由层：按域拆分的 FastAPI 路由模块。

每个子模块暴露 `register(app, service, root)`，把本域的端点注册到 app 上。
`server.create_app` 只负责装配（FastAPI 实例 + CORS + lifespan），再调 `register_all`。
这样 42KB 的单体 create_app 拆成了一组小而内聚的域模块，改一个域不必翻整文件。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService

from video2blog.routes import (
    feedback,
    files,
    health,
    home,
    jobs,
    knowledge,
    llm_profiles,
    local_models,
    posts,
    sources,
    tasks,
    trash,
    voice,
)


def register_all(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    """把所有域路由注册到 app。顺序无关（路径各自独立）。

    DECOUPLE Round 1：tasks / posts 是新前缀（/api/tasks*, /api/posts*），
    与旧 /jobs/* / /jobs/history 并存，行为一致；前端 Round 2 再切换。
    """
    health.register(app, service, root)
    llm_profiles.register(app, service, root)
    sources.register(app, service, root)
    jobs.register(app, service, root)
    tasks.register(app, service, root)
    posts.register(app, service, root)
    files.register(app, service, root)
    knowledge.register(app, service, root)
    trash.register(app, service, root)
    voice.register(app, service, root)
    feedback.register(app, service, root)
    home.register(app, service, root)
    local_models.register(app, service, root)

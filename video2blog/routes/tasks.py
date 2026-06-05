"""任务域路由：`/api/tasks*`。

DECOUPLE Round 1 引入的新前缀，行为与 /jobs* 一致（同走 EngineJobService）。
- 旧 `/jobs/*` 仍可用，前端零改动
- Round 2 前端拆 store 时切换到 `/api/tasks/*` 即可

当下仅 alias 核心 CRUD（列表 / 详情 / 创建）；步骤接口（approve-outline / draft、
events SSE、cancel、files、artifacts）仍走 routes/jobs.py，避免单轮改动面过大。
Round 2/3 视需要再补齐其他 alias。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

from video2blog.repos import task_repo
from video2blog.routes.models import JobCreateRequest
from video2blog.server_core import EngineJobRequest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:  # noqa: ARG001
    @app.get("/api/tasks")
    def list_tasks_endpoint() -> list[dict[str, Any]]:
        return task_repo.list_tasks(service)

    @app.get("/api/tasks/{task_id}")
    def get_task_endpoint(task_id: str) -> dict[str, Any]:
        try:
            return task_repo.get_task(service, task_id).to_dict()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/tasks", status_code=202)
    def create_task_endpoint(payload: JobCreateRequest) -> dict[str, Any]:
        try:
            request_data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
            request = EngineJobRequest(**request_data)
            job = service.submit_job(request)
            return job.to_dict()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

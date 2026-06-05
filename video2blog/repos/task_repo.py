"""任务域仓储：EngineJobService 的薄壳。

Round 1 阶段任务的真正存储仍是 EngineJobService 内存 + work/<stem>/.state.json，
本模块只是把"列表 / 详情"集中在一处给 routes/tasks.py 调用，未来若引入 SQLite
任务表，只需替换实现，路由层无感。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from video2blog.server_core import EngineJob, EngineJobService


def list_tasks(service: EngineJobService) -> list[dict[str, Any]]:
    """所有内存中可见的任务（live / queued / paused / 终态 / disk-restored）。

    与旧 GET /jobs 返回完全一致：直接序列化 service.list_jobs()。
    """
    return [job.to_dict() for job in service.list_jobs()]


def get_task(service: EngineJobService, task_id: str) -> EngineJob:
    """单个任务详情。未知 ID 由 service 抛 KeyError，路由层翻 404。"""
    return service.get_job(task_id)

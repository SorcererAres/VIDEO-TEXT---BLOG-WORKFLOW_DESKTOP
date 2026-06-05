"""作品域路由：`/api/posts*`。

DECOUPLE Round 1 引入的新前缀，行为与 `/jobs/history` 完全一致（同走 post_repo）。
- 旧 `/jobs/history` 仍可用，前端零改动
- Round 2 前端拆 store 时切换到 `/api/posts` 即可
- `DELETE /api/posts` 暂不在此（已经在 routes/trash.py:/posts），Round 3 再统一

返回字段保留 kind="historical" / is_draft / pass_score 等 legacy 旁路字段，
等前端 Round 2 切完再渐进收敛到 Post 原生模型。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from video2blog.repos import post_repo

if TYPE_CHECKING:
    from fastapi import FastAPI

    from video2blog.server_core import EngineJobService


def register(app: FastAPI, service: EngineJobService, root: Path) -> None:  # noqa: ARG001 (service 暂未用)
    @app.get("/api/posts")
    def list_posts_endpoint() -> list[dict[str, Any]]:
        """扫 output/Posts/，返回作品列表（与 /jobs/history 行为一致）。"""
        return post_repo.list_posts(root)

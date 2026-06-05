"""维护域路由：`/api/maintenance/*`。高危批量清扫，独立前缀以示郑重。

DECOUPLE Round 3：原 DELETE /jobs/history 的"5 选清扫"（一次清 post + review + work +
索引 + 指纹）从删除主路径剥离到这里。

删除语义自此分明：
- 日常删作品 → DELETE /posts（移 30 天回收站，可恢复）
- 删任务 → DELETE /jobs/{id}（只清 work/，6s undo）
- 彻底清链 → POST /api/maintenance/purge（本端点，显式高危，post 直接物理删）

前端入口待后续"设置 → 维护"区接入；本端点先就位（可 curl / 测试覆盖）。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException
from pydantic import BaseModel

from video2blog.repos import post_repo

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


class PurgeRequest(BaseModel):
    """POST /api/maintenance/purge 入参：按 post_path 清扫整条产物链。

    post_path：output/Posts/<year>/<file>.md 相对路径。
    五个布尔开关：各产物类别是否一并清除（默认全 True，最大化清理）。
    """

    post_path: str
    posts: bool = True
    reviews: bool = True
    work: bool = True
    history_index: bool = True
    fingerprints: bool = True


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:  # noqa: ARG001 (service 暂未用)
    @app.post("/api/maintenance/purge")
    def purge_post_chain_endpoint(payload: PurgeRequest) -> dict[str, Any]:
        """按 post_path 彻底清扫产物链（post + review + work + 索引 + 指纹）。

        高危：post 项不走回收站，直接物理删。日常删作品请用 DELETE /posts（移回收站）。
        返回 {ok, deleted, errors, stem}；路径非法 / 越界 → 400。
        """
        try:
            return post_repo.purge_post_chain(
                root,
                payload.post_path,
                posts=payload.posts,
                reviews=payload.reviews,
                work=payload.work,
                history_index=payload.history_index,
                fingerprints=payload.fingerprints,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

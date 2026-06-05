"""作品集回收站：output/.trash/posts/。30 天老化（lazy，每次 list 触发）。

trash 文件名格式：`<unix_ts>__<year>__<原文件名>.md`
- ts：删除时间戳（int unix seconds），便于 30 天老化按前缀解析
- year：原 output/Posts/<year>/ 的年份，restore 时回到原年份目录
- 原文件名：保留原 .md，restore 后用户感知不到改名

设计原则：
- 物理隔离：单独 .trash 目录，不污染 output/Posts/ 扫描
- 文件操作原子：rename 单步完成（同分区可保证）
- 老化 lazy：避免后台线程；每次 GET /trash/posts 触发一次清理（开销低）
- 命名冲突保护：restore 时如果原位置已有同名文件，409 拒绝
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


_TRASH_RETENTION_DAYS = 30
_TRASH_SUBDIR = ("output", ".trash", "posts")


def _trash_dir(root: Path) -> Path:
    return root.joinpath(*_TRASH_SUBDIR)


def _parse_trash_name(name: str) -> tuple[int, str, str] | None:
    """解析 trash 文件名 → (deleted_at, year, orig_name)。格式不对返回 None。"""
    parts = name.split("__", 2)
    if len(parts) != 3:
        return None
    try:
        ts = int(parts[0])
    except ValueError:
        return None
    return ts, parts[1], parts[2]


def _purge_expired(root: Path, retention_days: int = _TRASH_RETENTION_DAYS) -> int:
    """删除 trash 中超过 retention_days 的文件，返回清掉数。每次 list 调一次。"""
    trash = _trash_dir(root)
    if not trash.is_dir():
        return 0
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for f in trash.glob("*.md"):
        parsed = _parse_trash_name(f.name)
        if not parsed:
            continue
        ts, _year, _orig = parsed
        if ts < cutoff:
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:  # noqa: ARG001 (service 暂未用)
    @app.delete("/posts")
    def post_to_trash(post_path: str) -> dict[str, Any]:
        """把作品集文章移到 .trash/posts/（30 天可恢复）。

        post_path：output/Posts/<year>/<file>.md 相对路径（前端从 list_history 拿）。
        重名（同一稿子重复跑后再删多次）会追加 -2/-3 后缀避免覆盖。
        """
        if ".." in post_path or post_path.startswith("/"):
            raise HTTPException(status_code=400, detail="非法路径")

        src = root / post_path
        if not src.is_file():
            raise HTTPException(status_code=404, detail=f"文件不存在: {post_path}")

        # 必须落在 output/Posts/ 下
        try:
            rel = src.relative_to(root / "output" / "Posts")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="post_path 必须落在 output/Posts/ 下") from exc

        # rel = <year>/<file>.md → 拆 year 和 文件名
        if len(rel.parts) < 2:
            raise HTTPException(status_code=400, detail="post_path 缺少年份层级")
        year = rel.parts[0]
        orig_name = rel.parts[-1]

        ts = int(time.time())
        base_name = f"{ts}__{year}__{orig_name}"
        trash = _trash_dir(root)
        trash.mkdir(parents=True, exist_ok=True)

        # 极端并发：同秒删同一文件名 → 追加 -2/-3
        dst = trash / base_name
        suffix = 2
        while dst.exists():
            dst = trash / f"{ts}__{year}__{Path(orig_name).stem}-{suffix}{Path(orig_name).suffix}"
            suffix += 1

        src.rename(dst)
        return {
            "ok": True,
            "trash_id": dst.name,
            "original_path": post_path,
            "retention_days": _TRASH_RETENTION_DAYS,
        }

    @app.get("/trash/posts")
    def list_trash_posts() -> list[dict[str, Any]]:
        """列回收站。GET 前会顺手清掉过期的（lazy 老化）。按删除时间倒序。"""
        _purge_expired(root)
        trash = _trash_dir(root)
        if not trash.is_dir():
            return []
        now = time.time()
        items: list[dict[str, Any]] = []
        for f in trash.glob("*.md"):
            parsed = _parse_trash_name(f.name)
            if not parsed:
                continue
            ts, year, orig = parsed
            try:
                size = f.stat().st_size
            except OSError:
                size = 0
            age_days = (now - ts) / 86400
            items.append({
                "trash_id": f.name,
                "year": year,
                "original_name": orig,
                "deleted_at": ts,
                "size": size,
                "days_until_purge": max(0, round(_TRASH_RETENTION_DAYS - age_days, 1)),
            })
        items.sort(key=lambda x: x["deleted_at"], reverse=True)
        return items

    @app.post("/trash/posts/{trash_id}/restore")
    def restore_trash_post(trash_id: str) -> dict[str, Any]:
        """还原到 output/Posts/<year>/<原文件名>.md。目标已存在则 409。"""
        if "/" in trash_id or ".." in trash_id:
            raise HTTPException(status_code=400, detail="非法 trash_id")
        src = _trash_dir(root) / trash_id
        if not src.is_file():
            raise HTTPException(status_code=404, detail="回收站条目不存在或已过期清理")
        parsed = _parse_trash_name(trash_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="trash_id 格式错误")
        _ts, year, orig = parsed

        dst_dir = root / "output" / "Posts" / year
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / orig
        if dst.exists():
            raise HTTPException(
                status_code=409,
                detail=f"目标已存在: output/Posts/{year}/{orig}（可能是重跑产生同名稿，先删/改它再还原）",
            )
        src.rename(dst)
        return {"ok": True, "restored_to": str(dst.relative_to(root))}

    @app.delete("/trash/posts/{trash_id}")
    def purge_trash_post(trash_id: str) -> dict[str, Any]:
        """永久删除回收站单条。"""
        if "/" in trash_id or ".." in trash_id:
            raise HTTPException(status_code=400, detail="非法 trash_id")
        src = _trash_dir(root) / trash_id
        if not src.is_file():
            raise HTTPException(status_code=404, detail="回收站条目不存在")
        src.unlink()
        return {"ok": True}

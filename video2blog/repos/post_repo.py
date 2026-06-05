"""作品域仓储：扫 output/Posts/、关联 reviews、跨目录清扫。

从 routes/jobs.py 抽出来的纯数据/文件逻辑。路由层只做参数校验和 HTTP 形态封装，
所有"读磁盘 / 写磁盘"集中在本模块，方便单测和后续替换为索引存储。

Round 1 保持返回字段与原 list_history / delete_history 完全一致：
- 列表 dict 仍带 kind="historical"、is_draft、pass_score 等给前端区分用的字段
- 删除返回 {ok, deleted, errors, stem}
这样旧 /jobs/history 端点直接调本函数即可，行为无差。
"""

from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from video2blog.engine.utils import atomic_write
from video2blog.utils import strip_frontmatter


def list_posts(root: Path) -> list[dict[str, Any]]:
    """从 output/Posts/**/*.md 扫描历史归档，解析 frontmatter 重建虚拟 EngineJob 列表。

    作用：server 重启后内存里的 jobs 会清空，但磁盘上之前跑过的成品都还在。
    把它们扫出来按 EngineJob 形状返回，前端就能持续展示"以前跑过的"。
    每条产物用路径 SHA 作稳定 ID（跨重启不变）。

    返回字段与原 routes/jobs.py:list_history 完全一致，包括 kind="historical" /
    is_draft / pass_score / mtime 等给前端区分用的旁路字段；Round 1 阶段不演进结构。
    """
    posts_root = root / "output" / "Posts"
    if not posts_root.is_dir():
        return []

    items: list[dict[str, Any]] = []
    for post_path in posts_root.glob("**/*.md"):
        try:
            text = post_path.read_text(encoding="utf-8", errors="replace")
            data, _ = strip_frontmatter(text)
            if not data:
                continue  # 没 frontmatter 的不算合规成品
            rel_post = str(post_path.relative_to(root))
            is_draft = post_path.stem.startswith("DRAFT-")

            # review 文件名跟随 post stem（去掉可能的 DRAFT- 前缀）
            review_stem = post_path.stem[len("DRAFT-") :] if is_draft else post_path.stem
            review_path = root / "output" / "Reviews" / f"{review_stem}.review.md"

            # 用 post 路径做稳定 ID（SHA），跨重启不变
            stable_id = "hist-" + hashlib.sha256(rel_post.encode("utf-8")).hexdigest()[:16]

            # 从 frontmatter 拿原始 stem 用于 sidebar 展示
            display_stem = data.get("title") or post_path.stem
            try:
                mtime = post_path.stat().st_mtime
            except OSError:
                mtime = 0.0

            items.append(
                {
                    "id": stable_id,
                    "kind": "historical",  # 前端用这个字段区分
                    "stem": display_stem,
                    "status": "draft" if is_draft else "succeeded",
                    "request": {
                        "source": data.get("source", ""),
                        "speaker": data.get("speaker", "我"),
                        "routing": data.get("routing", "/default"),
                        "mode": data.get("mode", "full"),
                        "max_retries": 0,
                        "force": False,
                        "pause_on_outline": False,
                        "api_key": None,
                    },
                    "created_at": data.get("date", ""),
                    "updated_at": data.get("date", ""),
                    "final_post_path": rel_post,
                    "review_path": str(review_path.relative_to(root))
                    if review_path.exists()
                    else None,
                    "clean_path": None,
                    "insights_path": None,
                    "outline_path": None,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "estimated_cost_usd": 0.0,
                    "error": None,
                    # 历史归档专属字段
                    "pass_score": data.get("pass_score"),
                    "is_draft": is_draft,
                    "mtime": mtime,
                }
            )
        except Exception:
            continue

    # 最近的排前面
    items.sort(key=lambda x: x.get("mtime") or 0, reverse=True)
    return items


def _stem_from_post_path(post_abs: Path) -> str:
    """成品文件名 → stem（用于联动找 reviews / work / fingerprints / history 行）。

    DRAFT- 前缀去掉，跟 frontmatter / 引擎写入时的 stem 对齐。
    """
    stem = post_abs.stem
    if stem.startswith("DRAFT-"):
        stem = stem[len("DRAFT-") :]
    return stem


def purge_post_chain(
    root: Path,
    post_path: str,
    *,
    posts: bool = True,
    reviews: bool = True,
    work: bool = True,
    history_index: bool = True,
    fingerprints: bool = True,
) -> dict[str, Any]:
    """归档任务清扫 —— 成品 + 评分 + work + HISTORY + 指纹 一次清掉。

    与旧 routes/jobs.py:delete_history 行为完全一致：
    - 接收 output/Posts/<year>/<file>.md 相对路径 + 5 个布尔开关
    - 任一项失败不抛 500，写入 errors 列表
    - 返回 {ok, deleted, errors, stem}

    raise ValueError 给路由层把它翻成 400（路径非法 / 越界）。
    """
    if ".." in post_path or post_path.startswith("/"):
        raise ValueError("非法路径")
    post_abs = root / post_path
    try:
        post_abs.relative_to(root / "output" / "Posts")
    except ValueError as exc:
        raise ValueError("post_path 必须落在 output/Posts/ 下") from exc

    stem = _stem_from_post_path(post_abs)

    deleted: list[str] = []
    errors: list[str] = []

    def _try(op: str, fn: Callable[[], None]) -> None:
        try:
            fn()
        except Exception as exc:
            errors.append(f"{op}: {exc}")

    if posts:

        def _del_post() -> None:
            if post_abs.is_file():
                post_abs.unlink()
                deleted.append(str(post_abs.relative_to(root)))

        _try("删 post", _del_post)

    if reviews:

        def _del_reviews() -> None:
            review = root / "output" / "Reviews" / f"{stem}.review.md"
            if review.is_file():
                review.unlink()
                deleted.append(str(review.relative_to(root)))

        _try("删 review", _del_reviews)

    if work:

        def _del_work() -> None:
            work_dir = root / "work" / stem
            if work_dir.is_dir():
                shutil.rmtree(work_dir, ignore_errors=True)
                deleted.append(f"work/{stem}/")

        _try("删 work", _del_work)

    if history_index:

        def _del_history_line() -> None:
            hist = root / "memory" / "HISTORY.md"
            if not hist.is_file():
                return
            lines = hist.read_text(encoding="utf-8", errors="replace").splitlines()
            # 行里包含 post 文件名（不含后缀）就删
            kept = [ln for ln in lines if stem not in ln]
            if len(kept) != len(lines):
                atomic_write(hist, "\n".join(kept) + ("\n" if kept else ""))
                deleted.append(f"memory/HISTORY.md ({len(lines) - len(kept)} 行)")

        _try("更新 HISTORY", _del_history_line)

    if fingerprints:

        def _del_fp_lines() -> None:
            fp = root / "memory" / "fingerprints.jsonl"
            if not fp.is_file():
                return
            kept: list[str] = []
            removed = 0
            for line in fp.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    obj = json.loads(line)
                    # fingerprints 里通常带 file / post / stem 字段，命中任一即删
                    if (
                        obj.get("stem") == stem
                        or stem in (obj.get("file") or "")
                        or stem in (obj.get("post") or "")
                    ):
                        removed += 1
                        continue
                except Exception:
                    pass
                kept.append(line)
            if removed:
                atomic_write(fp, "\n".join(kept) + ("\n" if kept else ""))
                deleted.append(f"memory/fingerprints.jsonl ({removed} 行)")

        _try("更新 fingerprints", _del_fp_lines)

    return {"ok": True, "deleted": deleted, "errors": errors, "stem": stem}

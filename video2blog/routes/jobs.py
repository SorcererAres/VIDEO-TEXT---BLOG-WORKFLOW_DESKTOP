"""任务：创建 / 列举 / 详情 / 产物 / 大纲与草稿审批 / 取消 / SSE 事件流 / 历史归档。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

# 用作路由返回注解的名字（StreamingResponse）必须在模块级可见（见 sources.py 同款说明）。
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from video2blog.routes.models import ApproveDraftRequest, ApproveOutlineRequest, JobCreateRequest
from video2blog.server_core import EngineJobRequest
from video2blog.utils import strip_frontmatter

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    # 注意：/jobs/history 必须在 /jobs/{job_id} 之前注册，否则会被 {job_id} 抢匹配。
    @app.get("/jobs/history")
    def list_history() -> list[dict[str, Any]]:
        """从 output/Posts/**/*.md 扫描历史归档,解析 frontmatter 重建虚拟 EngineJob 列表。

        作用:server 重启后内存里的 jobs 会清空,但磁盘上之前跑过的成品都还在。
        把它们扫出来按 EngineJob 形状返回,前端就能在 sidebar 持续展示"以前跑过的"。
        每条产物用路径 SHA 作稳定 ID(跨重启不变)。
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

                # review 文件名跟随 post stem(去掉可能的 DRAFT- 前缀)
                review_stem = post_path.stem[len("DRAFT-"):] if is_draft else post_path.stem
                review_path = root / "output" / "Reviews" / f"{review_stem}.review.md"

                # 用 post 路径做稳定 ID(SHA),跨重启不变
                stable_id = "hist-" + hashlib.sha256(rel_post.encode("utf-8")).hexdigest()[:16]

                # 从 frontmatter 拿原始 stem 用于 sidebar 展示
                display_stem = data.get("title") or post_path.stem
                try:
                    mtime = post_path.stat().st_mtime
                except OSError:
                    mtime = 0.0

                items.append({
                    "id": stable_id,
                    "kind": "historical",                    # 前端用这个字段区分
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
                    "review_path": str(review_path.relative_to(root)) if review_path.exists() else None,
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
                })
            except Exception:
                continue

        # 最近的排前面
        items.sort(key=lambda x: (x.get("mtime") or 0), reverse=True)
        return items

    @app.post("/jobs", status_code=202)
    def create_job(payload: JobCreateRequest) -> dict[str, Any]:
        try:
            request_data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
            request = EngineJobRequest(**request_data)
            job = service.submit_job(request)
            return job.to_dict()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/jobs")
    def list_jobs() -> list[dict[str, Any]]:
        return [job.to_dict() for job in service.list_jobs()]

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        try:
            return service.get_job(job_id).to_dict()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/artifacts/{job_id}")
    def get_artifacts(job_id: str) -> dict[str, Any]:
        try:
            return service.get_artifacts(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/jobs/{job_id}/files/{file_key}")
    def get_job_file(job_id: str, file_key: str) -> dict[str, str]:
        try:
            job = service.get_job(job_id)
            artifacts = service.get_artifacts(job_id)

            # 还没跑过 Step 6 的中间态（WAITING_USER_OUTLINE 等）就不应该返回 draft/review，
            # 否则前端会拿到上一轮残留文件，被当成本轮内容渲染 —— 5/28 撞过的 UI bug 根因之一。
            PRE_REWRITE_STATES = {
                "PENDING", "CLEANING", "EXTRACTING", "STRUCTURING", "WAITING_USER_OUTLINE",
            }
            path_str = None
            if file_key in {"draft", "review_json"}:
                state_path = service.repo_root / "work" / job.stem / ".state.json"
                if state_path.exists():
                    with open(state_path, "r", encoding="utf-8") as f:
                        state = json.load(f)
                    if state.get("status") in PRE_REWRITE_STATES:
                        raise HTTPException(
                            status_code=404,
                            detail=f"本轮工作流尚未进入 Step 6，{file_key} 还不存在",
                        )
                    version = state.get("best_version", state.get("version", 1))
                    ext = "md" if file_key == "draft" else "json"
                    path_str = f"work/{job.stem}/draft_v{version}.{ext}" if file_key == "draft" else f"work/{job.stem}/review_v{version}.{ext}"
            else:
                path_str = artifacts.get(f"{file_key}_path") or getattr(job, f"{file_key}_path", None)

            if not path_str:
                raise HTTPException(status_code=404, detail=f"文件键 {file_key} 未在任务中定义。")

            path = service.repo_root / path_str
            if not path.exists():
                raise HTTPException(status_code=404, detail=f"文件不存在: {path_str}")

            content = path.read_text(encoding="utf-8", errors="replace")
            return {"content": content, "path": str(path_str)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/jobs/{job_id}/approve-outline")
    def approve_outline(job_id: str, payload: ApproveOutlineRequest) -> dict[str, Any]:
        try:
            job = service.get_job(job_id)
            if job.status != "paused":
                raise HTTPException(status_code=400, detail=f"任务状态必须为 paused 才可以审批大纲。当前状态为: {job.status}")

            state_path = service.repo_root / "work" / job.stem / ".state.json"
            if not state_path.exists():
                raise HTTPException(status_code=404, detail="无法找到任务状态机状态文件。")

            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)

            if state.get("status") != "WAITING_USER_OUTLINE":
                raise HTTPException(status_code=400, detail=f"状态机内部状态为: {state.get('status')}，而非 WAITING_USER_OUTLINE")

            outline_path = service.repo_root / "work" / job.stem / "outline.md"
            from video2blog.engine.utils import atomic_write
            atomic_write(outline_path, payload.outline_markdown)

            state["status"] = "REWRITING"
            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)

            service.resume_job(job_id)
            return job.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/jobs/{job_id}/approve-draft")
    def approve_draft(job_id: str, payload: ApproveDraftRequest) -> dict[str, Any]:
        try:
            job = service.get_job(job_id)
            if job.status != "paused":
                raise HTTPException(status_code=400, detail=f"任务状态必须为 paused 才可以审批草稿。当前状态为: {job.status}")

            state_path = service.repo_root / "work" / job.stem / ".state.json"
            if not state_path.exists():
                raise HTTPException(status_code=404, detail="无法找到任务状态机状态文件。")

            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)

            if state.get("status") != "WAITING_USER_REVIEW":
                raise HTTPException(status_code=400, detail=f"状态机内部状态为: {state.get('status')}，而非 WAITING_USER_REVIEW")

            # accept + 用户在前端做了微调 → 把编辑后的 markdown 覆盖回 draft_v<best>.md,
            # 落盘流程会从该文件读最终成品。
            if payload.accept and payload.draft_markdown is not None and payload.draft_markdown.strip():
                version = state.get("best_version", state.get("version", 1))
                draft_path = service.repo_root / "work" / job.stem / f"draft_v{version}.md"
                from video2blog.engine.utils import atomic_write
                atomic_write(draft_path, payload.draft_markdown)

            if payload.accept:
                state["status"] = "DRAFT_DONE"
            else:
                state["status"] = "FAILED"

            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)

            if payload.accept:
                service.resume_job(job_id)
            else:
                job.status = "failed"
                job.error = "用户拒绝了质检未通过的草稿，工作流已中止。"
                service._emit(job.id, "failed", {"error": job.error})

            return job.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/jobs/{job_id}/cancel")
    def cancel_job_endpoint(job_id: str) -> dict[str, Any]:
        """用户主动取消任务。
        - queued:future.cancel() 直接撤;
        - running:设 cancelled 标志位,引擎在下一个 checkpoint(配合新加的 wall-clock 死线)会退出;
        - paused:同上,立即标 failed。
        终态(succeeded/failed) 调用 no-op。
        """
        try:
            service.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        try:
            service.cancel_job(job_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"ok": True, "job_id": job_id, "message": "任务已接收取消/中断指令"}

    @app.get("/jobs/{job_id}/events")
    def stream_events(job_id: str) -> StreamingResponse:
        try:
            service.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        def event_stream():
            for event in service.iter_events(job_id):
                event_name = event["event"]
                payload = json.dumps(event, ensure_ascii=False)
                yield f"id: {event['id']}\nevent: {event_name}\ndata: {payload}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

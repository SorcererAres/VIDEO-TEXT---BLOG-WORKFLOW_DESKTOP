"""任务：创建 / 列举 / 详情 / 产物 / 大纲与草稿审批 / 取消 / SSE 事件流。

DECOUPLE Round 3：历史扫描迁到 routes/posts.py（GET /api/posts），跨目录清扫迁到
routes/maintenance.py（POST /api/maintenance/purge）。旧 /jobs/history（GET+DELETE）已移除。
本模块现在纯粹只管"任务"域：live job 的 CRUD / 审批 / 取消 / 事件流。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

# 用作路由返回注解的名字（StreamingResponse）必须在模块级可见（见 sources.py 同款说明）。
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from video2blog.repos import task_repo
from video2blog.routes.models import ApproveDraftRequest, ApproveOutlineRequest, JobCreateRequest
from video2blog.server_core import EngineJobRequest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
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
        return task_repo.list_tasks(service)

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

    @app.delete("/jobs/{job_id}")
    def delete_job_endpoint(job_id: str) -> dict[str, Any]:
        """删除 live job（含 queued / running / paused / 终态）。
        - 立即从 list_jobs 隐藏；6s undo window 内可 POST /jobs/{id}/restore 撤销
        - 6s 后真删 work/<stem>/ 中间产物
        - running 会先 cancel
        """
        try:
            service.delete_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"ok": True, "job_id": job_id, "undo_window_seconds": 6}

    @app.post("/jobs/{job_id}/restore")
    def restore_job_endpoint(job_id: str) -> dict[str, Any]:
        """6s undo window 内撤销删除。窗口外或未删过返回 404。"""
        try:
            job = service.restore_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return job.to_dict()

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

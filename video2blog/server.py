"""FastAPI app for the local Video2Blog engine service."""

from __future__ import annotations

import hashlib
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import HTMLResponse, StreamingResponse
    from pydantic import BaseModel, Field
except ImportError as exc:  # pragma: no cover - exercised when optional deps are absent.
    raise RuntimeError(
        "FastAPI 服务依赖未安装。请先运行: pip install -e . 或 pip install fastapi uvicorn"
    ) from exc

from video2blog.server_core import EngineJobRequest, EngineJobService, redact_sensitive_text
from video2blog.utils import strip_frontmatter


class JobCreateRequest(BaseModel):
    source: str = Field(..., description="输入源文本路径，可为仓库相对路径或绝对路径")
    speaker: str = "梁老师"
    routing: str = "/lecture"
    mode: str = "full"
    max_retries: int = 1
    model: str | None = None
    api_base: str | None = None
    force: bool = False
    pause_on_outline: bool = True
    api_key: str | None = None


class ApproveOutlineRequest(BaseModel):
    outline_markdown: str = Field(..., description="修改后的 markdown 大纲内容")


class ApproveDraftRequest(BaseModel):
    accept: bool = Field(..., description="是否接受草稿以输出正式/DRAFT博文")
    draft_markdown: str | None = Field(
        default=None,
        description="可选：用户在前端微调后的草稿全文。仅在 accept=True 且非空时,覆盖写回 work/<stem>/draft_v<best>.md 然后再 resume。",
    )


class TestLLMRequest(BaseModel):
    api_key: str | None = None
    api_base: str | None = None
    model: str | None = None


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
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.video2blog_service = service

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "repo_root": str(root)}

    @app.post("/api/test-llm")
    def test_llm(payload: TestLLMRequest) -> dict[str, Any]:
        """测试 LLM 配置是否能联通 —— Settings 页"测试连接"按钮调它。

        用最小提示发 1 次请求,2xx 即 ok。不写入任何任务/缓存。
        - api_key/api_base/model 都是可选,缺什么走环境变量 fallback。
        - 短超时(15s 单次 / 20s 总死线),防止 hang 住用户。
        """
        from video2blog.engine.client import LLMClient
        secret_candidates = [payload.api_key, os.environ.get("VIDEO2BLOG_API_KEY")]
        try:
            client = LLMClient(
                api_key=payload.api_key,
                api_base=payload.api_base,
                model=payload.model,
                max_budget_tokens=100_000,
                per_request_timeout=15,
                max_total_seconds=20,
            )
            if not client.api_key:
                return {
                    "ok": False,
                    "error": "缺失 API Key —— 既没传也没设环境变量 VIDEO2BLOG_API_KEY",
                }
            t0 = time.time()
            out = client.call_api(
                system_prompt="You are a connection test tool. Reply with exactly one word.",
                user_prompt="Say only the single word: pong",
                max_retries=1,
            )
            latency_ms = int((time.time() - t0) * 1000)
            return {
                "ok": True,
                "model": client.model,
                "api_base": client.api_base,
                "latency_ms": latency_ms,
                "sample": (out or "").strip()[:120],
            }
        except Exception as exc:
            return {"ok": False, "error": redact_sensitive_text(str(exc), *secret_candidates)}

    @app.get("/sources")
    def list_sources() -> list[dict[str, Any]]:
        """列出可作为 Job source 的文件。

        扫两类位置：
          - work/<stem>/raw.txt    → ASR 转录稿(kind=transcript)
          - input/Text/*.{txt,md,srt,vtt} → 用户手放的文字稿(kind=text)
        每条返回 {path, kind, label, size, mtime} —— 给前端 Combobox 用。
        """
        items: list[dict[str, Any]] = []

        # work/<stem>/raw.txt
        work_dir = root / "work"
        if work_dir.is_dir():
            for raw in sorted(work_dir.glob("*/raw.txt")):
                try:
                    stat = raw.stat()
                    rel = str(raw.relative_to(root))
                    items.append({
                        "path": rel,
                        "kind": "transcript",
                        "label": raw.parent.name,  # work/<stem> 里的 stem
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                    })
                except OSError:
                    continue

        # input/Text/*.{txt,md,srt,vtt}
        text_dir = root / "input" / "Text"
        if text_dir.is_dir():
            exts = (".txt", ".md", ".srt", ".vtt")
            for f in sorted(text_dir.iterdir()):
                if not f.is_file() or f.suffix.lower() not in exts or f.name == ".gitkeep":
                    continue
                try:
                    stat = f.stat()
                    rel = str(f.relative_to(root))
                    items.append({
                        "path": rel,
                        "kind": "text",
                        "label": f.stem,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                    })
                except OSError:
                    continue

        # 最近修改的排前面(更可能是用户当前关注的素材)
        items.sort(key=lambda x: x["mtime"], reverse=True)
        return items

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

    @app.get("/", response_class=HTMLResponse)
    def home() -> str:
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Video2Blog Engine</title>
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #e8ecff;
      background: #111423;
    }}
    main {{
      max-width: 760px;
      margin: 64px auto;
      padding: 0 24px;
    }}
    h1 {{
      font-size: 32px;
      margin: 0 0 12px;
      font-weight: 700;
    }}
    p {{
      color: #b8c0df;
      line-height: 1.7;
    }}
    code {{
      background: #20263a;
      border: 1px solid #343c57;
      border-radius: 6px;
      padding: 2px 6px;
    }}
    a {{
      color: #8fb4ff;
      text-decoration: none;
    }}
    .links {{
      display: grid;
      gap: 12px;
      margin-top: 28px;
    }}
    .link {{
      border: 1px solid #343c57;
      border-radius: 8px;
      padding: 14px 16px;
      background: #171b2c;
    }}
  </style>
</head>
<body>
  <main>
    <h1>Video2Blog Engine</h1>
    <p>本地服务已启动。当前仓库根目录：<code>{root}</code></p>
    <div class="links">
      <a class="link" href="/health">GET /health - 健康检查</a>
      <a class="link" href="/docs">/docs - FastAPI 调试文档</a>
      <a class="link" href="/openapi.json">/openapi.json - 接口结构</a>
    </div>
  </main>
</body>
</html>"""

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
            
            path_str = None
            if file_key == "draft":
                state_path = service.repo_root / "work" / job.stem / ".state.json"
                if state_path.exists():
                    with open(state_path, "r", encoding="utf-8") as f:
                        state = json.load(f)
                    version = state.get("best_version", state.get("version", 1))
                    path_str = f"work/{job.stem}/draft_v{version}.md"
            elif file_key == "review_json":
                state_path = service.repo_root / "work" / job.stem / ".state.json"
                if state_path.exists():
                    with open(state_path, "r", encoding="utf-8") as f:
                        state = json.load(f)
                    version = state.get("best_version", state.get("version", 1))
                    path_str = f"work/{job.stem}/review_v{version}.json"
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

    @app.post("/open")
    def open_path_in_finder(payload: dict[str, Any]) -> dict[str, Any]:
        """在 macOS Finder 里高亮显示 / 用默认应用打开磁盘上的文件。

        body: {"path": "<相对仓库根的路径>", "mode": "finder" | "editor"}
        - finder: open -R <abs_path>(在 Finder 中显示并选中)
        - editor: open <abs_path>(用默认 app 打开,通常是 .md 关联的编辑器)
        路径必须在 repo_root 之内,否则拒绝(防越权访问任意磁盘文件)。
        """
        import subprocess
        rel = (payload or {}).get("path", "")
        mode = (payload or {}).get("mode", "finder")
        if not rel:
            raise HTTPException(status_code=400, detail="path 必填")
        if mode not in ("finder", "editor"):
            raise HTTPException(status_code=400, detail="mode 必须为 finder 或 editor")

        target = (root / rel).resolve()
        # 越权防护:必须在 repo_root 之内
        try:
            target.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=400, detail="路径必须在仓库根之内")
        if not target.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在: {rel}")

        cmd = ["open", "-R", str(target)] if mode == "finder" else ["open", str(target)]
        try:
            subprocess.run(cmd, check=True, timeout=5)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="open 命令不可用(非 macOS?)")
        except subprocess.CalledProcessError as exc:
            raise HTTPException(status_code=500, detail=f"open 命令失败: {exc}")
        return {"ok": True, "path": rel, "mode": mode}

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

    return app


app = create_app()

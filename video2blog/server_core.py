"""Local service primitives for running Video2Blog engine jobs."""

from __future__ import annotations

import contextlib
import io
import json
import os
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

from video2blog.engine import Engine, LLMClient


VALID_ROUTINGS = {"/default", "/lecture", "/dialogue", "/screencast", "/meeting"}
VALID_MODES = {"full", "quick"}
VALID_REWRITE_STRATEGIES = {"single", "sectioned"}


def redact_sensitive_text(text: str, *secrets: str | None) -> str:
    redacted = text
    for secret in secrets:
        if secret and len(secret) >= 4:
            redacted = redacted.replace(secret, "***")
    return redacted


@dataclass(frozen=True)
class EngineJobRequest:
    source: str
    speaker: str = "梁老师"
    routing: str = "/lecture"
    mode: str = "full"
    max_retries: int = 1
    model: str | None = None
    api_base: str | None = None
    force: bool = False
    pause_on_outline: bool = True
    api_key: str | None = None
    # §9-C：single = 一次性整篇（默认），sectioned = 按 outline 拆节滚动改写。
    # quick 模式或 outline 不可解析时引擎会自动回退 single，不强求按节。
    rewrite_strategy: str = "single"


@dataclass
class EngineJob:
    id: str
    status: str
    request: EngineJobRequest
    stem: str
    created_at: str
    updated_at: str
    final_post_path: str | None = None
    review_path: str | None = None
    clean_path: str | None = None
    insights_path: str | None = None
    outline_path: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        request_data = asdict(self.request)
        # 屏蔽 LLM API key：任何 HTTP 响应都不能回吐密钥；保留布尔语义（"***" 表示已配置，None 表示未配置）。
        if request_data.get("api_key"):
            request_data["api_key"] = "***"
        data["request"] = request_data
        return data


@dataclass
class _JobRuntime:
    job: EngineJob
    events: list[dict[str, Any]] = field(default_factory=list)
    condition: threading.Condition = field(default_factory=threading.Condition)
    future: Future[Path | None] | None = None
    cancelled: bool = False


class _EventWriter(io.TextIOBase):
    """Turns printed engine output into line-oriented job log events."""

    def __init__(self, emit: Callable[[str], None]) -> None:
        self._emit = emit
        self._buffer = ""

    def writable(self) -> bool:
        return True

    def write(self, text: str) -> int:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line.strip():
                self._emit(line)
        return len(text)

    def flush(self) -> None:
        if self._buffer.strip():
            self._emit(self._buffer.rstrip("\n"))
        self._buffer = ""


class EngineJobService:
    """Runs Engine jobs in a background worker and exposes structured events."""

    def __init__(
        self,
        repo_root: Path | str,
        *,
        client_factory: Callable[[EngineJobRequest], Any] | None = None,
        max_workers: int = 1,
        allow_external_source: bool | None = None,
        restore_jobs: bool = True,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self._client_factory = client_factory or self._default_client_factory
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="video2blog-job")
        self._jobs: dict[str, _JobRuntime] = {}
        self._lock = threading.Lock()
        self.allow_external_source = (
            allow_external_source
            if allow_external_source is not None
            else os.environ.get("VIDEO2BLOG_ALLOW_EXTERNAL_SOURCE", "").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        if restore_jobs:
            self._restore_jobs_from_disk()

    def submit_job(self, request: EngineJobRequest) -> EngineJob:
        self._validate_request(request)
        source_path = self._resolve_source(request.source)
        stem = self._infer_stem(source_path)
        now = self._now()
        job = EngineJob(
            id=uuid.uuid4().hex,
            status="queued",
            request=request,
            stem=stem,
            created_at=now,
            updated_at=now,
        )
        runtime = _JobRuntime(job=job)
        with self._lock:
            self._jobs[job.id] = runtime
        self._emit(job.id, "queued", {"job_id": job.id, "stem": stem})
        runtime.future = self._executor.submit(self._run_job, job.id)
        return job

    def get_job(self, job_id: str) -> EngineJob:
        return self._runtime(job_id).job

    def list_jobs(self) -> list[EngineJob]:
        with self._lock:
            return [runtime.job for runtime in self._jobs.values()]

    def resume_job(self, job_id: str) -> None:
        runtime = self._runtime(job_id)
        job = runtime.job
        if job.status != "paused":
            raise ValueError(f"只有处于暂停 (paused) 状态的任务才可以恢复。当前状态为: {job.status}")
        self._mark(job, "queued")
        self._emit(job.id, "queued", {"job_id": job.id, "stem": job.stem})
        runtime.future = self._executor.submit(self._run_job, job.id)

    def cancel_job(self, job_id: str) -> None:
        runtime = self._runtime(job_id)
        job = runtime.job
        
        if job.status in {"succeeded", "failed"}:
            return
            
        with self._lock:
            runtime.cancelled = True
            
        if job.status == "queued" and runtime.future:
            cancelled = runtime.future.cancel()
            if cancelled:
                job.error = "任务已被用户取消"
                self._mark(job, "failed")
                self._emit(job.id, "failed", {"error": job.error})
                return
                
        job.error = "任务被用户手动中断"
        self._mark(job, "failed")
        self._emit(job.id, "failed", {"error": job.error})

    def get_artifacts(self, job_id: str) -> dict[str, str | None]:
        job = self.get_job(job_id)
        return {
            "final_post_path": job.final_post_path,
            "review_path": job.review_path,
            "clean_path": job.clean_path,
            "insights_path": job.insights_path,
            "outline_path": job.outline_path,
        }

    def iter_events(self, job_id: str, *, timeout: float = 0.5) -> Iterator[dict[str, Any]]:
        runtime = self._runtime(job_id)
        cursor = 0
        while True:
            # 关键:yield 必须在 with 块外,否则锁会一直握到下游(FastAPI/uvicorn)消费 yield 的字节
            # 这会让 worker 线程的 _emit(也要拿 condition 锁)阻塞,SSE 看起来"永远不返回字节"。
            batch: list[dict[str, Any]] = []
            terminal = False
            with runtime.condition:
                while cursor >= len(runtime.events) and runtime.job.status not in {"succeeded", "failed", "paused"}:
                    runtime.condition.wait(timeout=timeout)
                while cursor < len(runtime.events):
                    batch.append(runtime.events[cursor])
                    cursor += 1
                if runtime.job.status in {"succeeded", "failed", "paused"}:
                    terminal = True

            for ev in batch:
                yield ev

            if terminal:
                break

    def wait_for_job(self, job_id: str, timeout: float | None = None) -> EngineJob:
        runtime = self._runtime(job_id)
        if runtime.future is not None:
            runtime.future.result(timeout=timeout)
        return runtime.job

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)

    def _run_job(self, job_id: str) -> Path | None:
        runtime = self._runtime(job_id)
        job = runtime.job
        request = job.request

        self._mark(job, "running")
        self._emit(job.id, "started", {"job_id": job.id, "stem": job.stem})

        # client 在 try 里才创建,但 writer 需要在它创建后才能读 token。
        # 用 list 做可变引用让 emit_with_tokens 能后绑定 client。
        client_holder: list[Any] = [None]
        secret_candidates = [request.api_key, os.environ.get("VIDEO2BLOG_API_KEY")]

        def emit_with_tokens(line: str) -> None:
            # 每条日志事件都顺手把 client 累计 token 刷到 job 上,前端轮询 /jobs 即可看到实时进度。
            self._emit(job.id, "log", {"message": redact_sensitive_text(line, *secret_candidates)})
            c = client_holder[0]
            if c is not None:
                job.input_tokens = getattr(c, "total_input_tokens", 0) or 0
                job.output_tokens = getattr(c, "total_output_tokens", 0) or 0
                job.estimated_cost_usd = float(getattr(c, "total_cost", 0.0) or 0.0)

        writer = _EventWriter(emit_with_tokens)
        try:
            client = self._client_factory(request)
            client_holder[0] = client
            
            def check_cancelled() -> bool:
                with self._lock:
                    rt = self._jobs.get(job_id)
                    if rt and rt.cancelled:
                        return True
                return False

            engine = Engine(
                repo_root=self.repo_root,
                client=client,
                cancel_check=check_cancelled,
                rewrite_strategy=request.rewrite_strategy,
            )
            source_path = self._resolve_source(request.source)

            if request.force:
                state = engine.load_state(job.stem)
                state["status"] = "PENDING"
                state["force_retry"] = True
                engine.save_state(job.stem, state)

            with contextlib.redirect_stdout(writer):
                final_path = engine.run_job(
                    stem=job.stem,
                    source_path=source_path,
                    mode=request.mode,
                    routing=request.routing,
                    speaker=request.speaker,
                    max_retries=request.max_retries,
                    pause_on_outline=request.pause_on_outline,
                )
            writer.flush()

            if final_path is None:
                state = engine.load_state(job.stem)
                if state.get("status") in {"WAITING_USER_OUTLINE", "WAITING_USER_REVIEW"}:
                    job.clean_path = self._existing_rel(self.repo_root / "work" / job.stem / "clean.md")
                    job.insights_path = self._existing_rel(self.repo_root / "work" / job.stem / "insights.md")
                    job.outline_path = self._existing_rel(self.repo_root / "work" / job.stem / "outline.md")
                    
                    best_ver = state.get("best_version", 1)
                    review_json_path = self.repo_root / "work" / job.stem / f"review_v{best_ver}.json"
                    if review_json_path.exists():
                        job.review_path = self._to_repo_relative(review_json_path)

                    job.input_tokens = getattr(client, "total_input_tokens", 0)
                    job.output_tokens = getattr(client, "total_output_tokens", 0)
                    job.estimated_cost_usd = float(getattr(client, "total_cost", 0.0))
                    
                    self._mark(job, "paused")
                    self._emit(
                        job.id,
                        "paused",
                        {
                            "job_id": job.id,
                            "state_status": state.get("status"),
                            "outline_path": job.outline_path,
                            "review_path": job.review_path,
                        },
                    )
                    return None
                else:
                    raise RuntimeError("工作流未产生成品，可能被拒绝或异常中断。")

            final_path = final_path.resolve()
            job.final_post_path = self._to_repo_relative(final_path)
            job.review_path = self._infer_review_path(final_path)
            job.clean_path = self._existing_rel(self.repo_root / "work" / job.stem / "clean.md")
            job.insights_path = self._existing_rel(self.repo_root / "work" / job.stem / "insights.md")
            job.outline_path = self._existing_rel(self.repo_root / "work" / job.stem / "outline.md")
            job.input_tokens = getattr(client, "total_input_tokens", 0)
            job.output_tokens = getattr(client, "total_output_tokens", 0)
            job.estimated_cost_usd = float(getattr(client, "total_cost", 0.0))
            self._mark(job, "succeeded")
            self._emit(
                job.id,
                "succeeded",
                {
                    "final_post_path": job.final_post_path,
                    "input_tokens": job.input_tokens,
                    "output_tokens": job.output_tokens,
                    "estimated_cost_usd": job.estimated_cost_usd,
                },
            )
            return final_path
        except Exception as exc:
            writer.flush()
            job.error = redact_sensitive_text(str(exc), *secret_candidates)
            self._mark(job, "failed")
            self._emit(job.id, "failed", {"error": job.error})
            return None

    def _emit(self, job_id: str, event_type: str, data: dict[str, Any]) -> None:
        runtime = self._runtime(job_id)
        event = {
            "id": len(runtime.events) + 1,
            "event": event_type,
            "timestamp": self._now(),
            "data": data,
        }
        with runtime.condition:
            runtime.events.append(event)
            runtime.condition.notify_all()
        self._append_event(runtime, event)

    def _mark(self, job: EngineJob, status: str) -> None:
        job.status = status
        job.updated_at = self._now()

    def _runtime(self, job_id: str) -> _JobRuntime:
        with self._lock:
            runtime = self._jobs.get(job_id)
        if runtime is None:
            raise KeyError(f"未知任务 ID: {job_id}")
        return runtime

    def _default_client_factory(self, request: EngineJobRequest) -> LLMClient:
        api_key = (request.api_key or os.environ.get("VIDEO2BLOG_API_KEY", "")).strip()
        return LLMClient(api_key=api_key, api_base=request.api_base, model=request.model)

    def _validate_request(self, request: EngineJobRequest) -> None:
        if request.mode not in VALID_MODES:
            raise ValueError(f"未知 MODE: {request.mode}")
        if request.routing not in VALID_ROUTINGS:
            raise ValueError(f"未知 ROUTING: {request.routing}")
        if request.max_retries < 0:
            raise ValueError("max_retries 不能小于 0")
        if request.rewrite_strategy not in VALID_REWRITE_STRATEGIES:
            raise ValueError(
                f"未知 rewrite_strategy: {request.rewrite_strategy!r}，"
                f"可选 {sorted(VALID_REWRITE_STRATEGIES)}"
            )
        self._resolve_source(request.source)

    def _resolve_source(self, source: str) -> Path:
        path = Path(source)
        if not path.is_absolute():
            path = self.repo_root / path
        path = path.resolve()
        if not self.allow_external_source:
            try:
                path.relative_to(self.repo_root)
            except ValueError as exc:
                raise ValueError(
                    "输入源必须位于仓库根目录内。"
                    "如确需使用外部 source，请设置 VIDEO2BLOG_ALLOW_EXTERNAL_SOURCE=1 后重启服务。"
                ) from exc
        if not path.exists():
            raise FileNotFoundError(f"输入源文件不存在: {path}")
        if not path.is_file():
            raise ValueError(f"输入源不是文件: {path}")
        return path

    def _infer_stem(self, source_path: Path) -> str:
        stem = source_path.parent.name
        if stem in {"Text", "input", "work", "output"}:
            stem = source_path.stem
        return stem

    def _infer_review_path(self, final_path: Path) -> str | None:
        try:
            relative = final_path.relative_to(self.repo_root)
        except ValueError:
            return str(final_path)
        parts = list(relative.parts)
        if len(parts) >= 4 and parts[0] == "output" and parts[1] == "Posts":
            review = self.repo_root / "output" / "Reviews" / (final_path.stem + ".review.md")
            return self._existing_rel(review)
        return None

    def _existing_rel(self, path: Path) -> str | None:
        return self._to_repo_relative(path) if path.exists() else None

    def _to_repo_relative(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.repo_root))
        except ValueError:
            return str(path)

    def _now(self) -> str:
        return datetime.now().isoformat(timespec="seconds")

    def _append_event(self, runtime: _JobRuntime, event: dict[str, Any]) -> None:
        events_path = self.repo_root / "work" / runtime.job.stem / "events.jsonl"
        try:
            events_path.parent.mkdir(parents=True, exist_ok=True)
            with events_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        except OSError:
            # Event persistence is observability only; it must not break the running job.
            pass

    def _restore_jobs_from_disk(self) -> None:
        work_root = self.repo_root / "work"
        if not work_root.is_dir():
            return
        for state_path in sorted(work_root.glob("*/.state.json")):
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            stem = state.get("stem") or state_path.parent.name
            variables = state.get("variables") if isinstance(state.get("variables"), dict) else {}
            request = EngineJobRequest(
                source=str(variables.get("SOURCE") or f"work/{stem}/raw.txt"),
                speaker=str(variables.get("SPEAKER") or "我"),
                routing=str(variables.get("ROUTING") or "/default"),
                mode=str(state.get("mode") or variables.get("MODE") or "quick"),
                max_retries=0,
                force=False,
                pause_on_outline=True,
                api_key=None,
            )
            restored_status, error = self._restored_http_status(str(state.get("status") or "PENDING"))
            now = self._now()
            job = EngineJob(
                id="disk-" + uuid.uuid5(uuid.NAMESPACE_URL, str(state_path.resolve())).hex[:20],
                status=restored_status,
                request=request,
                stem=str(stem),
                created_at=str(state.get("created_at") or now),
                updated_at=str(state.get("updated_at") or now),
                final_post_path=state.get("final_post_path"),
                error=error,
            )
            best_ver = state.get("best_version", state.get("version", 1))
            job.clean_path = self._existing_rel(self.repo_root / "work" / job.stem / "clean.md")
            job.insights_path = self._existing_rel(self.repo_root / "work" / job.stem / "insights.md")
            job.outline_path = self._existing_rel(self.repo_root / "work" / job.stem / "outline.md")
            review_json = self.repo_root / "work" / job.stem / f"review_v{best_ver}.json"
            if review_json.exists():
                job.review_path = self._to_repo_relative(review_json)
            if job.final_post_path:
                final_abs = self.repo_root / job.final_post_path
                inferred = self._infer_review_path(final_abs) if final_abs.exists() else None
                job.review_path = inferred or job.review_path
            runtime = _JobRuntime(job=job)
            self._load_persisted_events(runtime)
            with self._lock:
                self._jobs[job.id] = runtime

    def _restored_http_status(self, engine_status: str) -> tuple[str, str | None]:
        if engine_status == "FINISHED":
            return "succeeded", None
        if engine_status in {"WAITING_USER_OUTLINE", "WAITING_USER_REVIEW"}:
            return "paused", None
        if engine_status in {"FAILED", "CANCELLED"}:
            return "failed", "任务在上一次服务运行中已失败或取消。"
        return "failed", "服务重启前任务未到达稳定暂停点；请使用 force 重跑或检查 work/ 产物。"

    def _load_persisted_events(self, runtime: _JobRuntime) -> None:
        events_path = self.repo_root / "work" / runtime.job.stem / "events.jsonl"
        if not events_path.exists():
            return
        events: list[dict[str, Any]] = []
        for line in events_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)
        runtime.events = events

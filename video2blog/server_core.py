"""Local service primitives for running Video2Blog engine jobs."""

from __future__ import annotations

import collections
import contextlib
import io
import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

from video2blog.engine import Engine, LLMClient
from video2blog.engine.whisper_assets import (
    ensure_model,
    ffmpeg_env,
    ggml_backend_env,
    is_frozen,
    transcription_supported,
    whisper_cli_path,
)


VALID_ROUTINGS = {"/default", "/lecture", "/dialogue", "/screencast", "/meeting"}
VALID_MODES = {"full", "quick"}
VALID_REWRITE_STRATEGIES = {"single", "sectioned"}
# 视频源（任务会先跑前三步转录成 raw.txt 再进 Step 3–8）
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".flv", ".avi"}


def transcription_available() -> bool:
    """本机能否跑视频转录（前三步）。

    委托 whisper_assets.transcription_supported()：
    - 打包版（frozen）需打包的 whisper.cpp 在位（已打包 → True，模型可首次下载）；
    - dev 走系统 mlx / whisper.cpp（True）。
    前端据此决定是否允许视频源，后端 _transcribe 据此 fail-closed。
    """
    return transcription_supported()


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
    # 用哪个 LLM 配置档；None = 默认档（defaultProfileId）。
    profile_id: str | None = None
    # §9-C：single = 一次性整篇（默认），sectioned = 按 outline 拆节滚动改写。
    # quick 模式或 outline 不可解析时引擎会自动回退 single，不强求按节。
    rewrite_strategy: str = "single"
    # 视频转录引擎（仅打包版视频源用）：None=跟随默认（whisper-cpp），
    # "whisper-cpp"=稳定 CPU/Metal，"mlx"=Apple 原生。dev 恒走 auto。
    transcribe_engine: str | None = None


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
    # status == "paused" 时进一步说明在哪个人工节点：
    #   "WAITING_USER_OUTLINE" → Step 5 大纲审批
    #   "WAITING_USER_REVIEW"  → Step 7 草稿审批
    # 其余时间为 None。前端不应再用"磁盘上有没有 draft 内容"反推子状态，
    # 否则 5/27 留下的 draft_v1.md 会被当成 5/28 这次的内容渲染（真实撞过的 UI bug）。
    paused_state: str | None = None

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
        # 转录（前三步）整体 wall-clock 上限，超了中止子进程并明确报错
        self.transcribe_deadline_seconds = int(
            os.environ.get("VIDEO2BLOG_TRANSCRIBE_DEADLINE", "3600")
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
        # 走出暂停 → 子状态清空，避免 UI 仍按上一个 paused_state 渲染
        job.paused_state = None
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

        # 写 state.status = "CANCELLED" 到磁盘 —— 否则取消 paused 任务后 state
        # 留在 WAITING_USER_OUTLINE，下次提交同 stem 又走 paused 分支死循环。
        # 5/28 撞过的具体 bug：用户取消后重提，引擎入口所有 if 不命中。
        # runner 的 CANCELLED → PENDING 重置会接管后续清理（旧 draft/review/cache）。
        self._write_state_status(job.stem, "CANCELLED")

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

    def _write_state_status(self, stem: str, status: str) -> None:
        """原子地把 work/<stem>/.state.json 的 status 字段改成指定值。

        不存在或解析失败时静默跳过 —— 这是兜底操作，不该让 cancel 自身失败。
        """
        state_path = self.repo_root / "work" / stem / ".state.json"
        if not state_path.exists():
            return
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            return
        state["status"] = status
        try:
            from video2blog.engine.utils import atomic_write
            atomic_write(state_path, json.dumps(state, ensure_ascii=False, indent=2))
        except Exception:
            pass

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
        # 脱敏候选必须覆盖「最终生效的 key」—— 含从钥匙串解析出来的那把，否则 keychain 来源
        # 的 key 会在日志/错误里漏出（request/env 不一定有值）。resolve_llm_config 本身不抛。
        from video2blog.engine.secrets_store import resolve_llm_config

        resolved_key = resolve_llm_config(request.profile_id, request.api_key).get("api_key")
        secret_candidates = [request.api_key, os.environ.get("VIDEO2BLOG_API_KEY"), resolved_key]

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

            # 引擎的结构化进度事件直接转成 job 事件流（前端按 event=="progress" 消费）。
            # progress 只携带语义字段（kind/step/verdict…），不含密钥，无需脱敏。
            def emit_progress_event(event_type: str, data: dict[str, Any]) -> None:
                self._emit(job.id, event_type, data)

            engine = Engine(
                repo_root=self.repo_root,
                client=client,
                cancel_check=check_cancelled,
                rewrite_strategy=request.rewrite_strategy,
                emit_event=emit_progress_event,
            )
            source_path = self._resolve_source(request.source)

            # 前三步：视频源先转录成 work/<stem>/raw.txt，再无缝接 Step 3–8。
            # 子进程隔离 + 流式 + 可取消 + 超时 + raw.txt 检查点（process_video 自带跳过）。
            if source_path.suffix.lower() in VIDEO_EXTS:
                source_path = self._transcribe(
                    source_path,
                    emit_with_tokens,
                    check_cancelled,
                    emit_progress_event,
                    force=request.force,
                    engine_choice=request.transcribe_engine,
                )

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

                    # 前端用这个字段渲染 outline 编辑器 vs 草稿审批界面，
                    # 不再依赖"磁盘上有无 draft_v* 内容"的脆弱推断
                    job.paused_state = state.get("status")
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

    def _transcribe(
        self,
        video: Path,
        emit_line: Callable[[str], None],
        cancel_check: Callable[[], bool],
        emit_event: Callable[[str, dict[str, Any]], None] | None = None,
        *,
        force: bool,
        engine_choice: str | None = None,
    ) -> Path:
        """前三步：子进程跑 video2blog.py 转录视频 → work/<stem>/raw.txt。

        子进程隔离（mlx 是最大不稳定源）；后台线程读 stdout 推队列，主循环每 0.5s
        轮询，期间检查取消与 wall-clock 超时（即便 mlx 静默也能及时中止，不 hang）。
        非交互：--no-auto-terminal + --fallback-policy auto；raw.txt 检查点由 process_video 自带。

        子进程的 stdout 是给人看的文本（CLI 直跑也读它），不强行改 NDJSON；这里在唯一
        一处把 [1/3]/[2/3]/[3/3] 标记翻成结构化 transcribe 进度事件，前端不再正则反解析。
        """

        def emit_transcribe(phase: str, **fields: Any) -> None:
            if emit_event is None:
                return
            data: dict[str, Any] = {"kind": "transcribe", "phase": phase}
            data.update({k: v for k, v in fields.items() if v is not None})
            try:
                emit_event("progress", data)
            except Exception:
                pass

        def emit_marker(line: str) -> None:
            """从子进程标记行翻出结构化转录阶段事件（音频提取 / 语音转录）。

            「成稿(done)」不在这里出，而由本方法末尾 wrapper 的确定性完成行统一发，
            保证无论子进程是否打印 [3/3]，done 恰好出一次。
            """
            if line.startswith("[1/3]"):
                emit_transcribe("audio")
            elif line.startswith("[2/3]"):
                engine = "whisper.cpp" if "whisper.cpp" in line else ("mlx-whisper" if "mlx" in line.lower() else None)
                emit_transcribe("asr", engine=engine)

        raw_txt = self.repo_root / "work" / video.stem / "raw.txt"

        # 防御：正常情况下打包版已内置 whisper.cpp（transcription_supported→True）。
        # 万一 bundle 缺失（异常打包）才走到这，给清晰错误而非费解的子进程报错。
        if not transcription_available():
            raise RuntimeError(
                "本机未找到可用的视频转录引擎。\n"
                "打包版应内置 whisper.cpp；若缺失请重新安装完整版，"
                "或改用「文字稿 / 字幕」入口（拖入 .txt / .md / .srt）。"
            )

        proc_env = dict(os.environ)
        if is_frozen():
            # 打包版：sys.executable 是 server 二进制，用它的 transcribe 子命令跑转录
            #（不能直接跑 video2blog.py 脚本）。两个引擎都打进 .app：
            #   whisper-cpp（默认）：whisper-cli + ggml 模型（我方下载，带进度）+ GGML_BACKEND_PATH
            #   mlx：mlx-whisper（Apple 原生），模型由 mlx_whisper 自动从 HF 下载，.metallib 已打包
            # 切引擎用 VIDEO2BLOG_ENGINE（默认 whisper-cpp）。两引擎都需打包的 ffmpeg 提音频。
            proc_env.update(ffmpeg_env())
            # 引擎选择优先级：job 参数 > 环境变量 > 默认 whisper-cpp。
            engine = (
                (engine_choice or os.environ.get("VIDEO2BLOG_ENGINE") or "whisper-cpp")
                .strip()
                .lower()
            ) or "whisper-cpp"
            out_tail = ["--output-dir", str(self.repo_root / "work"), "--no-auto-terminal"]

            if engine == "mlx":
                # frozen 下 cli engine=mlx → transcribe_audio_mlx → mlx-worker 子命令（已验证）。
                mlx_model = os.environ.get(
                    "VIDEO2BLOG_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"
                )
                emit_transcribe("model")
                emit_line(f"[前三步] 引擎 mlx（{mlx_model}，模型首次用时下载）…")
                cmd = [
                    sys.executable, "transcribe", str(video),
                    "--engine", "mlx", "--model", mlx_model,
                    "--fallback-policy", "stop",  # 打包版不静默回退，失败直接报
                    *out_tail,
                ]
            else:
                # whisper.cpp（默认）：模型首次下载（带 SSE 进度），ggml backend 目录经 env 指定。
                cli = whisper_cli_path()
                assert cli is not None  # transcription_available 已校验在位

                emit_transcribe("model")
                emit_line("[前三步] 准备转录模型（首次需下载，约 1.6GB，后续复用）…")

                def _on_dl(done: int, total_bytes: int) -> None:
                    pct = int(done * 100 / total_bytes) if total_bytes else 0
                    emit_transcribe("model", percent=pct, mb=round(total_bytes / 1_048_576))

                try:
                    model_path = ensure_model(_on_dl)
                except Exception as exc:  # noqa: BLE001
                    raise RuntimeError(f"转录模型下载失败：{exc}") from exc

                cmd = [
                    sys.executable, "transcribe", str(video),
                    "--engine", "whisper-cpp",
                    "--whisper-cpp-bin", str(cli),
                    "--whisper-cpp-model", str(model_path),
                    *out_tail,
                ]
                proc_env.update(ggml_backend_env())  # ggml backend 插件目录
        else:
            # 开发态：python 直接跑 video2blog.py，引擎 auto（先 mlx，失败 fallback whisper.cpp）。
            cmd = [
                sys.executable, "video2blog.py", str(video),
                "--no-auto-terminal", "--engine", "auto", "--fallback-policy", "auto",
            ]

        if force:
            cmd.append("--force")
        emit_line(f"[前三步] 开始转录：{video.name}")
        emit_transcribe("start")

        proc = subprocess.Popen(
            cmd, cwd=str(self.repo_root),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=proc_env,
        )
        line_q: "queue.Queue[str | None]" = queue.Queue()

        def _reader() -> None:
            try:
                assert proc.stdout is not None
                for ln in proc.stdout:
                    line_q.put(ln.rstrip("\n"))
            finally:
                line_q.put(None)  # EOF 哨兵

        threading.Thread(target=_reader, daemon=True, name="v2b-asr-reader").start()

        deadline = time.monotonic() + self.transcribe_deadline_seconds
        tail: "collections.deque[str]" = collections.deque(maxlen=40)
        cancelled = timed_out = False
        while True:
            try:
                ln = line_q.get(timeout=0.5)
            except queue.Empty:
                ln = ""
            if ln is None:
                break  # 子进程输出结束
            if ln:
                emit_line(ln)
                emit_marker(ln)
                tail.append(ln)
            if cancel_check():
                cancelled = True
                proc.terminate()
                break
            if time.monotonic() > deadline:
                timed_out = True
                proc.terminate()
                break

        try:
            rc = proc.wait(timeout=8)
        except Exception:
            proc.kill()
            rc = -9

        if cancelled:
            raise RuntimeError("转录已取消")
        if timed_out:
            raise TimeoutError(f"转录超过 {self.transcribe_deadline_seconds}s 上限，已中止")
        if rc != 0:
            raise RuntimeError("转录失败（子进程退出码 %d）\n%s" % (rc, "\n".join(tail)))
        if not raw_txt.exists():
            raise RuntimeError("转录结束但未生成 raw.txt\n" + "\n".join(tail))
        emit_line(f"[前三步] 转录完成 → work/{video.stem}/raw.txt")
        emit_transcribe("done")
        return raw_txt

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
        # 按优先级链解析：request > 环境变量 > 系统钥匙串。base/model 同理（解析不到时
        # 传 None，交由 LLMClient 套自身内置默认）。
        from video2blog.engine.secrets_store import resolve_llm_config

        resolved = resolve_llm_config(
            request.profile_id, request.api_key, request.api_base, request.model
        )
        return LLMClient(
            api_key=resolved["api_key"],
            api_base=resolved["api_base"],
            model=resolved["model"],
        )

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
        # 视频源：用视频文件名作 stem（转录产物落 work/<stem>/raw.txt，与 output_paths 对齐）
        if source_path.suffix.lower() in VIDEO_EXTS:
            return source_path.stem
        stem = source_path.parent.name
        if stem in {"Text", "input", "work", "output", "Video"}:
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
            engine_status = str(state.get("status") or "PENDING")
            restored_status, error = self._restored_http_status(engine_status)
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
                # 重启 server 也要把 paused 子状态恢复，否则前端拿不到
                paused_state=engine_status if restored_status == "paused" else None,
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

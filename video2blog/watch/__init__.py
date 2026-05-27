"""Watch-mode package surface for Video2Blog."""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Callable

from video2blog.output import output_paths
from video2blog.pipeline import VIDEO_EXT, process_video
from video2blog.utils import append_log


def wait_file_stable(path: Path, repeats: int = 3, delay: float = 1.2) -> None:
    """拷贝大文件时能避免「未写完就开转」。"""
    streak = 0
    prev: int | None = None
    while streak < repeats:
        time.sleep(delay)
        if not path.exists():
            streak = 0
            prev = None
            continue
        sz = path.stat().st_size
        if sz <= 0:
            streak = 0
            prev = None
            continue
        if prev is not None and sz == prev:
            streak += 1
        else:
            streak = 1
        prev = sz


class _VideoHandler:
    """watchdog：新视频落盘稳定后异步转写。"""

    def __init__(
        self,
        *,
        output_dir: Path | None,
        default_output_dir: Path,
        model_repo: str,
        engine: str,
        whisper_cpp_model: Path | None,
        whisper_cpp_bin: str | None,
        fallback_policy: str,
        mlx_timeout_seconds: int,
        segment_minutes: float,
        force: bool,
        prompt_fallback_action: Callable[[str, list[str] | None], str],
        launch_in_macos_terminal: Callable[[list[str], Path], None],
    ) -> None:
        self._locks: dict[Path, threading.Lock] = {}
        self._output_dir = output_dir
        self._default_output_dir = default_output_dir
        self._model_repo = model_repo
        self._engine = engine
        self._whisper_cpp_model = whisper_cpp_model
        self._whisper_cpp_bin = whisper_cpp_bin
        self._fallback_policy = fallback_policy
        self._mlx_timeout_seconds = mlx_timeout_seconds
        self._segment_minutes = segment_minutes
        self._force = force
        self._prompt_fallback_action = prompt_fallback_action
        self._launch_in_macos_terminal = launch_in_macos_terminal

    def _schedule(self, path: Path) -> None:
        key = path.resolve()

        lock = self._locks.setdefault(key, threading.Lock())
        if not lock.acquire(blocking=False):
            return

        def run() -> None:
            out_root = output_paths(path, self._output_dir, self._default_output_dir)
            watch_log = out_root / "watch.log"
            try:
                wait_file_stable(path)
                process_video(
                    path,
                    output_dir=self._output_dir,
                    default_output_dir=self._default_output_dir,
                    model_repo=self._model_repo,
                    engine=self._engine,
                    whisper_cpp_model=self._whisper_cpp_model,
                    whisper_cpp_bin=self._whisper_cpp_bin,
                    external_source=None,
                    fallback_policy=self._fallback_policy,
                    terminal_command=None,
                    mlx_timeout_seconds=self._mlx_timeout_seconds,
                    segment_minutes=self._segment_minutes,
                    force=self._force,
                    prompt_fallback_action=self._prompt_fallback_action,
                    launch_in_macos_terminal=self._launch_in_macos_terminal,
                )
            except Exception as exc:  # noqa: BLE001 - watchdog worker must not fail silently.
                append_log(watch_log, f"watch job failed: video={path}, error={exc}")
                print(f"[watch] 转录失败：{path}；详见 {watch_log}", file=sys.stderr, flush=True)
            finally:
                lock.release()

        threading.Thread(target=run, daemon=True).start()


def watch_loop(
    watch_root: Path,
    *,
    output_dir: Path | None,
    default_output_dir: Path,
    model_repo: str,
    engine: str,
    whisper_cpp_model: Path | None,
    whisper_cpp_bin: str | None,
    fallback_policy: str,
    mlx_timeout_seconds: int,
    segment_minutes: float,
    force: bool,
    prompt_fallback_action: Callable[[str, list[str] | None], str],
    launch_in_macos_terminal: Callable[[list[str], Path], None],
) -> None:
    try:
        from watchdog.events import FileSystemEventHandler  # noqa: PLC0415
        from watchdog.observers import Observer  # noqa: PLC0415
    except ImportError:
        sys.exit("缺少 watchdog：pip install watchdog")

    watch_root = watch_root.expanduser().resolve()
    out_resolved = default_output_dir if output_dir is None else Path(output_dir).resolve()
    handler_state = _VideoHandler(
        output_dir=output_dir,
        default_output_dir=default_output_dir,
        model_repo=model_repo,
        engine=engine,
        whisper_cpp_model=whisper_cpp_model,
        whisper_cpp_bin=whisper_cpp_bin,
        fallback_policy=fallback_policy,
        mlx_timeout_seconds=mlx_timeout_seconds,
        segment_minutes=segment_minutes,
        force=force,
        prompt_fallback_action=prompt_fallback_action,
        launch_in_macos_terminal=launch_in_macos_terminal,
    )

    class Handler(FileSystemEventHandler):
        def on_created(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            p = Path(str(event.src_path)).resolve()
            if p.suffix.lower() not in VIDEO_EXT:
                return
            if out_resolved in p.parents or p.parent.resolve() == out_resolved:
                return
            handler_state._schedule(p)

        def on_moved(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            dest = getattr(event, "dest_path", None)
            if not dest:
                return
            p = Path(str(dest)).resolve()
            if p.suffix.lower() not in VIDEO_EXT:
                return
            if out_resolved in p.parents or p.parent.resolve() == out_resolved:
                return
            handler_state._schedule(p)

    observer = Observer()
    observer.schedule(Handler(), str(watch_root), recursive=False)
    observer.start()
    print(f"监听中：{watch_root}\n产出目录：{out_resolved}\nCtrl+C 结束", flush=True)
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
__all__ = ["watch_loop"]

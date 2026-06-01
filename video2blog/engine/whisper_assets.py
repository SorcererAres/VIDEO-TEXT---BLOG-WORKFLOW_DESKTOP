"""打包版 whisper.cpp 资产定位 + ggml 模型管理。

frozen（PyInstaller onedir）下：
- whisper.cpp 运行时闭包 stage 在 <exe_dir>/whisper/（scripts/bundle_whisper_cpp.sh 产出，
  含 whisper-cli + libwhisper/libggml*/libomp + libggml-*.so backend 插件）。
- backend 插件目录用环境变量 GGML_BACKEND_PATH 指给 ggml（非 DYLD_，hardened runtime 不清）。
- ggml 模型首次用时从 HuggingFace 下载到
  ~/Library/Application Support/com.sorcerer.video2blog/models/，后续复用。

dev（非 frozen）下走系统安装的 whisper-cpp / mlx，本模块的 bundle 相关函数返回 None。
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path
from typing import Callable

# large-v3-turbo：质量接近 large-v3、速度快很多，~1.6GB，博客转录的甜点。
DEFAULT_MODEL = "ggml-large-v3-turbo.bin"
MODEL_URL_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"


def is_frozen() -> bool:
    """是否运行在 PyInstaller 冻结二进制里。"""
    return bool(getattr(sys, "frozen", False))


def bundled_whisper_dir() -> Path | None:
    """frozen 下打包的 whisper 闭包目录（<exe_dir>/whisper/）；dev 或缺失返回 None。"""
    if not is_frozen():
        return None
    d = Path(sys.executable).resolve().parent / "whisper"
    return d if d.is_dir() else None


def whisper_cli_path() -> Path | None:
    """打包的 whisper-cli 可执行路径；不可用返回 None。"""
    d = bundled_whisper_dir()
    if d is None:
        return None
    cli = d / "whisper-cli"
    return cli if cli.exists() else None


def ggml_backend_env() -> dict[str, str]:
    """让 ggml 从打包目录加载 backend 插件的环境变量（frozen 才有）。"""
    d = bundled_whisper_dir()
    return {"GGML_BACKEND_PATH": str(d)} if d else {}


def bundled_ffmpeg_dir() -> Path | None:
    """frozen 下打包的 ffmpeg 目录（<exe_dir>/ffmpeg/）；dev 或缺失返回 None。"""
    if not is_frozen():
        return None
    d = Path(sys.executable).resolve().parent / "ffmpeg"
    return d if d.is_dir() else None


def bundled_ffmpeg_bin() -> Path | None:
    """打包的 ffmpeg 可执行；不可用返回 None（回退系统 PATH）。"""
    d = bundled_ffmpeg_dir()
    if d is None:
        return None
    exe = d / "ffmpeg"
    return exe if exe.exists() else None


def ffmpeg_env() -> dict[str, str]:
    """让 media.py 用打包 ffmpeg 的环境变量（frozen 且已打包才有）。"""
    exe = bundled_ffmpeg_bin()
    if exe is None:
        return {}
    env = {"VIDEO2BLOG_FFMPEG_BIN": str(exe)}
    ffprobe = exe.parent / "ffprobe"
    if ffprobe.exists():
        env["VIDEO2BLOG_FFPROBE_BIN"] = str(ffprobe)
    return env


def app_support_dir() -> Path:
    """跨平台用户数据目录（与 sidecar 握手文件同根）。"""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "com.sorcerer.video2blog"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(home / "AppData" / "Roaming")
        return Path(base) / "video2blog"
    return Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "video2blog"


def models_dir() -> Path:
    d = app_support_dir() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def model_filename() -> str:
    """可用 VIDEO2BLOG_WHISPER_CPP_MODEL_NAME 覆盖（换模型大小）。"""
    return os.environ.get("VIDEO2BLOG_WHISPER_CPP_MODEL_NAME", "").strip() or DEFAULT_MODEL


def default_model_path() -> Path:
    return models_dir() / model_filename()


def model_ready() -> bool:
    """模型是否已下载（>1MB 排除半截文件）。"""
    p = default_model_path()
    return p.exists() and p.stat().st_size > 1_000_000


def ensure_model(on_progress: Callable[[int, int], None] | None = None) -> Path:
    """确保 ggml 模型存在；缺则从 HuggingFace 流式下载（原子落盘）。

    on_progress(downloaded_bytes, total_bytes) 用于把下载进度 emit 给前端。
    返回模型本地路径。

    并发安全：用文件锁（flock）保证同一模型同时只有一个下载在进行——两个视频
    任务并排开时，第二个会阻塞等第一个下完直接复用，不会写坏同一个 .part。
    """
    import fcntl

    dest = default_model_path()
    if model_ready():
        return dest

    name = model_filename()
    url = MODEL_URL_BASE + name
    tmp = dest.with_suffix(dest.suffix + ".part")
    lock_path = dest.with_suffix(dest.suffix + ".lock")

    def _hook(block_num: int, block_size: int, total_size: int) -> None:
        if on_progress and total_size > 0:
            done = min(block_num * block_size, total_size)
            on_progress(done, total_size)

    with open(lock_path, "w", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh, fcntl.LOCK_EX)  # 独占锁；并发的第二个在此阻塞等待
        # 拿到锁后复查：别的进程可能已经下完了
        if model_ready():
            return dest
        tmp.unlink(missing_ok=True)
        try:
            urllib.request.urlretrieve(url, tmp, _hook)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        os.replace(tmp, dest)
    return dest


def transcription_supported() -> bool:
    """本机能否跑视频转录。

    frozen：需打包的 whisper-cli 在位（打包了就 True，模型可首次下载）。
    dev：True（走系统 mlx / whisper-cpp）。
    可用 VIDEO2BLOG_FORCE_TRANSCRIBE=1 强制 True（调试用）。
    """
    if os.environ.get("VIDEO2BLOG_FORCE_TRANSCRIBE") == "1":
        return True
    if is_frozen():
        return whisper_cli_path() is not None
    return True

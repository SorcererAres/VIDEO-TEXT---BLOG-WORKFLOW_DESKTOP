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
import threading
import urllib.request
from pathlib import Path
from typing import Callable

# large-v3-turbo：质量接近 large-v3、速度快很多，~1.6GB，博客转录的甜点。
DEFAULT_MODEL = "ggml-large-v3-turbo.bin"
MODEL_URL_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"

# 可在「设置 → 本地模型」里管理的 whisper.cpp ggml 模型档（HF ggerganov/whisper.cpp）。
# (文件名, 展示标签, 大致 MB)。质量从低到高、体积从小到大。
KNOWN_GGML_MODELS: list[tuple[str, str, int]] = [
    ("ggml-tiny.bin", "Tiny · 最快最小", 75),
    ("ggml-base.bin", "Base · 轻量", 142),
    ("ggml-small.bin", "Small · 平衡", 466),
    ("ggml-medium.bin", "Medium · 较好", 1530),
    ("ggml-large-v3-turbo.bin", "Large v3 Turbo · 默认推荐", 1600),
    ("ggml-large-v3.bin", "Large v3 · 最高质量", 3100),
]

# 后台下载状态跟踪：name → {"status": downloading/done/error, "percent": int, "error": str}
_dl_state: dict[str, dict] = {}
_dl_lock = threading.Lock()


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


def _download_to(
    dest: Path, url: str, on_progress: Callable[[int, int], None] | None = None
) -> None:
    """流式下载 url → dest，原子落盘 + 文件锁并发安全。

    flock 保证同一文件同时只有一个下载：并发的第二个阻塞等第一个下完直接复用，
    不会写坏同一个 .part。
    """
    import fcntl

    tmp = dest.with_suffix(dest.suffix + ".part")
    lock_path = dest.with_suffix(dest.suffix + ".lock")

    def _hook(block_num: int, block_size: int, total_size: int) -> None:
        if on_progress and total_size > 0:
            done = min(block_num * block_size, total_size)
            on_progress(done, total_size)

    with open(lock_path, "w", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh, fcntl.LOCK_EX)
        if dest.exists() and dest.stat().st_size > 1_000_000:
            return  # 拿到锁后复查：别的进程已下完
        tmp.unlink(missing_ok=True)
        try:
            urllib.request.urlretrieve(url, tmp, _hook)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        os.replace(tmp, dest)


def ensure_model(on_progress: Callable[[int, int], None] | None = None) -> Path:
    """确保默认 ggml 模型存在；缺则下载。转录前置调，返回模型本地路径。"""
    dest = default_model_path()
    if model_ready():
        return dest
    _download_to(dest, MODEL_URL_BASE + model_filename(), on_progress)
    return dest


# ── 「设置 → 本地模型」管理：列出 / 下载（后台）/ 删除 ──────────────────


def list_ggml_models() -> list[dict]:
    """已知 ggml 模型 + 本地状态（已下载大小 / 下载中进度 / 可下载）。"""
    out: list[dict] = []
    md = models_dir()
    for name, label, mb in KNOWN_GGML_MODELS:
        p = md / name
        downloaded = p.exists() and p.stat().st_size > 1_000_000
        with _dl_lock:
            st = dict(_dl_state.get(name, {}))
        out.append({
            "name": name,
            "label": label,
            "size_mb": mb,
            "downloaded": downloaded,
            "local_mb": round(p.stat().st_size / 1_048_576) if downloaded else 0,
            "is_default": name == DEFAULT_MODEL,
            "status": st.get("status"),       # downloading / error / None
            "percent": st.get("percent"),
            "error": st.get("error"),
        })
    return out


def ggml_download_status(name: str) -> dict:
    with _dl_lock:
        return dict(_dl_state.get(name, {}))


def start_ggml_download(name: str) -> None:
    """后台线程下载指定 ggml 模型，进度写入 _dl_state（前端轮询 list_ggml_models）。"""
    if name not in {n for n, _, _ in KNOWN_GGML_MODELS}:
        raise ValueError(f"未知模型：{name}")
    with _dl_lock:
        st = _dl_state.get(name)
        if st and st.get("status") == "downloading":
            return  # 已在下，不重复
        _dl_state[name] = {"status": "downloading", "percent": 0}

    dest = models_dir() / name
    url = MODEL_URL_BASE + name

    def _run() -> None:
        def _on_prog(done: int, total: int) -> None:
            pct = int(done * 100 / total) if total else 0
            with _dl_lock:
                _dl_state[name] = {"status": "downloading", "percent": pct}
        try:
            _download_to(dest, url, _on_prog)
            with _dl_lock:
                _dl_state[name] = {"status": "done", "percent": 100}
        except Exception as exc:  # noqa: BLE001
            with _dl_lock:
                _dl_state[name] = {"status": "error", "error": str(exc)}

    threading.Thread(target=_run, daemon=True, name=f"ggml-dl-{name}").start()


def delete_ggml_model(name: str) -> bool:
    """删除已下载的 ggml 模型。返回是否删了文件。"""
    if name not in {n for n, _, _ in KNOWN_GGML_MODELS}:
        raise ValueError(f"未知模型：{name}")
    p = models_dir() / name
    existed = p.exists()
    p.unlink(missing_ok=True)
    (p.with_suffix(p.suffix + ".part")).unlink(missing_ok=True)
    with _dl_lock:
        _dl_state.pop(name, None)
    return existed


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

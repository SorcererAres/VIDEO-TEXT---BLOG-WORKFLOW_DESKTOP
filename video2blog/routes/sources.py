"""素材：列举可用 source、上传文件、识别演讲人。"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

# 用作路由参数注解的名字（Request）必须在模块级可见：开了 from __future__ import annotations
# 后注解变字符串，FastAPI 用模块全局解析；放进 register() 内会解析失败 → 误判成 query 参数。
from fastapi import HTTPException, Request

from video2blog.routes.models import DetectSpeakerRequest
from video2blog.server_core import redact_sensitive_text

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService

_UPLOAD_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".m4v", ".webm", ".flv", ".avi"}
_UPLOAD_TEXT_EXT = {".txt", ".md", ".srt", ".vtt"}

# 自我介绍启发式（保守：名字限 2-4 汉字或短句柄，且须以标点/空格/结尾收边，
# 避免 ASR 无标点长串被贪婪抓成垃圾；抓不准就漏，走兜底，绝不抓错）
_NAME_RE = r"([一-龥]{2,4}|[A-Za-z][\w·]{1,14})"
_BOUND_RE = r"(?=[，,。.！!？?、；;：:\s）)」』】\"']|$)"
_SELF_INTRO_RES = [
    re.compile(r"大家好[，,、\s]*我(?:是|叫)\s*" + _NAME_RE + _BOUND_RE),
    re.compile(r"我(?:叫|的名字叫)\s*" + _NAME_RE + _BOUND_RE),
    re.compile(r"本期(?:的)?嘉宾(?:是|：|:)?\s*" + _NAME_RE + _BOUND_RE),
]
_DETECT_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".m4v", ".webm", ".flv", ".avi"}


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    @app.get("/sources")
    def list_sources() -> list[dict[str, Any]]:
        """列出可作为 Job source 的文件。

        扫三类位置：
          - work/<stem>/raw.txt    → ASR 转录稿(kind=transcript)
          - input/Text/*.{txt,md,srt,vtt} → 用户手放的文字稿(kind=text)
          - input/Video/*.{mp4,mov,...} → 待转录视频(kind=video，任务会先跑前三步转录)
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

        # input/Video/*.{mp4,mov,...} —— 待转录视频，任务会先跑前三步（提取音频/转录/成稿）
        video_dir = root / "input" / "Video"
        if video_dir.is_dir():
            vexts = (".mp4", ".mov", ".m4v", ".mkv", ".webm", ".flv", ".avi")
            for f in sorted(video_dir.iterdir()):
                if not f.is_file() or f.suffix.lower() not in vexts or f.name == ".gitkeep":
                    continue
                try:
                    stat = f.stat()
                    items.append({
                        "path": str(f.relative_to(root)),
                        "kind": "video",
                        "label": f.stem,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                    })
                except OSError:
                    continue

        # 最近修改的排前面(更可能是用户当前关注的素材)
        items.sort(key=lambda x: x["mtime"], reverse=True)
        return items

    @app.post("/upload")
    async def upload_source(name: str, request: Request) -> dict[str, Any]:
        """上传素材文件（原始 body，无需 multipart 依赖）。

        按扩展名归类：视频 → input/Video/，文字稿 → input/Text/；重名自动加 -N。
        落盘后即可被 /sources 列出并作为任务 source（视频会先自动转录）。
        前端用 `<input type=file>` + `fetch(body: file)`，浏览器 / Tauri 通用。
        """
        safe = Path(name).name
        if not safe or safe.startswith("."):
            raise HTTPException(status_code=400, detail="非法文件名")
        ext = Path(safe).suffix.lower()
        if ext in _UPLOAD_VIDEO_EXT:
            sub, kind = "input/Video", "video"
        elif ext in _UPLOAD_TEXT_EXT:
            sub, kind = "input/Text", "text"
        else:
            raise HTTPException(status_code=400, detail=f"不支持的类型 {ext or '(无扩展名)'}；请传视频或 .txt/.md/.srt/.vtt")

        dest_dir = root / sub
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / safe
        if dest.exists():  # 重名去重：foo.mp4 → foo-2.mp4
            stem, suffix = Path(safe).stem, Path(safe).suffix
            i = 2
            while (dest_dir / f"{stem}-{i}{suffix}").exists():
                i += 1
            dest = dest_dir / f"{stem}-{i}{suffix}"

        # 流式写临时文件再 os.replace，杜绝写一半留半个文件
        tmp = dest.with_name(dest.name + ".uploading")
        written = 0
        try:
            with tmp.open("wb") as fh:
                async for chunk in request.stream():
                    fh.write(chunk)
                    written += len(chunk)
            if written == 0:
                tmp.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="空文件")
            os.replace(tmp, dest)
        except HTTPException:
            raise
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=f"写入失败: {exc}") from exc

        return {"path": str(dest.relative_to(root)), "kind": kind, "name": dest.name, "size": written}

    @app.post("/api/detect-speaker")
    def detect_speaker(payload: DetectSpeakerRequest) -> dict[str, Any]:
        """识别演讲人主体：① 免费启发式（自我介绍句式）② 可选 LLM。识别不出返回 speaker=null，由前端走兜底。"""
        try:
            path = service._resolve_source(payload.source)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if path.suffix.lower() in _DETECT_VIDEO_EXT:
            return {"speaker": None, "method": "none", "reason": "视频尚未转录，转录后才能识别"}

        text = path.read_text(encoding="utf-8", errors="replace")[:4000]
        for rx in _SELF_INTRO_RES:
            m = rx.search(text)
            if m:
                return {"speaker": m.group(1).strip(), "method": "heuristic"}

        if not payload.use_llm:
            return {"speaker": None, "method": "none"}

        # AI 识别（用默认/指定配置档）
        from video2blog.engine.client import LLMClient
        from video2blog.engine.secrets_store import resolve_llm_config
        resolved = resolve_llm_config(payload.profile_id)
        if not resolved["api_key"]:
            return {"speaker": None, "method": "none", "reason": "未配置 API Key，无法 AI 识别"}
        try:
            client = LLMClient(
                api_key=resolved["api_key"], api_base=resolved["api_base"], model=resolved["model"],
                max_budget_tokens=20_000, per_request_timeout=20, max_total_seconds=25,
            )
            out = client.call_api(
                system_prompt=(
                    "你是信息抽取器。从转录稿判断「主讲人/受访者」的称呼或姓名，"
                    "只输出这个名字本身（如「梁老师」「白墨西」），无法判断就只输出『未知』。不要解释、不要标点。"
                ),
                user_prompt=text[:3000],
                max_retries=1,
            )
            name = (out or "").strip().strip("。.，,「」\"' \n")
            if not name or "未知" in name or len(name) > 20:
                return {"speaker": None, "method": "llm", "reason": "AI 未能从内容判断"}
            return {"speaker": name, "method": "llm"}
        except Exception as exc:
            return {"speaker": None, "method": "llm", "reason": redact_sensitive_text(str(exc), resolved["api_key"])}

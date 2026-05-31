"""文件：在 Finder/编辑器打开、列举 work 过程产物、受限只读读取仓库文件。"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    from fastapi import HTTPException

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

    @app.get("/work-files")
    def list_work_files(stem: str) -> list[dict[str, Any]]:
        """列出某任务 work/<stem>/ 下的全部中间过程产物，供「过程产物」面板浏览。

        每条 {name, path, size, mtime, kind}；内容读取走 /file（已限定 work/ 只读）。
        stem 必须是单段安全名（无路径分隔/.. ），目录须落在 work/ 内，防越权。
        """
        if not stem or "/" in stem or "\\" in stem or stem in {".", ".."}:
            raise HTTPException(status_code=400, detail="非法 stem")
        work_dir = (root / "work" / stem).resolve()
        try:
            work_dir.relative_to((root / "work").resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="stem 越权")
        if not work_dir.is_dir():
            return []

        def _kind(name: str) -> str:
            if name == "raw.txt":
                return "transcript"
            if name == "raw.srt":
                return "subtitle"
            if name == "meta.json":
                return "meta"
            if name == "clean.md":
                return "clean"
            if name == "insights.md":
                return "insights"
            if name == "outline.md":
                return "outline"
            if name.startswith("draft_v") and name.endswith(".md"):
                return "draft"
            if name.startswith("review_v") and name.endswith(".json"):
                return "review"
            if name == ".state.json":
                return "state"
            if name == "events.jsonl":
                return "events"
            if name == "raw.log":
                return "log"
            return "other"

        items: list[dict[str, Any]] = []
        for f in work_dir.iterdir():
            if not f.is_file():
                continue
            try:
                stat = f.stat()
            except OSError:
                continue
            items.append({
                "name": f.name,
                "path": str(f.relative_to(root)),
                "size": stat.st_size,
                "mtime": stat.st_mtime,
                "kind": _kind(f.name),
            })
        return items

    @app.get("/file")
    def read_repo_file(path: str) -> dict[str, str]:
        """读取仓库内 output/ 或 work/ 下的文本文件内容（artifact 阅读器用）。

        - 路径必须在 repo_root 之内，且首段限定 output/ 或 work/，防越权读任意文件。
        - 适用于历史成品（不在内存 job 列表里，无法走 /jobs/{id}/files）。
        """
        if not path:
            raise HTTPException(status_code=400, detail="path 必填")
        target = (root / path).resolve()
        try:
            rel = target.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=400, detail="路径必须在仓库根之内")
        if not rel.parts or rel.parts[0] not in ("output", "work"):
            raise HTTPException(status_code=403, detail="只允许读取 output/ 或 work/ 下的文件")
        if not target.is_file():
            raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
        return {"content": target.read_text(encoding="utf-8", errors="replace"), "path": path}

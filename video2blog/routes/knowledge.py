"""合同/知识层可编辑文件（方案 B：在 app 里配置「底层内容」）。

白名单严控：固定项 + 动态扫 knowledge/Examples/*.md（滤掉 README）。绝不暴露任意仓库文件读写。
分两层：常用（创作者日常调）/ advanced（开发者：契约+提示词，默认折叠+警告）。
item = (path, label, desc, danger)；danger=代码会解析其输出，改错会断功能。
CONFIG.md 已被「配置档 + 视频转录」覆盖，故移出白名单（不再可读写）。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from video2blog.routes.models import KnowledgeFileRequest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


class ExampleCreateRequest(BaseModel):
    """POST /knowledge/examples 入参：上传一篇范文。

    filename：纯文件名（不含路径），自动加 .md 后缀；安全字符 [\\w\\u4e00-\\u9fff\\-\\s.]+。
    content：正文（Markdown）。
    """

    filename: str
    content: str


_SAFE_FILENAME_RE = re.compile(r"^[\w一-鿿\-\s.()（）【】《》]+$")


def _safe_example_filename(raw: str) -> str:
    """规整范文文件名：去前后空白；去路径分隔；强制 .md 后缀。非法返回空串。"""
    name = raw.strip()
    if not name or "/" in name or "\\" in name or ".." in name:
        return ""
    if not _SAFE_FILENAME_RE.match(name):
        return ""
    if not name.lower().endswith(".md"):
        # 允许 .txt 自动转 .md
        if name.lower().endswith(".txt"):
            name = name[:-4] + ".md"
        else:
            name = name + ".md"
    if name.lower() == "readme.md":
        return ""  # 保留 README 不被覆盖
    return name


def _example_meta(f: Path) -> dict[str, Any]:
    """从单个范文文件读元信息（title + word_count + mtime + size）。"""
    try:
        text = f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    # 跳过 yaml frontmatter（项目范文常带 ---...---），再找标题
    from video2blog.utils import strip_frontmatter

    fm, body = strip_frontmatter(text)
    # title 优先级：frontmatter.title → body 第一行（去 #）→ stem
    title = f.stem
    if fm and isinstance(fm.get("title"), str) and fm["title"].strip():
        title = fm["title"].strip()
    else:
        for line in body.splitlines():
            s = line.strip()
            if not s or s.startswith("```"):
                continue
            title = s.lstrip("#").strip() or f.stem
            break
    # 字数：用正文（去 frontmatter）的去空白字符数（CJK 估算）
    stripped = re.sub(r"\s+", "", body)
    word_count = len(stripped)
    try:
        st = f.stat()
        size = st.st_size
        mtime = st.st_mtime
    except OSError:
        size = 0
        mtime = 0.0
    return {
        "name": f.name,
        "title": title,
        "word_count": word_count,
        "size": size,
        "mtime": mtime,
    }

_KNOWLEDGE_GROUPS: list[tuple[str, bool, list[tuple[str, str, str, bool]]]] = [
    ("写作偏好", False, [("memory/PREFERENCES.md", "写作偏好", "人称/语言/受众/目标字数/禁用套话/格式", False)]),
    ("风格与范文", False, [("knowledge/STYLE_GUIDE.md", "风格指南", "18 条写作硬规则，优先级高于范文", False)]),
    ("运行合同 · 路由", True, [("WORKFLOW.md", "运行合同", "模式/各 Step 合同/路由人设；改错影响整条流水线，≤70 行", True)]),
    ("步骤提示词", True, [
        (".cursor/skills/video2blog/clean-transcript/SKILL.md", "Step 3 清洗", "清洗 ASR 转录稿", False),
        (".cursor/skills/video2blog/extract-insights/SKILL.md", "Step 4 提炼", "提炼核心观点", False),
        (".cursor/skills/video2blog/structure-narrative/SKILL.md", "Step 5 骨架", "搭建博文骨架", False),
        (".cursor/skills/video2blog/rewrite-blog/SKILL.md", "Step 6 改写", "第一人称撰写博文", False),
        (".cursor/skills/video2blog/quality-check/SKILL.md", "Step 7 质检", "六维评分；输出格式被代码解析，改错会断功能", True),
        (".cursor/skills/video2blog/format-output/SKILL.md", "Step 8 落盘", "frontmatter 被代码校验，改错会断功能", True),
    ]),
]


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    from fastapi import HTTPException

    def _knowledge_allowed() -> set[str]:
        allowed = {rel for _g, _adv, items in _KNOWLEDGE_GROUPS for rel, _l, _d, _dg in items}
        ex_dir = root / "knowledge" / "Examples"
        if ex_dir.is_dir():
            for f in ex_dir.glob("*.md"):
                if f.name.lower() == "readme.md":
                    continue
                allowed.add(str(f.relative_to(root)))
        return allowed

    @app.get("/knowledge-files")
    def list_knowledge_files() -> list[dict[str, Any]]:
        """分组列出合同/知识层可编辑文件（带 advanced 分层），供「写作知识库」面板。"""
        groups: list[dict[str, Any]] = []
        for group, advanced, items in _KNOWLEDGE_GROUPS:
            entries = [
                {"path": rel, "label": label, "desc": desc, "danger": danger, "exists": (root / rel).is_file()}
                for rel, label, desc, danger in items
            ]
            groups.append({"group": group, "advanced": advanced, "items": entries})
        # 动态范文（滤掉 README）
        ex_dir = root / "knowledge" / "Examples"
        if ex_dir.is_dir():
            ex_items = [
                {"path": str(f.relative_to(root)), "label": f.stem, "desc": "锚定文风的参考范文", "danger": False, "exists": True}
                for f in sorted(ex_dir.glob("*.md")) if f.name.lower() != "readme.md"
            ]
            if ex_items:
                groups.append({"group": "参考范文", "advanced": False, "items": ex_items})
        return groups

    @app.get("/knowledge-file")
    def read_knowledge_file(path: str) -> dict[str, str]:
        """读取白名单内的合同/知识层文件。"""
        if path not in _knowledge_allowed():
            raise HTTPException(status_code=403, detail="该文件不在可编辑白名单内")
        target = root / path
        if not target.is_file():
            raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
        return {"content": target.read_text(encoding="utf-8", errors="replace"), "path": path}

    @app.put("/knowledge-file")
    def write_knowledge_file(payload: KnowledgeFileRequest) -> dict[str, Any]:
        """写回白名单文件（原子写）+ 轻量校验（占位符 / WORKFLOW 行数）。

        非阻塞：即便有 warning 也已落盘（引擎在任务启动时仍硬校验把关）；返回 {ok, errors}。
        改后合同指纹自动失效旧缓存（runner 取哈希）。
        """
        from video2blog.utils import atomic_write, PLACEHOLDER_RE

        rel = payload.path
        if rel not in _knowledge_allowed():
            raise HTTPException(status_code=403, detail="该文件不在可编辑白名单内")

        content = payload.content
        errors: list[str] = []
        # 占位符扫描（跳过引用/代码块行，与 Pre-Flight 约定一致）
        for lineno, line in enumerate(content.splitlines(), start=1):
            s = line.strip()
            if s.startswith(">") or s.startswith("```"):
                continue
            if PLACEHOLDER_RE.search(line):
                errors.append(f"未填占位符 第{lineno}行：{s[:60]}")
        # WORKFLOW.md ≤ 70 行硬约束（与 validate_workflow.check_workflow_docs 一致）
        if rel == "WORKFLOW.md" and len(content.splitlines()) > 70:
            errors.append(f"WORKFLOW.md 超过 70 行（当前 {len(content.splitlines())} 行），引擎校验会拒绝")

        atomic_write(root / rel, content)
        return {"ok": len(errors) == 0, "errors": errors, "path": rel}

    # ─── 范文 Examples CRUD（风格页用） ─────────────────────────────────
    # 接口跟 _KNOWLEDGE_GROUPS 白名单是平行的：范文是用户可增删的素材，
    # 不在固定白名单里；这里给前端"风格页"提供专用的 list / upload / delete。

    @app.get("/knowledge/examples")
    def list_examples() -> list[dict[str, Any]]:
        """列 knowledge/Examples/*.md（滤 README）。返回 title / word_count / size / mtime。"""
        ex_dir = root / "knowledge" / "Examples"
        if not ex_dir.is_dir():
            return []
        items = [
            _example_meta(f)
            for f in sorted(ex_dir.glob("*.md"))
            if f.name.lower() != "readme.md"
        ]
        # 最新上传的排前面
        items.sort(key=lambda x: x.get("mtime") or 0, reverse=True)
        return items

    @app.post("/knowledge/examples")
    def upload_example(payload: ExampleCreateRequest) -> dict[str, Any]:
        """上传一篇范文（JSON：filename + content）。

        - filename：去路径分隔、强制 .md 后缀；非法 → 400
        - 同名冲突 → 409（前端提示用户改名或先删旧）
        - 写盘后返回新文件的 meta（让前端立刻塞进列表，不必再 GET 一遍）
        """
        from video2blog.engine.utils import atomic_write

        safe = _safe_example_filename(payload.filename)
        if not safe:
            raise HTTPException(
                status_code=400,
                detail="文件名非法：仅允许中英文 / 数字 / 空格 / - . ( ) （ ） 【 】 《 》，且不能是 README",
            )
        ex_dir = root / "knowledge" / "Examples"
        ex_dir.mkdir(parents=True, exist_ok=True)
        target = ex_dir / safe
        if target.exists():
            raise HTTPException(
                status_code=409,
                detail=f"已存在同名范文：{safe}。先删旧的或改名再上传。",
            )
        atomic_write(target, payload.content)
        return {"ok": True, **_example_meta(target)}

    @app.delete("/knowledge/examples/{name}")
    def delete_example(name: str) -> dict[str, Any]:
        """删除一篇范文。name 必须是合法文件名（不含路径）。"""
        if "/" in name or "\\" in name or ".." in name:
            raise HTTPException(status_code=400, detail="非法文件名")
        if name.lower() == "readme.md":
            raise HTTPException(status_code=403, detail="README.md 不可删除")
        target = root / "knowledge" / "Examples" / name
        if not target.is_file():
            raise HTTPException(status_code=404, detail=f"范文不存在: {name}")
        target.unlink()
        return {"ok": True, "name": name}

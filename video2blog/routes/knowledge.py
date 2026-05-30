"""合同/知识层可编辑文件（方案 B：在 app 里配置「底层内容」）。

白名单严控：固定项 + 动态扫 knowledge/Examples/*.md（滤掉 README）。绝不暴露任意仓库文件读写。
分两层：常用（创作者日常调）/ advanced（开发者：契约+提示词，默认折叠+警告）。
item = (path, label, desc, danger)；danger=代码会解析其输出，改错会断功能。
CONFIG.md 已被「配置档 + 视频转录」覆盖，故移出白名单（不再可读写）。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from video2blog.routes.models import KnowledgeFileRequest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService

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

"""Step 5 outline.md 解析器。

把 structure-narrative skill 约定的骨架文档切成 intro / body / outro，
供 Step 6 按节滚动改写（§9-C）使用。纯函数，零外部依赖，幂等可测。

约定格式（与 .cursor/skills/video2blog/structure-narrative/SKILL.md 对齐）：

    ## 标题候选
    ...

    ## 骨架
    ### 导语
    导语骨架描述...

    ### 正文
    - `## 节标题 A`：承载 X 观点 + Y 案例。
    - `## 节标题 B`：承载 ...

    ### 收尾
    收尾骨架描述...

解析失败（缺 ## 骨架 / ### 正文 / 正文 0 节）时返回 has_skeleton=False，
调用方据此回退到一次性整篇改写路径——绝不静默走偏。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BodySection:
    """正文中的一节。"""
    heading: str  # 节标题（带 `## ` 前缀，照 outline 原样保留，便于拼接）
    brief: str    # 骨架描述（"承载 X + Y" 那段）


@dataclass(frozen=True)
class OutlineSections:
    intro: str  # 导语骨架描述
    body: list[BodySection] = field(default_factory=list)
    outro: str = ""
    has_skeleton: bool = True

    @property
    def total_calls(self) -> int:
        """按节改写需要的 LLM 调用次数 = 导语 1 + 正文 N + 收尾 1。"""
        if not self.has_skeleton:
            return 0
        return 1 + len(self.body) + 1


# 正文列表项：`- \`## 节标题\`：骨架描述`（兼容 - / *、中英冒号）
_BODY_ITEM_RE = re.compile(
    r"^\s*[-*]\s*`(##\s+[^`]+)`\s*[:：]\s*(.*?)\s*$",
    re.MULTILINE,
)

_SKELETON_RE = re.compile(r"^##\s*骨架\b", re.MULTILINE)
_INTRO_RE = re.compile(
    r"^###\s*导语\b\s*\n(.*?)(?=^###\s|^##\s|\Z)",
    re.MULTILINE | re.DOTALL,
)
_BODY_RE = re.compile(
    r"^###\s*正文\b\s*\n(.*?)(?=^###\s|^##\s|\Z)",
    re.MULTILINE | re.DOTALL,
)
_OUTRO_RE = re.compile(
    r"^###\s*收尾\b\s*\n(.*?)(?=^###\s|^##\s|\Z)",
    re.MULTILINE | re.DOTALL,
)


def parse_outline_sections(outline_text: str) -> OutlineSections:
    """Parse Step 5 outline.md into intro / body / outro segments."""
    if not _SKELETON_RE.search(outline_text):
        return OutlineSections(intro="", body=[], outro="", has_skeleton=False)

    body_match = _BODY_RE.search(outline_text)
    if not body_match:
        return OutlineSections(intro="", body=[], outro="", has_skeleton=False)

    intro_match = _INTRO_RE.search(outline_text)
    outro_match = _OUTRO_RE.search(outline_text)

    intro_text = intro_match.group(1).strip() if intro_match else ""
    outro_text = outro_match.group(1).strip() if outro_match else ""
    body_block = body_match.group(1)

    body_sections = [
        BodySection(heading=m.group(1).strip(), brief=m.group(2).strip())
        for m in _BODY_ITEM_RE.finditer(body_block)
    ]

    if not body_sections:
        return OutlineSections(
            intro=intro_text, body=[], outro=outro_text, has_skeleton=False
        )

    return OutlineSections(
        intro=intro_text, body=body_sections, outro=outro_text, has_skeleton=True
    )

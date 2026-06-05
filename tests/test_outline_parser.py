"""单测 video2blog/engine/outline.py — Step 5 骨架解析器。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from textwrap import dedent

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from video2blog.engine.outline import (  # noqa: E402
    BodySection,
    OutlineSections,
    parse_outline_sections,
)


class TestParseOutlineSections(unittest.TestCase):
    def test_canonical_skeleton_parsed_to_intro_body_outro(self) -> None:
        text = dedent(
            """
            ## 标题候选
            1. A
            2. B

            ## 骨架
            ### 导语
            开门见山——一个反直觉判断。

            ### 正文
            - `## 没测试的代码会腐烂`：承载"出生即腐烂"观点 + 三个月后不敢碰的感受。
            - `## 测试的真功能`：承载"不是质保是底气"的翻转 + 区分质保 vs 底气。

            ### 收尾
            点出方向差异，收束在工程心态上。
            """
        )
        result = parse_outline_sections(text)
        self.assertTrue(result.has_skeleton)
        self.assertIn("反直觉判断", result.intro)
        self.assertEqual(len(result.body), 2)
        self.assertEqual(result.body[0].heading, "## 没测试的代码会腐烂")
        self.assertIn("出生即腐烂", result.body[0].brief)
        self.assertEqual(result.body[1].heading, "## 测试的真功能")
        self.assertIn("方向差异", result.outro)
        # 调用次数 = 导语 + N 节 + 收尾
        self.assertEqual(result.total_calls, 4)

    def test_accepts_english_colon_and_asterisk_bullets(self) -> None:
        text = dedent(
            """
            ## 骨架
            ### 正文
            * `## A`: brief one
            * `## B`: brief two
            """
        )
        result = parse_outline_sections(text)
        self.assertTrue(result.has_skeleton)
        self.assertEqual([s.heading for s in result.body], ["## A", "## B"])

    def test_missing_skeleton_marker_returns_has_skeleton_false(self) -> None:
        # 没有 ## 骨架 整段，调用方应回退到 single 路径
        text = "## 标题候选\n1. X\n\n## 内容\n随便写写。\n"
        result = parse_outline_sections(text)
        self.assertFalse(result.has_skeleton)
        self.assertEqual(result.body, [])
        self.assertEqual(result.total_calls, 0)

    def test_missing_body_section_returns_has_skeleton_false(self) -> None:
        # 有 ## 骨架 + ### 导语，但缺 ### 正文
        text = dedent(
            """
            ## 骨架
            ### 导语
            就一句话。

            ### 收尾
            完事。
            """
        )
        result = parse_outline_sections(text)
        self.assertFalse(result.has_skeleton)

    def test_body_with_zero_items_returns_has_skeleton_false(self) -> None:
        # 有 ### 正文 但下面没有合法列表项 → 不应假装能按节
        text = dedent(
            """
            ## 骨架
            ### 导语
            开场。

            ### 正文
            （这里随手写了点东西但没列表）

            ### 收尾
            收束。
            """
        )
        result = parse_outline_sections(text)
        self.assertFalse(result.has_skeleton)

    def test_intro_or_outro_optional_when_body_present(self) -> None:
        # 没 ### 导语 / 没 ### 收尾，但有正文列表项 — 仍算可按节
        text = dedent(
            """
            ## 骨架
            ### 正文
            - `## A`：brief
            """
        )
        result = parse_outline_sections(text)
        self.assertTrue(result.has_skeleton)
        self.assertEqual(result.intro, "")
        self.assertEqual(result.outro, "")
        self.assertEqual(len(result.body), 1)
        self.assertEqual(result.total_calls, 3)

    def test_indented_sub_bullets_as_brief(self) -> None:
        """5/28 sectioned live 验证撞到的 outline 真实格式：LLM 把 brief 写成
        缩进的子列表（没冒号紧跟），而不是同行 ': brief'。parser 必须能从下方
        缩进行合并出 brief。"""
        text = dedent(
            """
            ## 骨架
            ### 导语
            开场用对比抛出"搬运 vs 学习"的判断标准。

            ### 正文

            - `## 搬知识和学习的本质区别`
              - 定义搬运：知识本身无改变
              - 定义学习：认知结构发生改变
              - 布鲁姆分类法作为检验标准

            - `## 三个根源：砖、搬、你`
              - **砖有问题**：知识本身无用
              - **搬有问题**：方法不对，只记不用

            ### 收尾
            收束到"学完以后你变了没有"的可执行判断。
            """
        )
        result = parse_outline_sections(text)
        self.assertTrue(result.has_skeleton, "缩进子列表格式必须识别为可按节")
        self.assertEqual(len(result.body), 2)
        self.assertEqual(result.body[0].heading, "## 搬知识和学习的本质区别")
        self.assertEqual(result.body[1].heading, "## 三个根源：砖、搬、你")
        # brief 必须合并子列表内容（不能是空），否则按节 prompt 缺失承载描述
        self.assertIn("定义搬运", result.body[0].brief)
        self.assertIn("布鲁姆", result.body[0].brief)
        self.assertIn("砖有问题", result.body[1].brief)
        self.assertEqual(result.total_calls, 4)  # 导语 + 2 节 + 收尾

    def test_mixed_inline_colon_and_indented_brief(self) -> None:
        """同一份 outline 里两种 brief 格式混用也得能识别全。"""
        text = dedent(
            """
            ## 骨架
            ### 正文
            - `## A`: 同行 brief A
            - `## B`
              - 缩进 brief B1
              - 缩进 brief B2
            - `## C`：中文冒号 brief C
            """
        )
        result = parse_outline_sections(text)
        self.assertTrue(result.has_skeleton)
        self.assertEqual([s.heading for s in result.body], ["## A", "## B", "## C"])
        self.assertIn("同行 brief A", result.body[0].brief)
        self.assertIn("缩进 brief B1", result.body[1].brief)
        self.assertIn("缩进 brief B2", result.body[1].brief)
        self.assertIn("中文冒号 brief C", result.body[2].brief)

    def test_data_class_is_immutable(self) -> None:
        sec = BodySection(heading="## X", brief="y")
        with self.assertRaises(AttributeError):
            sec.heading = "## Y"  # type: ignore[misc]
        outline = OutlineSections(intro="i", body=[sec], outro="o")
        with self.assertRaises(AttributeError):
            outline.intro = "changed"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()

"""Regression smoke tests — let CI run the engine end-to-end on golden fixtures with a mock LLM.

These tests are the "fixtures golden set" mentioned in docs/桌面端方案.md §6: 任何 prompt /
合同 / runner 改动都靠它兜底，确保引擎"确定性环节"（状态机、缓存键、frontmatter、VIEWER_RE、
HISTORY、fingerprints）不退化。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.regression import run_fixture  # noqa: E402

FIXTURES_ROOT = REPO_ROOT / "tests" / "fixtures" / "regression"


class TestRegressionFixtures(unittest.TestCase):
    """金标 fixture 必须始终 PASS；失败就是引擎退化的告警。"""

    def test_quick_basic_fixture_passes(self) -> None:
        result = run_fixture(FIXTURES_ROOT / "quick_basic", REPO_ROOT)
        self.assertTrue(result.ok, msg=f"quick_basic regression failed: {result.errors}")
        self.assertEqual(len(result.mock_calls), 2, "quick 模式只该调 Step 6 + Step 7 两次")
        self.assertEqual(result.pass_score, "55/60")
        self.assertTrue(
            result.final_post_path and result.final_post_path.startswith("output/Posts/"),
            msg=f"final_post_path 不规范: {result.final_post_path}",
        )

    def test_full_basic_fixture_passes(self) -> None:
        result = run_fixture(FIXTURES_ROOT / "full_basic", REPO_ROOT)
        self.assertTrue(result.ok, msg=f"full_basic regression failed: {result.errors}")
        self.assertEqual(len(result.mock_calls), 5, "full 模式应跑 Step 3-7 共 5 次")
        steps_called = [c["step"] for c in result.mock_calls]
        self.assertEqual(
            steps_called,
            [
                "clean-transcript",
                "extract-insights",
                "structure-narrative",
                "rewrite-blog",
                "quality-check",
            ],
            msg=f"full 模式 step 顺序错: {steps_called}",
        )
        self.assertEqual(result.pass_score, "54/60")

    def test_quick_self_correction_runs_two_rounds(self) -> None:
        """§9-A 自修正闭环：v1 REVIEW → v2 PASS → FINISHED。"""
        result = run_fixture(FIXTURES_ROOT / "quick_self_correction", REPO_ROOT)
        self.assertTrue(result.ok, msg=f"quick_self_correction failed: {result.errors}")
        self.assertEqual(len(result.mock_calls), 4, "v1 + v2 各调 rewrite + check，共 4 次")
        fixture_files = [c["fixture_file"] for c in result.mock_calls]
        self.assertEqual(
            fixture_files,
            [
                "rewrite-blog.md",  # v1 初稿
                "quality-check.json",  # v1 评审 → REVIEW
                "rewrite-blog-v2.md",  # 自修正第 2 轮重写
                "quality-check-v2.json",  # v2 评审 → PASS
            ],
            msg=f"自修正调用顺序错: {fixture_files}",
        )
        self.assertEqual(result.pass_score, "55/60", "最终成品应记录 v2 的 PASS 分数")

    def test_quick_parse_failed_skips_self_correction(self) -> None:
        """§2.3 Step 7 解析失败硬 guard：parse_failed 跳过自修正，直接转人工。"""
        result = run_fixture(FIXTURES_ROOT / "quick_parse_failed", REPO_ROOT)
        self.assertTrue(result.ok, msg=f"quick_parse_failed failed: {result.errors}")
        # 关键：尽管 max_retries=1，引擎也不应该跑第 2 轮——只有 2 次调用
        self.assertEqual(
            len(result.mock_calls),
            2,
            f"parse_failed 必须跳过自修正，actual={[c['fixture_file'] for c in result.mock_calls]}",
        )
        self.assertEqual(result.pass_score, "—/60")
        # paused 终态下 final_post_path 必须为空（引擎根本没走到 Step 8 落盘）
        self.assertFalse(result.final_post_path, msg="paused 终态不该有 final_post_path")

    def test_full_sectioned_fixture_passes(self) -> None:
        """§9-C 按节滚动改写：Step 6 拆 intro/body-00/body-01/outro 共 4 次调用。"""
        result = run_fixture(FIXTURES_ROOT / "full_sectioned", REPO_ROOT)
        self.assertTrue(result.ok, msg=f"full_sectioned regression failed: {result.errors}")
        self.assertEqual(len(result.mock_calls), 8, "sectioned 应总计 8 次调用")
        rewrite_calls = [c for c in result.mock_calls if c["step"] == "rewrite-blog"]
        self.assertEqual(len(rewrite_calls), 4, "Step 6 应按节拆成 4 次")
        section_kinds = [c["section_kind"] for c in rewrite_calls]
        self.assertEqual(
            section_kinds,
            ["intro", "body", "body", "outro"],
            msg=f"按节调用顺序错: {section_kinds}",
        )
        fixture_files = [c["fixture_file"] for c in rewrite_calls]
        self.assertEqual(
            fixture_files,
            [
                "rewrite-blog-intro.md",
                "rewrite-blog-body-00.md",
                "rewrite-blog-body-01.md",
                "rewrite-blog-outro.md",
            ],
            msg=f"按节 fixture 路由错: {fixture_files}",
        )
        self.assertEqual(result.pass_score, "54/60")


class TestRegressionGuardrails(unittest.TestCase):
    """验证 regression 自身是真在校验，不是空跑通过——防止守卫失效却悄无声息 PASS。"""

    def test_missing_expected_file_fails(self) -> None:
        """如果 fixture 缺 expected/quality-check.json，run_fixture 必须给出明确错误。"""
        import shutil
        import tempfile

        with tempfile.TemporaryDirectory(prefix="v2b-fixture-guard-") as tmp:
            tmp_fixture = Path(tmp) / "broken_quick"
            shutil.copytree(FIXTURES_ROOT / "quick_basic", tmp_fixture)
            (tmp_fixture / "expected" / "quality-check.json").unlink()

            result = run_fixture(tmp_fixture, REPO_ROOT)
            self.assertFalse(result.ok)
            self.assertTrue(
                any("quality-check.json" in err for err in result.errors),
                msg=f"errors 未提到缺失文件: {result.errors}",
            )


if __name__ == "__main__":
    unittest.main()

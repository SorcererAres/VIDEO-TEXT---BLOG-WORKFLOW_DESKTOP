from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import migrate_post_frontmatter, update_fingerprint, validate_workflow


class WorkflowScriptTests(unittest.TestCase):
    def test_fingerprint_generates_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            post = repo / "post.md"
            post.write_text("---\ntitle: T\n---\n# 标题\n\n我先提出一个问题。然后给出答案。\n", encoding="utf-8")
            record = update_fingerprint.fingerprint(post, repo)
            self.assertEqual(record["paragraph_count"], 1)
            self.assertGreater(record["avg_sentence_len"], 0)
            self.assertIn("path", record)

    def test_validate_detects_placeholder(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            (repo / "memory").mkdir()
            (repo / "memory/PREFERENCES.md").write_text("____________\n", encoding="utf-8")
            (repo / "memory/CONFIG.md").write_text("ok\n", encoding="utf-8")
            (repo / "memory/HISTORY.md").write_text("| 日期 | 标题 | 演讲人 | 摘要 | 路径 |\n", encoding="utf-8")
            errors: list[str] = []
            validate_workflow.check_placeholders(repo, errors)
            self.assertTrue(any("placeholder" in item for item in errors))

    def test_migrate_post_frontmatter_repairs_legacy_fields(self) -> None:
        original = """---

## title: A title: with colon
date: 2026-05-19
entry: video
routing: /lecture
speaker: Someone
structure: Knowledge/Structures/pyramid.md
style: Knowledge/Styles/deep-dive.md
source: old/source.txt
pass_score: 53/60

# A title: with colon

Body stays here.
"""
        migrated = migrate_post_frontmatter.normalize_post_text(original)
        migrated_again = migrate_post_frontmatter.normalize_post_text(migrated)
        self.assertEqual(migrated, migrated_again)
        self.assertIn('title: "A title: with colon"\n', migrated)
        self.assertIn("mode: full\n", migrated)
        self.assertNotIn("structure:", migrated)
        self.assertNotIn("style:", migrated)
        self.assertIn("# A title: with colon\n\nBody stays here.\n", migrated)

    def test_validate_rejects_invalid_post_fields(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            post_dir = repo / "output/Posts/2026"
            post_dir.mkdir(parents=True)
            post = post_dir / "bad.md"
            post.write_text(
                "---\n"
                "title: T\n"
                "date: 2026-05-19\n"
                "entry: note\n"
                "mode: draft\n"
                "routing: /bad\n"
                "speaker: S\n"
                "source: x\n"
                "pass_score: pass\n"
                "---\n\n"
                "# T\n",
                encoding="utf-8",
            )
            errors: list[str] = []
            validate_workflow.check_posts(repo, errors, lenient=False)
            self.assertTrue(any("invalid entry" in item for item in errors))
            self.assertTrue(any("invalid mode" in item for item in errors))
            self.assertTrue(any("invalid routing" in item for item in errors))
            self.assertTrue(any("invalid pass_score" in item for item in errors))

    def test_pass_score_regex_accepts_em_dash_for_parse_failed(self) -> None:
        # 数字评分仍合法
        self.assertIsNotNone(validate_workflow.PASS_SCORE_RE.fullmatch("57/60"))
        self.assertIsNotNone(validate_workflow.PASS_SCORE_RE.fullmatch("0/60"))
        # Step 7 解析失败时引擎写 "—/60"，DRAFT 落盘后这是合法的"未评分"占位
        self.assertIsNotNone(validate_workflow.PASS_SCORE_RE.fullmatch("—/60"))
        self.assertIsNotNone(validate_workflow.PASS_SCORE_RE.fullmatch("-/60"))
        # 真垃圾仍要拒
        self.assertIsNone(validate_workflow.PASS_SCORE_RE.fullmatch("abc/60"))
        self.assertIsNone(validate_workflow.PASS_SCORE_RE.fullmatch("57"))

    def test_strip_frontmatter_handles_yaml_edge_cases(self) -> None:
        # 引号必须被剥离——否则 routing/entry/mode/pass_score 的等值检查会误报。
        data, body = validate_workflow.strip_frontmatter(
            '---\nrouting: "/lecture"\npass_score: "55/60"\n---\nbody\n'
        )
        self.assertEqual(data["routing"], "/lecture")
        self.assertEqual(data["pass_score"], "55/60")
        self.assertIn("body", body)

        # 值里的冒号不应破坏解析（split(":", 1) 已经能扛，留作回归）。
        data, _ = validate_workflow.strip_frontmatter(
            "---\ntitle: 学习：先弄清楚\n---\n"
        )
        self.assertEqual(data["title"], "学习：先弄清楚")

        # 多行 block scalar 必须能被收上来，而不是被静默丢掉。
        data, _ = validate_workflow.strip_frontmatter(
            "---\ndesc: |\n  line1\n  line2\n---\n"
        )
        self.assertEqual(data["desc"], "line1\nline2")

        # 畸形 YAML 必须 graceful 降级，不要把整个校验链炸掉。
        data, body = validate_workflow.strip_frontmatter(
            "---\ntitle: [unclosed\n---\nbody\n"
        )
        self.assertEqual(data, {})

    def test_validate_requires_fingerprint_for_published_posts(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            post_dir = repo / "output/Posts/2026"
            post_dir.mkdir(parents=True)
            (repo / "memory").mkdir()
            post = post_dir / "post.md"
            post.write_text("# T\n", encoding="utf-8")
            (repo / "memory/fingerprints.jsonl").write_text("", encoding="utf-8")

            errors: list[str] = []
            validate_workflow.check_fingerprints(repo, errors)
            self.assertTrue(any("missing fingerprint" in item for item in errors))

            rel = post.relative_to(repo)
            (repo / "memory/fingerprints.jsonl").write_text(
                f'{{"path": "{rel}"}}\n',
                encoding="utf-8",
            )
            errors = []
            validate_workflow.check_fingerprints(repo, errors)
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()

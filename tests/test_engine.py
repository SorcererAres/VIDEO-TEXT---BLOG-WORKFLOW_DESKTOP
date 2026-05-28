"""Unit tests for the Video2Blog desktop backend engine layer."""

from __future__ import annotations

import json
import time
import unittest
from pathlib import Path
import tempfile
import shutil
from unittest import mock

from video2blog.engine.utils import atomic_write
from video2blog.engine.parser import ContextLoader
from video2blog.engine.runner import (
    Engine,
    clean_title,
    combine_clean_chunks,
    extract_blog_body,
    extract_json_object,
    extract_quality_review,
    parse_markdown_review,
    parse_quality_json_review,
    looks_like_json_mode_unsupported,
    strip_runtime_scaffold,
)
from video2blog.engine.chunking import split_text_chunks
from video2blog.engine.client import LLMClient, estimate_tokens


class TestEngineUtils(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir)

    def test_atomic_write(self) -> None:
        test_file = self.tmp_dir / "test_file.txt"
        
        # Test basic write
        atomic_write(test_file, "hello atomic")
        self.assertTrue(test_file.exists())
        self.assertEqual(test_file.read_text(encoding="utf-8"), "hello atomic")
        
        # Test overwriting existing
        atomic_write(test_file, "hello overwrite")
        self.assertEqual(test_file.read_text(encoding="utf-8"), "hello overwrite")


class TestEngineParser(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        
        # Create mock preferences, config, workflow files, and skills
        (self.tmp_dir / "memory").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "knowledge").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog").mkdir(parents=True, exist_ok=True)
        
        (self.tmp_dir / "WORKFLOW.md").write_text("Mock Workflow content", encoding="utf-8")
        (self.tmp_dir / "knowledge/STYLE_GUIDE.md").write_text("Mock Style Guide", encoding="utf-8")
        (self.tmp_dir / "memory/PREFERENCES.md").write_text("Mock Preferences: speaker is {{SPEAKER}}", encoding="utf-8")
        (self.tmp_dir / "memory/CONFIG.md").write_text("Mock Config", encoding="utf-8")
        (self.tmp_dir / "memory/HISTORY.md").write_text(
            "# 近期博文索引\n\n| 日期 | 标题 | 演讲人 | 一句摘要（演讲人视角） | 成品路径 |\n|---|---|---|---|---|\n", 
            encoding="utf-8"
        )
        
        skill_content = "---\nname: rewrite-blog\n---\n# Step 6 Rewrite\nUse role {{ROUTING}}"
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog/SKILL.md").write_text(skill_content, encoding="utf-8")

        self.loader = ContextLoader(self.tmp_dir)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir)

    def test_check_placeholders(self) -> None:
        # Currently no placeholders
        errors = self.loader.check_placeholders()
        self.assertEqual(len(errors), 0)
        
        # Add placeholders
        (self.tmp_dir / "memory/PREFERENCES.md").write_text("Mock Preferences with YYYY-MM-DD and ____", encoding="utf-8")
        errors = self.loader.check_placeholders()
        self.assertTrue(len(errors) > 0)

    def test_get_skill_instruction(self) -> None:
        frontmatter, body = self.loader.get_skill_instruction("rewrite-blog")
        self.assertEqual(frontmatter.get("name"), "rewrite-blog")
        self.assertIn("# Step 6 Rewrite", body)

    def test_assemble_prompt_success(self) -> None:
        variables = {
            "SPEAKER": "张老师",
            "ROUTING": "/lecture",
            "MODE": "quick",
            "SOURCE": "raw.txt"
        }
        system, user = self.loader.assemble_prompt("rewrite-blog", variables, "Raw Transcript Text")
        
        # Verify placeholders replaced
        self.assertIn("张老师", system)
        self.assertIn("/lecture", system)
        self.assertIn("Raw Transcript Text", user)
        self.assertNotIn("{{SPEAKER}}", system)
        self.assertNotIn("{{ROUTING}}", system)

    def test_assemble_prompt_omits_workflow_when_disabled(self) -> None:
        # 回归：quality-check 这类强格式化步骤必须能关掉 WORKFLOW 注入，
        # 否则 LLM 看到 Step 3-8 全套说明后会跑歪、把工作流又复述一遍。
        variables = {"SPEAKER": "张老师", "ROUTING": "/lecture", "MODE": "quick", "SOURCE": "raw.txt"}
        (self.tmp_dir / "WORKFLOW.md").write_text(
            "# WORKFLOW\n## Step 3: clean-transcript\n## Step 6: rewrite-blog",
            encoding="utf-8",
        )
        sys_on, _ = self.loader.assemble_prompt("rewrite-blog", variables, "x", include_workflow=True)
        self.assertIn("Step 3: clean-transcript", sys_on)   # 默认应注入
        sys_off, _ = self.loader.assemble_prompt("rewrite-blog", variables, "x", include_workflow=False)
        self.assertNotIn("Step 3: clean-transcript", sys_off)
        self.assertNotIn("Step 6: rewrite-blog", sys_off)
        self.assertNotIn("## 1. 运行合同", sys_off)

    def test_assemble_prompt_fail_closed(self) -> None:
        # Missing SPEAKER variable
        variables = {
            "ROUTING": "/lecture",
            "MODE": "quick",
            "SOURCE": "raw.txt"
        }
        with self.assertRaises(ValueError):
            self.loader.assemble_prompt("rewrite-blog", variables, "Raw Transcript Text")


class TestLLMClientWallClockDeadline(unittest.TestCase):
    """回归:LLMClient 必须在 max_total_seconds 内强制返回,
    哪怕 urlopen 因 chunked dribble 永远不结束。
    这是今天撞了 3 次的"卡死"bug 的根治测试。
    """

    def test_call_api_aborts_within_wall_clock_deadline(self) -> None:
        """模拟一个永远不返回的 urlopen,call_api 必须在 deadline 后及时退出。"""
        deadline = 2  # 2 秒上限,测试要快

        # 假装是个永远 sleep 的 urlopen 调用——模拟卡死的 LLM API
        def _hanging_urlopen(*args, **kwargs):
            time.sleep(60)  # 远超 deadline
            raise AssertionError("不应该走到这里")

        client = LLMClient(
            api_key="test-key",
            per_request_timeout=10,
            max_total_seconds=deadline,
        )

        start = time.monotonic()
        with mock.patch("urllib.request.urlopen", side_effect=_hanging_urlopen):
            with self.assertRaises(TimeoutError):
                client.call_api("system", "user")
        elapsed = time.monotonic() - start

        # 必须在 deadline 后及时退出(单次 attempt 不能拖过 max_total_seconds)
        # 容忍 1.5s 系统调度 / future overhead
        self.assertLess(elapsed, deadline + 1.5, f"call_api 跑了 {elapsed:.1f}s,远超 deadline 还没退出")


class TestEngineRunnerHelpers(unittest.TestCase):
    def test_clean_title(self) -> None:
        self.assertEqual(clean_title("学习：目标《不是》做完"), "学习目标不是做完")
        self.assertEqual(clean_title("A / B \\ C"), "A-B-C")
        self.assertEqual(clean_title("How to write a blog?"), "How-to-write-a-blog")
        # 回归：中文标点(顿号/逗号/冒号)全部去掉，且与中文相邻的空格去掉而非转连字符。
        self.assertEqual(
            clean_title("AI 时代不被淘汰的三件事：问对问题、造出工具、建立信任"),
            "AI时代不被淘汰的三件事问对问题造出工具建立信任",
        )

    def test_parse_markdown_review_raises_on_missing_table(self) -> None:
        # 真实运行暴露的 bug：LLM 在 Step 7 没按合同吐评分表（跑成博文复述），
        # 此前 silent fallback 给 0/60 会误触发自修正。现在必须 raise。
        garbage = (
            "> Pre-Flight ✓\n> ENTRY → transcript\n\n"
            "## Step 3: clean-transcript\n\n"
            "我最近一直在反复跟团队讲一句话...\n"
            "## Re-Brief\n这段是博文片段，不是评分。"
        )
        with self.assertRaises(ValueError):
            parse_markdown_review(garbage)

    def test_parse_markdown_review_prefers_total_row(self) -> None:
        # 维度累加为 54，但权威「合计」行写 58，应取合计行（回归打分兜底修复）。
        md = (
            "## 评分\n"
            "| 维度 | 分 |\n|---|---|\n"
            "| 忠实度 | 9 |\n| 可读性 | 9 |\n| 观点密度 | 9 |\n"
            "| 风格一致性 | 9 |\n| 完整性 | 9 |\n| 视角忠实度 | 9 |\n"
            "| **合计** | **58/60** | — |\n\n"
            "## 判定\nPASS\n\n## Re-Brief\nok\n"
        )
        result = parse_markdown_review(md)
        self.assertEqual(result["total"], "58/60")
        self.assertEqual(result["verdict"], "PASS")

    def test_extract_json_object(self) -> None:
        text_with_fences = "Some chat introduction\n```json\n{\n  \"val\": 42\n}\n```\nSome chat conclusion"
        obj = extract_json_object(text_with_fences)
        self.assertEqual(obj.get("val"), 42)
        
        plain_json = "{\"val\": 100}"
        obj2 = extract_json_object(plain_json)
        self.assertEqual(obj2.get("val"), 100)

    def test_extract_blog_body_removes_workflow_scaffold(self) -> None:
        noisy = (
            "# Pre-Flight ✓\n"
            "> ENTRY → transcript\n\n"
            "# Step 3: clean-transcript\n"
            "clean notes\n\n"
            "# Step 6: rewrite-blog\n"
            "---\n\n"
            "<!-- video2blog: Mode=full -->\n\n"
            "# 真正的标题\n\n"
            "真正的正文。\n\n"
            "# Step 7: quality-check\n"
            "review notes\n"
        )
        cleaned = extract_blog_body(noisy)
        self.assertIn("# 真正的标题", cleaned)
        self.assertIn("真正的正文。", cleaned)
        self.assertNotIn("Pre-Flight", cleaned)
        self.assertNotIn("Step 3", cleaned)
        self.assertNotIn("Step 7", cleaned)

    def test_strip_runtime_scaffold_keeps_contracted_step_output(self) -> None:
        noisy = (
            "> Pre-Flight ✓\n"
            "> MODE → full\n\n"
            "---\n\n"
            "## 清洗稿\n\n"
            "Clean text.\n\n"
            "## 不确定清单\n- 无\n"
        )
        cleaned = strip_runtime_scaffold(noisy, r"^##\s*清洗稿\b")
        self.assertTrue(cleaned.startswith("## 清洗稿"))
        self.assertNotIn("Pre-Flight", cleaned)

    def test_extract_quality_review_removes_step_8(self) -> None:
        noisy = (
            "## Step 7: quality-check\n\n"
            "### 评分\n"
            "| 维度 | 分 |\n|---|---|\n| 忠实度 | 9 |\n| 可读性 | 9 |\n| 观点密度 | 9 |\n"
            "| 风格一致性 | 9 |\n| 完整性 | 9 |\n| 视角忠实度 | 9 |\n| **合计** | **54/60** |\n\n"
            "### 判定\nPASS\n\n"
            "### Re-Brief\nreview only\n\n"
            "---\n\n"
            "## Step 8: format-output\nshould be removed\n"
        )
        cleaned = extract_quality_review(noisy)
        parsed = parse_markdown_review(cleaned)
        self.assertIn("### 评分", cleaned)
        self.assertNotIn("Step 8", cleaned)
        self.assertEqual(parsed["rebrief"], "review only")

    def test_split_text_chunks_uses_readonly_previous_context(self) -> None:
        text = "第一句很长很长。第二句也很长很长。第三句继续很长很长。"
        chunks = split_text_chunks(text, max_chars=14, context_chars=8)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0].previous_context, "")
        self.assertTrue(chunks[1].previous_context)
        self.assertEqual(chunks[0].total, len(chunks))

    def test_combine_clean_chunks_merges_uncertain_items(self) -> None:
        combined = combine_clean_chunks(
            [
                "## 清洗稿\n\n第一段。\n\n## 不确定清单\n- [?] A",
                "## 清洗稿\n\n第二段。\n\n## 不确定清单\n- [?] A\n- [?] B",
            ]
        )
        self.assertIn("第一段。", combined)
        self.assertIn("第二段。", combined)
        self.assertEqual(combined.count("- [?] A"), 1)
        self.assertIn("- [?] B", combined)

    def test_parse_markdown_review(self) -> None:
        md_text = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 10 | ok |\n"
            "| 可读性 | 9 | ok |\n"
            "| 观点密度 | 8 | ok |\n"
            "| 风格一致性 | 9 | ok |\n"
            "| 完整性 | 7 | ok |\n"
            "| 视角忠实度 | 6 | ok |\n"
            "| **合计** | **49/60** | — |\n\n"
            "## 判定\n"
            "PASS\n\n"
            "## Re-Brief\n"
            "质量检验通过"
        )
        res = parse_markdown_review(md_text)
        self.assertEqual(res["verdict"], "PASS")
        self.assertEqual(res["scores"]["忠实度"], 10)
        self.assertEqual(res["scores"]["风格一致"], 9)
        self.assertEqual(res["scores"]["视角忠实度"], 6)
        self.assertEqual(res["total"], "49/60")
        self.assertEqual(res["rebrief"], "质量检验通过")

    def test_parse_quality_json_review_normalizes_scores(self) -> None:
        res = parse_quality_json_review(
            json.dumps(
                {
                    "verdict": "PASS",
                    "scores": {
                        "忠实度": 10,
                        "可读性": 9,
                        "观点密度": 8,
                        "风格一致性": 9,
                        "完整性": 8,
                        "视角忠实度": 9,
                    },
                    "total": "53/60",
                    "rebrief": "ok",
                },
                ensure_ascii=False,
            )
        )
        self.assertEqual(res["verdict"], "PASS")
        self.assertEqual(res["scores"]["风格一致"], 9)
        self.assertEqual(res["total"], "53/60")
        self.assertIn("## 评分", res["raw_markdown"])

    def test_json_mode_unsupported_detector_is_specific(self) -> None:
        self.assertTrue(
            looks_like_json_mode_unsupported(
                RuntimeError("LLM API 请求失败: HTTP 400\nunsupported response_format json_object")
            )
        )
        self.assertFalse(looks_like_json_mode_unsupported(RuntimeError("LLM API 请求失败: HTTP 401 invalid api key")))


class TestEngineSectionedRewriteHelpers(unittest.TestCase):
    """§9-C 按节滚动改写的纯函数辅助方法。"""

    def test_build_section_plan_orders_intro_body_outro(self) -> None:
        from video2blog.engine.outline import BodySection, OutlineSections

        sections = OutlineSections(
            intro="开场",
            body=[
                BodySection(heading="## A", brief="brief-a"),
                BodySection(heading="## B", brief="brief-b"),
            ],
            outro="收束",
        )
        plan = Engine._build_section_plan(sections)
        self.assertEqual(
            [(kind, heading) for kind, heading, _ in plan],
            [("intro", "导语"), ("body-00", "## A"), ("body-01", "## B"), ("outro", "收尾")],
        )

    def test_build_section_plan_skips_empty_intro_or_outro(self) -> None:
        from video2blog.engine.outline import BodySection, OutlineSections

        sections = OutlineSections(
            intro="",
            body=[BodySection(heading="## Only", brief="b")],
            outro="",
        )
        plan = Engine._build_section_plan(sections)
        self.assertEqual([kind for kind, *_ in plan], ["body-00"])

    def test_build_section_task_directs_mode_per_kind(self) -> None:
        # 三种 kind 的指令必须能被 mock 的 _identify_section_kind 识别
        # —— 改了模板，mock 与 runner 之间的耦合就会断。
        intro = Engine._build_section_task(
            kind="intro", heading="导语", brief="开场骨架",
            clean_text="C", insights_text="I",
        )
        self.assertIn("### 本节任务（导语", intro)
        self.assertIn("# <文章总标题>", intro)

        body = Engine._build_section_task(
            kind="body-00", heading="## 测试的真功能", brief="承载翻转",
            clean_text="C", insights_text="I",
        )
        self.assertIn("### 本节任务（正文一节）", body)
        self.assertIn("## 测试的真功能", body)

        outro = Engine._build_section_task(
            kind="outro", heading="收尾", brief="点出方向差异",
            clean_text="C", insights_text="I",
        )
        self.assertIn("### 本节任务（收尾", outro)

    def test_clean_section_output_strips_runtime_preamble(self) -> None:
        polluted = (
            "> Pre-Flight ✓\n"
            "> ENTRY → transcript\n"
            "> MODE → full\n"
            "\n"
            "# Step 6 rewrite-blog\n"
            "\n"
            "## 真功能\n"
            "正文段落 1\n"
            "\n"
            "正文段落 2\n"
        )
        cleaned = Engine._clean_section_output(polluted)
        self.assertTrue(cleaned.startswith("## 真功能"), msg=f"未剥脚手架: {cleaned[:60]!r}")
        self.assertNotIn("Pre-Flight", cleaned)
        self.assertNotIn("Step 6", cleaned)

    def test_first_title_candidate_picks_first_numbered_item(self) -> None:
        outline = (
            "## 标题候选\n"
            "1. 第一条标题\n"
            "2. 第二条\n"
            "\n"
            "## 骨架\n"
            "...\n"
        )
        self.assertEqual(Engine._first_title_candidate(outline), "第一条标题")

    def test_first_title_candidate_returns_empty_when_missing(self) -> None:
        self.assertEqual(Engine._first_title_candidate("## 骨架\n..."), "")

    def test_engine_rewrite_strategy_rejects_unknown_value(self) -> None:
        with self.assertRaises(ValueError):
            Engine(repo_root=Path("."), client=object(), rewrite_strategy="batch")


class MockLLMClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.call_count = 0
        self.calls = []
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_cost = 0.0
        self.model = "mock-model"

    def call_api(self, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        self.calls.append((system_prompt, user_prompt, json_mode))
        resp = self.responses[self.call_count]
        self.call_count += 1
        return resp


class JsonModeUnsupportedThenMarkdownClient(MockLLMClient):
    def call_api(self, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        self.calls.append((system_prompt, user_prompt, json_mode))
        if json_mode:
            raise RuntimeError("LLM API 请求失败: HTTP 400\nunsupported response_format json_object")
        resp = self.responses[self.call_count]
        self.call_count += 1
        return resp


class TestEngineRunner(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        
        # Setup folders
        (self.tmp_dir / "memory").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "knowledge").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/test_stem").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/clean-transcript").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/extract-insights").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/structure-narrative").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/quality-check").mkdir(parents=True, exist_ok=True)

        # Setup standard context files
        (self.tmp_dir / "WORKFLOW.md").write_text("Mock Workflow contract line length limit bypass", encoding="utf-8")
        (self.tmp_dir / "knowledge/STYLE_GUIDE.md").write_text("Mock Style Guide", encoding="utf-8")
        (self.tmp_dir / "memory/PREFERENCES.md").write_text("Mock Preferences: speaker is {{SPEAKER}}", encoding="utf-8")
        (self.tmp_dir / "memory/CONFIG.md").write_text("Mock Config", encoding="utf-8")
        
        # Setup mock HISTORY.md to pass check_placeholders
        (self.tmp_dir / "memory/HISTORY.md").write_text(
            "# 近期博文索引\n\n| 日期 | 标题 | 演讲人 | 一句摘要（演讲人视角） | 成品路径 |\n|---|---|---|---|---|\n", 
            encoding="utf-8"
        )

        (self.tmp_dir / ".cursor/skills/video2blog/clean-transcript/SKILL.md").write_text(
            "---\nname: clean-transcript\n---\n# Step 3 Clean\nrouting: {{ROUTING}}",
            encoding="utf-8",
        )
        (self.tmp_dir / ".cursor/skills/video2blog/extract-insights/SKILL.md").write_text(
            "---\nname: extract-insights\n---\n# Step 4 Extract\nspeaker: {{SPEAKER}}",
            encoding="utf-8",
        )
        (self.tmp_dir / ".cursor/skills/video2blog/structure-narrative/SKILL.md").write_text(
            "---\nname: structure-narrative\n---\n# Step 5 Structure\nmode: {{MODE}}",
            encoding="utf-8",
        )
        
        # Step 6 skill (contains correction template variables A4 contract requirement)
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog/SKILL.md").write_text(
            "---\nname: rewrite-blog\n---\n# Step 6 Rewrite\nrouting: {{ROUTING}}\nprev_total: {{PREV_TOTAL}}\nprev_rebrief: {{PREV_REBRIEF}}", encoding="utf-8"
        )
        # Step 7 skill
        (self.tmp_dir / ".cursor/skills/video2blog/quality-check/SKILL.md").write_text(
            "---\nname: quality-check\n---\n# Step 7 Check", encoding="utf-8"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir)

    def test_engine_run_job_success(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.write_text("This is raw transcript text", encoding="utf-8")

        # Mock API responses: Step 6 draft, Step 7 Quality Check PASS (Markdown), then Step 8 HISTORY summary
        step6_resp = "# 学习的真谛\n\n这就是博文的真正内容。"
        step7_resp = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 10 | ok |\n"
            "| 可读性 | 10 | ok |\n"
            "| 观点密度 | 9 | ok |\n"
            "| 风格一致性 | 9 | ok |\n"
            "| 完整性 | 9 | ok |\n"
            "| 视角忠实度 | 10 | ok |\n"
            "| **合计** | **57/60** | — |\n\n"
            "## 判定\n"
            "PASS\n\n"
            "## Re-Brief\n"
            "非常完美的写作"
        )
        step8_summary = "我（梁老师）分享了关于《学习的真谛》的内容。"

        mock_client = MockLLMClient([step6_resp, step7_resp, step8_summary])
        engine = Engine(self.tmp_dir, mock_client) # type: ignore
        
        post_path = engine.run_job(
            stem="test_stem",
            source_path=source_path,
            mode="quick",
            routing="/lecture",
            speaker="梁老师",
            max_retries=1
        )

        self.assertIsNotNone(post_path)
        self.assertTrue(post_path.exists())
        content = post_path.read_text(encoding="utf-8")
        self.assertIn("pass_score: 57/60", content)
        self.assertIn("entry: transcript", content)
        self.assertIn("# 学习的真谛", content)

        # 回归 N1：HISTORY 演讲人列必须是真实 speaker，而非 fallback "主讲人"
        history_content = (self.tmp_dir / "memory/HISTORY.md").read_text(encoding="utf-8")
        self.assertIn("| 梁老师 |", history_content)
        self.assertNotIn("| 主讲人 |", history_content)

        # 回归：finalize 步骤（Step 8 落盘 + HISTORY 更新）必须零 LLM 调用，
        # 否则一旦 LLM 卡死会让整篇成品永远停在 DRAFT_DONE。
        # 本次成功路径只允许 Step 6 (rewrite) + Step 7 (check) 两次调用。
        self.assertEqual(mock_client.call_count, 2)

    def test_engine_quality_check_falls_back_when_json_mode_unsupported(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.write_text("This is raw transcript text", encoding="utf-8")

        step6_resp = "# 兼容性标题\n\n这是正文。"
        step7_markdown = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 9 | ok |\n"
            "| 可读性 | 9 | ok |\n"
            "| 观点密度 | 9 | ok |\n"
            "| 风格一致性 | 9 | ok |\n"
            "| 完整性 | 9 | ok |\n"
            "| 视角忠实度 | 9 | ok |\n"
            "| **合计** | **54/60** | — |\n\n"
            "## 判定\nPASS\n\n## Re-Brief\nfallback ok"
        )

        mock_client = JsonModeUnsupportedThenMarkdownClient([step6_resp, step7_markdown])
        engine = Engine(self.tmp_dir, mock_client)  # type: ignore[arg-type]

        post_path = engine.run_job(
            stem="test_stem",
            source_path=source_path,
            mode="quick",
            routing="/lecture",
            speaker="梁老师",
            max_retries=0,
        )

        self.assertIsNotNone(post_path)
        self.assertIn("pass_score: 54/60", post_path.read_text(encoding="utf-8"))
        self.assertEqual([call[2] for call in mock_client.calls], [False, True, False])

    def test_engine_run_job_self_correction(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.write_text("This is raw transcript text", encoding="utf-8")

        # Mock API responses: 
        # 1. Step 6 draft v1
        # 2. Step 7 Quality Check REVIEW (fails, score 45) (Markdown)
        # 3. Step 6 draft v2 (revised)
        # 4. Step 7 Quality Check PASS (score 55) (Markdown)
        # 5. Step 8 summary
        step6_v1 = "# 学习目标\n\n第一版比较差。"
        step7_v1 = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 8 | ok |\n"
            "| 可读性 | 7 | ok |\n"
            "| 观点密度 | 7 | ok |\n"
            "| 风格一致性 | 8 | ok |\n"
            "| 完整性 | 7 | ok |\n"
            "| 视角忠实度 | 8 | ok |\n"
            "| **合计** | **45/60** | — |\n\n"
            "## 判定\n"
            "REVIEW\n\n"
            "## Re-Brief\n"
            "视角有偏差，缺少金句。"
        )
        step6_v2 = "# 学习目标是做到\n\n第二版，改好了。"
        step7_v2 = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 9 | ok |\n"
            "| 可读性 | 9 | ok |\n"
            "| 观点密度 | 9 | ok |\n"
            "| 风格一致性 | 9 | ok |\n"
            "| 完整性 | 9 | ok |\n"
            "| 视角忠实度 | 10 | ok |\n"
            "| **合计** | **55/60** | — |\n\n"
            "## 判定\n"
            "PASS\n\n"
            "## Re-Brief\n"
            "已修正大纲并增加金句。"
        )
        step8_summary = "我（梁老师）分享了关于《学习目标是做到》的内容。"

        mock_client = MockLLMClient([step6_v1, step7_v1, step6_v2, step7_v2, step8_summary])
        engine = Engine(self.tmp_dir, mock_client) # type: ignore
        
        post_path = engine.run_job(
            stem="test_stem",
            source_path=source_path,
            mode="quick",
            routing="/lecture",
            speaker="梁老师",
            max_retries=1
        )

        self.assertIsNotNone(post_path)
        self.assertTrue(post_path.exists())
        content = post_path.read_text(encoding="utf-8")
        self.assertIn("pass_score: 55/60", content)
        self.assertIn("# 学习目标是做到", content)
        # finalize 步骤已去 LLM 化（generate_summary 现为纯模板），故无 summary 调用。
        self.assertEqual(mock_client.call_count, 4)  # 2 Rewrite + 2 Check + 0 summary (去 LLM 化)

    def test_engine_run_job_full_mode_runs_steps_3_to_5(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.write_text("Raw ASR transcript text", encoding="utf-8")

        clean_resp = "## 清洗稿\n\nClean transcript.\n\n## 不确定清单\n- 无"
        insights_resp = "## 核心观点\n1. Build the point.\n\n## 待确认项\n- 无"
        outline_resp = "## 标题候选\n1. Full Mode Title\n\n## 骨架\n### 导语\nUse the insight."
        step6_resp = (
            "# Pre-Flight ✓\n"
            "> ENTRY → transcript\n\n"
            "# Step 6: rewrite-blog\n"
            "---\n\n"
            "# Full Mode Title\n\n"
            "This is the final body from full mode.\n\n"
            "# Step 7: quality-check\n"
            "Should be removed."
        )
        step7_resp = (
            "## 评分\n"
            "| 维度 | 分 | 依据 |\n"
            "|---|---|---|\n"
            "| 忠实度 | 9 | ok |\n"
            "| 可读性 | 9 | ok |\n"
            "| 观点密度 | 9 | ok |\n"
            "| 风格一致性 | 9 | ok |\n"
            "| 完整性 | 9 | ok |\n"
            "| 视角忠实度 | 9 | ok |\n"
            "| **合计** | **54/60** | — |\n\n"
            "## 判定\nPASS\n\n## Re-Brief\nfull ok"
        )
        summary_resp = "我（梁老师）完成了 Full Mode Title。"

        mock_client = MockLLMClient([clean_resp, insights_resp, outline_resp, step6_resp, step7_resp, summary_resp])
        engine = Engine(self.tmp_dir, mock_client) # type: ignore

        post_path = engine.run_job(
            stem="test_stem",
            source_path=source_path,
            mode="full",
            routing="/lecture",
            speaker="梁老师",
            max_retries=0,
            pause_on_outline=False,
        )

        self.assertIsNotNone(post_path)
        self.assertTrue((self.tmp_dir / "work/test_stem/clean.md").exists())
        self.assertTrue((self.tmp_dir / "work/test_stem/insights.md").exists())
        self.assertTrue((self.tmp_dir / "work/test_stem/outline.md").exists())
        # full mode: 1 clean + 1 extract + 1 outline + 1 rewrite + 1 check = 5；
        # finalize 的 summary 已去 LLM 化，故 6 → 5。
        self.assertEqual(mock_client.call_count, 5)

        draft = (self.tmp_dir / "work/test_stem/draft_v1.md").read_text(encoding="utf-8")
        self.assertIn("# Full Mode Title", draft)
        self.assertNotIn("Pre-Flight", draft)
        self.assertNotIn("Step 7", draft)

        content = post_path.read_text(encoding="utf-8")
        self.assertIn("mode: full", content)
        self.assertIn("# Full Mode Title", content)
        self.assertNotIn("Step 7", content)

    def test_chunked_clean_step_recovers_only_missing_chunk(self) -> None:
        raw_input = "第一句话很长。第二句话很长。第三句话很长。第四句话很长。"
        chunks = split_text_chunks(raw_input, max_chars=12, context_chars=4)
        self.assertGreater(len(chunks), 2)

        responses = [
            f"## 清洗稿\n\nClean chunk {idx}\n\n## 不确定清单\n- 无"
            for idx in range(1, len(chunks) + 1)
        ]
        responses.append("## 清洗稿\n\nRecovered chunk 2\n\n## 不确定清单\n- [?] recovered")

        mock_client = MockLLMClient(responses)
        engine = Engine(self.tmp_dir, mock_client, chunk_char_limit=12, chunk_context_chars=4) # type: ignore
        state = engine.load_state("test_stem")
        state["variables"] = {
            "SPEAKER": "梁老师",
            "ROUTING": "/lecture",
            "MODE": "full",
            "SOURCE": "work/test_stem/raw.txt",
            "PREV_TOTAL": "N/A",
            "PREV_REBRIEF": "无",
        }
        output_path = engine.repo_root / "work/test_stem/clean.md"
        contract_fingerprint = engine.calculate_contract_fingerprint()

        engine._run_chunked_clean_step(  # type: ignore[attr-defined]
            stem="test_stem",
            state=state,
            input_text=raw_input,
            output_path=output_path,
            contract_fingerprint=contract_fingerprint,
        )
        self.assertEqual(mock_client.call_count, len(chunks))
        self.assertTrue(output_path.exists())

        output_path.unlink()
        missing_chunk = engine.repo_root / "work/test_stem/chunks/clean/chunk_0002.md"
        missing_chunk.unlink()
        state = engine.load_state("test_stem")

        engine._run_chunked_clean_step(  # type: ignore[attr-defined]
            stem="test_stem",
            state=state,
            input_text=raw_input,
            output_path=output_path,
            contract_fingerprint=contract_fingerprint,
        )

        self.assertEqual(mock_client.call_count, len(chunks) + 1)
        recovered = output_path.read_text(encoding="utf-8")
        self.assertIn("Clean chunk 1", recovered)
        self.assertIn("Recovered chunk 2", recovered)
        self.assertIn("- [?] recovered", recovered)

    def test_chunked_extract_step_reuses_clean_chunk_boundaries(self) -> None:
        clean_dir = self.tmp_dir / "work/test_stem/chunks/clean"
        clean_dir.mkdir(parents=True, exist_ok=True)
        for idx in range(1, 4):
            (clean_dir / f"chunk_{idx:04d}.md").write_text(
                f"## 清洗稿\n\nClean source {idx}\n\n## 不确定清单\n- 无",
                encoding="utf-8",
            )

        responses = [
            f"## 核心观点\n{idx}. Insight chunk {idx}\n\n## 待确认项\n- 无"
            for idx in range(1, 4)
        ]
        responses.append("## 核心观点\n1. Reduced insights\n\n## 待确认项\n- 无")
        responses.append("## 核心观点\n2. Recovered insight chunk 2\n\n## 待确认项\n- 无")
        responses.append("## 核心观点\n1. Reduced again\n\n## 待确认项\n- 无")

        mock_client = MockLLMClient(responses)
        engine = Engine(self.tmp_dir, mock_client, chunk_char_limit=1000, chunk_context_chars=4) # type: ignore
        state = engine.load_state("test_stem")
        state["variables"] = {
            "SPEAKER": "梁老师",
            "ROUTING": "/lecture",
            "MODE": "full",
            "SOURCE": "work/test_stem/raw.txt",
            "PREV_TOTAL": "N/A",
            "PREV_REBRIEF": "无",
        }
        output_path = engine.repo_root / "work/test_stem/insights.md"
        contract_fingerprint = engine.calculate_contract_fingerprint()

        engine._run_chunked_extract_step(  # type: ignore[attr-defined]
            stem="test_stem",
            state=state,
            input_text="Clean source 1\nClean source 2\nClean source 3",
            output_path=output_path,
            contract_fingerprint=contract_fingerprint,
            source_chunk_dir=engine.repo_root / "work/test_stem/chunks/clean",
        )
        self.assertEqual(mock_client.call_count, 4)
        self.assertIn("Reduced insights", output_path.read_text(encoding="utf-8"))

        output_path.unlink()
        missing_chunk = engine.repo_root / "work/test_stem/chunks/insights/chunk_0002.md"
        missing_chunk.unlink()
        (engine.repo_root / "work/test_stem/chunks/clean/chunk_0002.md").write_text(
            "## 清洗稿\n\nClean source 2 recovered\n\n## 不确定清单\n- 无",
            encoding="utf-8",
        )
        state = engine.load_state("test_stem")

        engine._run_chunked_extract_step(  # type: ignore[attr-defined]
            stem="test_stem",
            state=state,
            input_text="Clean source 1\nClean source 2 recovered\nClean source 3",
            output_path=output_path,
            contract_fingerprint=contract_fingerprint,
            source_chunk_dir=engine.repo_root / "work/test_stem/chunks/clean",
        )

        self.assertEqual(mock_client.call_count, 6)
        self.assertIn("Reduced again", output_path.read_text(encoding="utf-8"))

    def _step7_pass_md(self, total: str = "57/60") -> str:
        return (
            "## 评分\n| 维度 | 分 |\n|---|---|\n"
            "| 忠实度 | 10 |\n| 可读性 | 10 |\n| 观点密度 | 9 |\n"
            "| 风格一致性 | 9 |\n| 完整性 | 9 |\n| 视角忠实度 | 10 |\n"
            f"| **合计** | **{total}** | — |\n\n## 判定\nPASS\n\n## Re-Brief\nok\n"
        )

    def test_generate_summary_is_pure_template_no_llm(self) -> None:
        # 直接锁"纯模板"行为：用一个会爆炸的 client，被调一次就 AssertionError。
        class ExplodingClient:
            model = "x"
            total_input_tokens = 0
            total_output_tokens = 0
            total_cost = 0.0
            def call_api(self, *args, **kwargs):  # noqa: D401
                raise AssertionError("generate_summary 不允许调 LLM——这是 finalize 步骤的硬性约束")

        engine = Engine(self.tmp_dir, ExplodingClient())  # type: ignore[arg-type]
        # speaker 含括号注解时应剥掉
        s = engine.generate_summary("正文内容（不会被读取）", "学习目标是做到", "葛旭（孤独的阅读者创办者）")
        self.assertEqual(s, "我（葛旭）分享了关于《学习目标是做到》的内容。")
        # 干净的 speaker 直接用
        s2 = engine.generate_summary("正文", "标题", "梁老师")
        self.assertEqual(s2, "我（梁老师）分享了关于《标题》的内容。")

    def test_engine_dedup_same_source_rerun(self) -> None:
        # 同一 source 重跑、LLM 给了不同标题：旧成品应被删掉、HISTORY 不堆积重复，最终只剩一篇。
        # 注意：macOS 上 /var → /private/var 的符号链接，Engine 内部 .resolve() 后路径前缀会变，比较时统一用 resolved root。
        repo_root = self.tmp_dir.resolve()
        source_path = repo_root / "work/test_stem/raw.txt"
        source_path.write_text("This is raw transcript text", encoding="utf-8")
        posts_root = repo_root / "output/Posts"

        # 第一次：标题 A
        engine = Engine(
            self.tmp_dir,
            MockLLMClient([  # type: ignore[arg-type]
                "# 旧标题A\n\n这是 A 版正文。",
                self._step7_pass_md(),
                "我（梁老师）讲了 A。",
            ]),
        )
        post_a = engine.run_job(
            stem="test_stem", source_path=source_path,
            mode="quick", routing="/lecture", speaker="梁老师",
        )
        self.assertIsNotNone(post_a)

        # 强制重跑（模拟 --force）：清状态、关闭缓存
        st = engine.load_state("test_stem")
        st["status"] = "PENDING"
        st["force_retry"] = True
        engine.save_state("test_stem", st)

        # 第二次：LLM 给出完全不同的标题 B
        engine.client = MockLLMClient([  # type: ignore[assignment]
            "# 全新标题B\n\n这是 B 版正文。",
            self._step7_pass_md("55/60"),
            "我（梁老师）讲了 B。",
        ])
        post_b = engine.run_job(
            stem="test_stem", source_path=source_path,
            mode="quick", routing="/lecture", speaker="梁老师",
        )
        self.assertIsNotNone(post_b)

        # 同源只保留一篇
        all_posts = list(posts_root.glob("**/*.md"))
        self.assertEqual(len(all_posts), 1, f"expected single post, got: {all_posts}")
        assert post_a is not None and post_b is not None  # for type checker
        self.assertTrue(post_b.exists())
        self.assertFalse(post_a.exists())

        # HISTORY 不留旧记录
        hist = (repo_root / "memory/HISTORY.md").read_text(encoding="utf-8")
        self.assertIn(str(post_b.relative_to(repo_root)), hist)
        self.assertNotIn(str(post_a.relative_to(repo_root)), hist)


class TestEngineRecoversFromTerminalFailureStatus(unittest.TestCase):
    """回归：用户拒绝草稿(approve-draft accept=False) 或取消任务后 .state.json 留下
    FAILED / CANCELLED，下次提交同 stem 时引擎入口必须能重置——否则所有 if 分支不
    匹配，run_job 走到末尾 return None，server 抛"工作流未产生成品"，UI 体验是
    "提交了但啥也没发生"。这是真实在 5/28 长稿 live 验证里撞到的 bug。"""

    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        (self.tmp_dir / "memory").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "knowledge").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/x").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / ".cursor/skills/video2blog/quality-check").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "WORKFLOW.md").write_text("contract", encoding="utf-8")
        (self.tmp_dir / "knowledge/STYLE_GUIDE.md").write_text("style", encoding="utf-8")
        (self.tmp_dir / "memory/PREFERENCES.md").write_text("pref", encoding="utf-8")
        (self.tmp_dir / "memory/CONFIG.md").write_text("config", encoding="utf-8")
        (self.tmp_dir / "memory/HISTORY.md").write_text(
            "# 索引\n| 日期 | 标题 | 演讲人 | 一句摘要 | 成品路径 |\n|---|---|---|---|---|\n",
            encoding="utf-8",
        )
        (self.tmp_dir / ".cursor/skills/video2blog/rewrite-blog/SKILL.md").write_text(
            "---\nname: rw\n---\n# Step 6\n", encoding="utf-8"
        )
        (self.tmp_dir / ".cursor/skills/video2blog/quality-check/SKILL.md").write_text(
            "---\nname: qc\n---\n# Step 7\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir)

    def _write_state(self, status: str, *, with_v1_cache: bool = True) -> Path:
        state_path = self.tmp_dir / "work/x/.state.json"
        state = {
            "stem": "x",
            "status": status,
            "mode": "quick",
            "version": 1,
            "variables": {"SPEAKER": "我", "ROUTING": "/lecture", "MODE": "quick"},
            "history": [],
            "checked_results": [
                {"version": 1, "verdict": "REVIEW", "scores": {}, "total": "—/60",
                 "rebrief": "parse_failed", "parse_failed": True}
            ],
            "cache": {
                "CLEANING": {"input_hash": "kept", "model": "m", "contract_fingerprint": "c"},
            },
        }
        if with_v1_cache:
            state["cache"]["REWRITING_v1"] = {"input_hash": "old", "model": "m", "contract_fingerprint": "c"}
            state["cache"]["CHECKING_v1"] = {"input_hash": "old", "model": "m", "contract_fingerprint": "c"}
            state["best_version"] = 1
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        return state_path

    class _RaisingClient:
        """让引擎一调 LLM 就 raise；目的是把'入口已经重置状态'这一事实暴露出来。"""
        total_input_tokens = 0
        total_output_tokens = 0
        total_cost = 0.0
        model = "raising"

        def call_api(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            raise RuntimeError("intentional-after-reset")

        def check_budget(self, _t):  # type: ignore[no-untyped-def]
            return None

    def test_failed_status_is_reset_and_versioned_cache_cleared(self) -> None:
        state_path = self._write_state("FAILED")
        source = self.tmp_dir / "work/x/raw.txt"
        source.write_text("raw", encoding="utf-8")
        engine = Engine(self.tmp_dir, self._RaisingClient())  # type: ignore[arg-type]

        # 引擎在 Step 6 调 LLM 时 raise；关键是 raise 之前入口已经把状态推进过
        with self.assertRaisesRegex(RuntimeError, "intentional-after-reset"):
            engine.run_job(
                stem="x", source_path=source,
                mode="quick", routing="/lecture", speaker="我", max_retries=0,
            )

        s = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertNotEqual(s["status"], "FAILED",
                            "FAILED 必须被重置，否则下次提交同 stem 永远跑不动")
        self.assertEqual(s["checked_results"], [],
                         "checked_results 必须清空，避免命中旧 parse_failed review")
        self.assertNotIn("best_version", s,
                         "best_version 必须移除，否则下游 next(...) 会查到陈年版本")
        self.assertNotIn("REWRITING_v1", s["cache"],
                         "REWRITING_v1 cache 必须清，让用户的'再试一次'真去调 LLM")
        self.assertNotIn("CHECKING_v1", s["cache"], "CHECKING_v1 同理")
        self.assertIn("CLEANING", s["cache"],
                      "Step 3-5 cache 必须保留，避免重复烧 clean/extract/structure 钱")

    def test_cancelled_status_also_recovers(self) -> None:
        state_path = self._write_state("CANCELLED")
        source = self.tmp_dir / "work/x/raw.txt"
        source.write_text("raw", encoding="utf-8")
        engine = Engine(self.tmp_dir, self._RaisingClient())  # type: ignore[arg-type]

        with self.assertRaises(RuntimeError):
            engine.run_job(stem="x", source_path=source,
                           mode="quick", routing="/lecture", speaker="我", max_retries=0)

        s = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertNotEqual(s["status"], "CANCELLED")
        self.assertNotIn("REWRITING_v1", s["cache"])

    def test_finished_status_also_resets_and_purges_stale_files(self) -> None:
        """5/28 撞到的第 3 个回归点：FINISHED 不被特殊清理时，下一次重跑同 stem 会
        因磁盘上还残留旧 draft_v1.md 而让前端 /files/draft 返回过期内容、UI tab
        被误推到 review 模式。FINISHED 现在也走 FAILED/CANCELLED 那套清理。"""
        state_path = self._write_state("FINISHED")
        # FINISHED 状态下通常 final_post_path 不空，验证它被一并清掉，
        # 避免 Step 8 同源去重把上一轮成品物理删除
        s = json.loads(state_path.read_text(encoding="utf-8"))
        s["final_post_path"] = "output/Posts/2026/2026-05-28-test.md"
        state_path.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
        # 模拟旧产物
        (self.tmp_dir / "work/x/draft_v1.md").write_text("OLD", encoding="utf-8")
        (self.tmp_dir / "work/x/review_v1.json").write_text("{}", encoding="utf-8")

        source = self.tmp_dir / "work/x/raw.txt"
        source.write_text("raw", encoding="utf-8")
        engine = Engine(self.tmp_dir, self._RaisingClient())  # type: ignore[arg-type]
        with self.assertRaises(RuntimeError):
            engine.run_job(stem="x", source_path=source,
                           mode="quick", routing="/lecture", speaker="我", max_retries=0)

        s2 = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertNotEqual(s2["status"], "FINISHED")
        self.assertNotIn("final_post_path", s2,
                         "FINISHED 重提时 final_post_path 必须清掉，"
                         "否则 Step 8 同源去重会误删上一轮真实成品")
        self.assertFalse((self.tmp_dir / "work/x/draft_v1.md").exists())
        self.assertFalse((self.tmp_dir / "work/x/review_v1.json").exists())

    def test_reset_also_purges_stale_draft_and_review_files(self) -> None:
        """5/28 长稿 live 验证撞到的 UI bug：用户拒绝草稿后，下一轮跑 paused 时
        前端 fetch /files/draft 拿到的是上一轮残留的 draft_v1.md，被当成
        本轮内容渲染。修复：FAILED/CANCELLED → PENDING 重置时必须连物理文件
        一起清，否则 server.py 的 /files/draft 端点会把旧内容暴露给前端。"""
        self._write_state("FAILED")
        # 预置旧产物文件
        work_dir = self.tmp_dir / "work/x"
        (work_dir / "draft_v1.md").write_text("OLD DRAFT v1", encoding="utf-8")
        (work_dir / "draft_v2.md").write_text("OLD DRAFT v2", encoding="utf-8")
        (work_dir / "review_v1.json").write_text('{"verdict":"REVIEW"}', encoding="utf-8")
        rewrite_chunk_dir = work_dir / "chunks" / "rewrite" / "v1"
        rewrite_chunk_dir.mkdir(parents=True)
        (rewrite_chunk_dir / "intro.md").write_text("OLD INTRO", encoding="utf-8")

        source = work_dir / "raw.txt"
        source.write_text("raw", encoding="utf-8")
        engine = Engine(self.tmp_dir, self._RaisingClient())  # type: ignore[arg-type]
        with self.assertRaises(RuntimeError):
            engine.run_job(stem="x", source_path=source,
                           mode="quick", routing="/lecture", speaker="我", max_retries=0)

        # 重置之后 draft_v*/review_v*/chunks/rewrite 全清，避免污染下一轮
        self.assertFalse((work_dir / "draft_v1.md").exists(), "旧 draft_v1 未清")
        self.assertFalse((work_dir / "draft_v2.md").exists(), "旧 draft_v2 未清")
        self.assertFalse((work_dir / "review_v1.json").exists(), "旧 review_v1 未清")
        self.assertFalse((work_dir / "chunks" / "rewrite").exists(), "旧 sectioned 节产物未清")
        # 但 raw.txt 必须留下（它是本轮的输入源）
        self.assertTrue(source.exists())


if __name__ == "__main__":
    unittest.main()

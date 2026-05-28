"""Tests for the local Engine job service."""

from __future__ import annotations

import shutil
import tempfile
import unittest
import json
from pathlib import Path

from video2blog.server_core import EngineJobRequest, EngineJobService


class MockLLMClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.call_count = 0
        self.calls = []
        self.total_input_tokens = 12
        self.total_output_tokens = 8
        self.total_cost = 0.00001
        self.model = "mock-model"

    def call_api(self, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        self.calls.append((system_prompt, user_prompt, json_mode))
        response = self.responses[self.call_count]
        self.call_count += 1
        return response


class TestEngineJobService(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        self._write_repo_contracts(self.tmp_dir)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir)

    def test_submit_job_streams_logs_and_records_artifacts(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw transcript text", encoding="utf-8")

        responses = [
            "# 服务化标题\n\n这是服务化后的正文。",
            (
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
                "## 判定\nPASS\n\n## Re-Brief\nok"
            ),
            "我（梁老师）完成了服务化标题。",
        ]
        mock_client = MockLLMClient(responses)
        service = EngineJobService(self.tmp_dir, client_factory=lambda _: mock_client)

        job = service.submit_job(
            EngineJobRequest(
                source="work/test_stem/raw.txt",
                mode="quick",
                routing="/lecture",
                speaker="梁老师",
            )
        )
        events = list(service.iter_events(job.id))
        finished = service.wait_for_job(job.id)

        self.assertEqual(finished.status, "succeeded")
        self.assertEqual(finished.input_tokens, 12)
        self.assertEqual(finished.output_tokens, 8)
        self.assertTrue(finished.final_post_path)
        self.assertTrue((self.tmp_dir / finished.final_post_path).exists())
        self.assertTrue(finished.review_path)
        self.assertTrue((self.tmp_dir / finished.review_path).exists())
        self.assertIn("queued", [event["event"] for event in events])
        self.assertIn("started", [event["event"] for event in events])
        self.assertIn("succeeded", [event["event"] for event in events])
        self.assertTrue(any(event["event"] == "log" for event in events))
        service.shutdown()

    def test_missing_api_key_marks_job_failed(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw transcript text", encoding="utf-8")

        service = EngineJobService(self.tmp_dir)
        job = service.submit_job(EngineJobRequest(source="work/test_stem/raw.txt", mode="quick"))
        events = list(service.iter_events(job.id))
        finished = service.wait_for_job(job.id)

        self.assertEqual(finished.status, "failed")
        self.assertIn("LLM API Key", finished.error or "")
        self.assertEqual(events[-1]["event"], "failed")
        service.shutdown()

    def test_api_key_precedence_in_client_factory(self) -> None:
        import os
        service = EngineJobService(self.tmp_dir)
        
        # Scenario 1: No request api_key, uses environment variable
        os.environ["VIDEO2BLOG_API_KEY"] = "env-key"
        try:
            req = EngineJobRequest(source="work/test_stem/raw.txt")
            client = service._default_client_factory(req)
            self.assertEqual(client.api_key, "env-key")
        finally:
            del os.environ["VIDEO2BLOG_API_KEY"]
            
        # Scenario 2: Request api_key overrides environment variable
        os.environ["VIDEO2BLOG_API_KEY"] = "env-key"
        try:
            req = EngineJobRequest(source="work/test_stem/raw.txt", api_key="request-key")
            client = service._default_client_factory(req)
            self.assertEqual(client.api_key, "request-key")
        finally:
            del os.environ["VIDEO2BLOG_API_KEY"]

        # Scenario 3: Request api_key is used when environment variable is missing
        req = EngineJobRequest(source="work/test_stem/raw.txt", api_key="request-key-only")
        client = service._default_client_factory(req)
        self.assertEqual(client.api_key, "request-key-only")

    def test_api_key_is_redacted_from_failed_job_error_and_events(self) -> None:
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw transcript text", encoding="utf-8")
        secret = "secret-request-api-key"

        def failing_client_factory(request: EngineJobRequest) -> None:
            raise RuntimeError(f"provider rejected API key {secret}")

        service = EngineJobService(self.tmp_dir, client_factory=failing_client_factory)
        try:
            job = service.submit_job(
                EngineJobRequest(source="work/test_stem/raw.txt", mode="quick", api_key=secret)
            )
            finished = service.wait_for_job(job.id)
            events = list(service.iter_events(job.id))
            events_path = self.tmp_dir / "work/test_stem/events.jsonl"

            self.assertEqual(finished.status, "failed")
            self.assertNotIn(secret, finished.error or "")
            self.assertNotIn(secret, json.dumps(finished.to_dict(), ensure_ascii=False))
            self.assertNotIn(secret, json.dumps(events, ensure_ascii=False))
            self.assertNotIn(secret, events_path.read_text(encoding="utf-8"))
        finally:
            service.shutdown()

    def test_submit_job_rejects_unknown_rewrite_strategy(self) -> None:
        service = EngineJobService(self.tmp_dir)
        try:
            source_path = self.tmp_dir / "input/Text/x.md"
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_text("dummy", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "未知 rewrite_strategy"):
                service.submit_job(
                    EngineJobRequest(
                        source="input/Text/x.md",
                        mode="quick",
                        rewrite_strategy="batch",
                    )
                )
        finally:
            service.shutdown()

    def test_submit_job_passes_rewrite_strategy_to_engine(self) -> None:
        """sectioned 必须从 request 透传到 Engine 构造参数，否则 §9-C 在 server 路径里失效。"""
        from video2blog.engine.runner import Engine

        source_path = self.tmp_dir / "work/strat/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("raw", encoding="utf-8")

        captured: dict[str, str] = {}

        original_init = Engine.__init__

        def spy_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured["rewrite_strategy"] = kwargs.get("rewrite_strategy", "MISSING")
            # 立即抛错，让 job 直接 failed —— 我们只关心引擎构造参数。
            raise RuntimeError("captured-and-aborted")

        Engine.__init__ = spy_init  # type: ignore[assignment]
        try:
            service = EngineJobService(self.tmp_dir, client_factory=lambda _: MockLLMClient([]))
            job = service.submit_job(
                EngineJobRequest(
                    source="work/strat/raw.txt",
                    mode="full",
                    rewrite_strategy="sectioned",
                )
            )
            service.wait_for_job(job.id)
            self.assertEqual(captured.get("rewrite_strategy"), "sectioned")
            service.shutdown()
        finally:
            Engine.__init__ = original_init  # type: ignore[assignment]

    def test_source_must_stay_inside_repo_by_default(self) -> None:
        outside = self.tmp_dir.parent / "outside-source.txt"
        outside.write_text("external", encoding="utf-8")
        service = EngineJobService(self.tmp_dir)
        try:
            with self.assertRaisesRegex(ValueError, "仓库根目录内"):
                service.submit_job(EngineJobRequest(source=str(outside), mode="quick"))
        finally:
            outside.unlink(missing_ok=True)
            service.shutdown()

    def test_external_source_can_be_enabled_explicitly(self) -> None:
        outside = self.tmp_dir.parent / "outside-source-enabled.txt"
        outside.write_text("external", encoding="utf-8")
        responses = [
            "# 外部标题\n\n正文。",
            (
                "## 评分\n| 维度 | 分 | 依据 |\n|---|---|---|\n"
                "| 忠实度 | 9 | ok |\n| 可读性 | 9 | ok |\n| 观点密度 | 9 | ok |\n"
                "| 风格一致性 | 9 | ok |\n| 完整性 | 9 | ok |\n| 视角忠实度 | 9 | ok |\n"
                "| **合计** | **54/60** | — |\n\n## 判定\nPASS\n\n## Re-Brief\nok"
            ),
        ]
        service = EngineJobService(
            self.tmp_dir,
            client_factory=lambda _: MockLLMClient(responses),
            allow_external_source=True,
        )
        try:
            job = service.submit_job(EngineJobRequest(source=str(outside), mode="quick"))
            finished = service.wait_for_job(job.id)
            self.assertEqual(finished.status, "succeeded")
        finally:
            outside.unlink(missing_ok=True)
            service.shutdown()

    def test_persisted_paused_job_is_restored_from_disk(self) -> None:
        work_dir = self.tmp_dir / "work/restored"
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / "raw.txt").write_text("raw", encoding="utf-8")
        (work_dir / "outline.md").write_text("## 标题候选\n1. x\n", encoding="utf-8")
        (work_dir / "events.jsonl").write_text(
            json.dumps({"id": 1, "event": "paused", "timestamp": "t", "data": {"state_status": "WAITING_USER_OUTLINE"}})
            + "\n",
            encoding="utf-8",
        )
        (work_dir / ".state.json").write_text(
            json.dumps(
                {
                    "stem": "restored",
                    "status": "WAITING_USER_OUTLINE",
                    "mode": "full",
                    "variables": {
                        "SOURCE": "work/restored/raw.txt",
                        "SPEAKER": "梁老师",
                        "ROUTING": "/lecture",
                        "MODE": "full",
                    },
                    "version": 1,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        service = EngineJobService(self.tmp_dir)
        try:
            jobs = service.list_jobs()
            self.assertEqual(len(jobs), 1)
            job = jobs[0]
            self.assertTrue(job.id.startswith("disk-"))
            self.assertEqual(job.status, "paused")
            self.assertEqual(job.outline_path, "work/restored/outline.md")
            self.assertEqual(job.request.source, "work/restored/raw.txt")
            # 关键：paused 子状态必须恢复，否则前端拿不到，UI 又会回退到
            # "看磁盘有没有 draft 内容"那套被旧文件误导的启发式
            self.assertEqual(job.paused_state, "WAITING_USER_OUTLINE")
            events = list(service.iter_events(job.id, timeout=0.01))
            self.assertEqual(events[0]["event"], "paused")
        finally:
            service.shutdown()

    def test_cancel_paused_job_writes_cancelled_to_disk(self) -> None:
        """5/28 撞到的死锁：用户在 UI 取消 paused 任务，cancel_job 只动内存不写
        state.json，下次重提同 stem 时引擎读 state=WAITING_USER_OUTLINE，所有
        重置分支都不命中又卡回 paused。修复：cancel 时把 state.status 写
        CANCELLED 到磁盘，让 runner 入口的 CANCELLED → PENDING 重置接管。"""
        work_dir = self.tmp_dir / "work/cancel_paused"
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / "raw.txt").write_text("raw", encoding="utf-8")
        state_path = work_dir / ".state.json"
        state_path.write_text(
            json.dumps(
                {
                    "stem": "cancel_paused",
                    "status": "WAITING_USER_OUTLINE",
                    "mode": "full",
                    "variables": {"SOURCE": "work/cancel_paused/raw.txt", "SPEAKER": "我",
                                  "ROUTING": "/lecture", "MODE": "full"},
                    "version": 1,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        service = EngineJobService(self.tmp_dir)
        try:
            job = service.list_jobs()[0]
            self.assertEqual(job.status, "paused")
            service.cancel_job(job.id)
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(
                persisted["status"], "CANCELLED",
                "cancel 必须把 state.status 写到磁盘，否则下次重提卡在 paused 死循环",
            )
        finally:
            service.shutdown()

    def test_paused_state_cleared_after_resume(self) -> None:
        """resume 之后 paused_state 必须清空，避免 UI 还按上个人工节点渲染。"""
        work_dir = self.tmp_dir / "work/resume_clear"
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / "raw.txt").write_text("raw", encoding="utf-8")
        (work_dir / ".state.json").write_text(
            json.dumps(
                {
                    "stem": "resume_clear",
                    "status": "WAITING_USER_REVIEW",
                    "mode": "quick",
                    "variables": {"SOURCE": "work/resume_clear/raw.txt", "SPEAKER": "我",
                                  "ROUTING": "/lecture", "MODE": "quick"},
                    "version": 1,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        service = EngineJobService(self.tmp_dir)
        try:
            job = service.list_jobs()[0]
            self.assertEqual(job.paused_state, "WAITING_USER_REVIEW")
            # 模拟 resume：会触发 _executor.submit 再跑一次 run_job
            # 用 raising client 让它立刻挂掉，但 paused_state 应该已经清空
            service._client_factory = lambda _r: type("X", (), {  # type: ignore[attr-defined]
                "model": "raising",
                "api_base": "",
                "api_key": "",
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cost": 0.0,
                "call_api": lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError("expected")),
                "check_budget": lambda *_a, **_kw: None,
            })()
            service.resume_job(job.id)
            service.wait_for_job(job.id)
            self.assertIsNone(job.paused_state)
        finally:
            service.shutdown()

    def _write_repo_contracts(self, root: Path) -> None:
        (root / "memory").mkdir(parents=True, exist_ok=True)
        (root / "knowledge").mkdir(parents=True, exist_ok=True)
        (root / ".cursor/skills/video2blog/rewrite-blog").mkdir(parents=True, exist_ok=True)
        (root / ".cursor/skills/video2blog/quality-check").mkdir(parents=True, exist_ok=True)

        (root / "WORKFLOW.md").write_text("Mock Workflow", encoding="utf-8")
        (root / "knowledge/STYLE_GUIDE.md").write_text("Mock Style Guide", encoding="utf-8")
        (root / "memory/PREFERENCES.md").write_text("speaker {{SPEAKER}}", encoding="utf-8")
        (root / "memory/CONFIG.md").write_text("Mock Config", encoding="utf-8")
        (root / "memory/HISTORY.md").write_text(
            "# 近期博文索引\n\n| 日期 | 标题 | 演讲人 | 一句摘要（演讲人视角） | 成品路径 |\n|---|---|---|---|---|\n",
            encoding="utf-8",
        )
        (root / ".cursor/skills/video2blog/rewrite-blog/SKILL.md").write_text(
            "---\nname: rewrite-blog\n---\n# Rewrite\n{{ROUTING}} {{PREV_TOTAL}} {{PREV_REBRIEF}}",
            encoding="utf-8",
        )
        (root / ".cursor/skills/video2blog/quality-check/SKILL.md").write_text(
            "---\nname: quality-check\n---\n# Check",
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()

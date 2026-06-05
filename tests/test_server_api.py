"""Tests for the local Engine FastAPI endpoints and CORS settings."""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None

from video2blog.server import create_app


class MockLLMClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.call_count = 0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_cost = 0.0
        self.model = "mock-model"
        self.api_key = "mock-key"  # 注入的 mock 视为已配 key（server_core 无 key 早检查用）

    def call_api(self, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        response = self.responses[self.call_count]
        self.call_count += 1
        return response


@unittest.skipIf(TestClient is None, "fastapi.testclient.TestClient is not installed")
class TestEngineServerAPI(unittest.TestCase):
    def setUp(self) -> None:
        import os

        from video2blog.engine import secrets_store as ss

        self.tmp_dir = Path(tempfile.mkdtemp())
        self._write_repo_contracts(self.tmp_dir)
        # 隔离 LLM 配置：临时 XDG + 假钥匙串，杜绝测试读/改真实环境。
        self._cfg_dir = Path(tempfile.mkdtemp())
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = str(self._cfg_dir)
        self._ss = ss
        self._real_keyring = ss._keyring
        ss._keyring = _FakeKeyring()

    def tearDown(self) -> None:
        import os

        shutil.rmtree(self.tmp_dir)
        shutil.rmtree(self._cfg_dir, ignore_errors=True)
        self._ss._keyring = self._real_keyring
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg

    def test_fingerprints_aggregates_voice_profile(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        # 空/缺文件 → count 0，不报错
        empty = client.get("/fingerprints").json()
        self.assertEqual(empty["count"], 0)
        self.assertIsNone(empty["avg_sentence_len"])

        mem = self.tmp_dir / "memory"
        mem.mkdir(parents=True, exist_ok=True)
        (mem / "fingerprints.jsonl").write_text(
            "\n".join(
                [
                    json.dumps(
                        {
                            "title": "A",
                            "avg_sentence_len": 30,
                            "avg_paragraph_len": 80,
                            "created_at": "2026-05-01T00:00:00+00:00",
                            "top_terms": ["AI", "问题", "学习"],
                        }
                    ),
                    json.dumps(
                        {
                            "title": "B",
                            "avg_sentence_len": 40,
                            "avg_paragraph_len": 100,
                            "created_at": "2026-05-02T00:00:00+00:00",
                            "top_terms": ["AI", "问题", "工程"],
                        }
                    ),
                    "",  # 空行应被跳过
                    "{坏行}",  # 坏 JSON 应被跳过，不拖垮聚合
                ]
            ),
            encoding="utf-8",
        )
        d = client.get("/fingerprints").json()
        self.assertEqual(d["count"], 2)
        self.assertEqual(d["avg_sentence_len"], 35.0)
        self.assertEqual(d["avg_paragraph_len"], 90.0)
        self.assertEqual(len(d["per_post"]), 2)
        self.assertEqual(d["per_post"][0]["title"], "A")  # 按 created_at 正序
        terms = {t["term"]: t["posts"] for t in d["top_terms"]}
        self.assertEqual(terms["AI"], 2)  # 两篇都有
        self.assertEqual(terms["问题"], 2)
        self.assertEqual(terms["工程"], 1)

    def test_dispositions_roundtrip(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        p = "output/Posts/2026/x.md"
        self.assertEqual(client.get("/api/dispositions").json(), {})  # 初始空
        # 设标记
        r = client.post("/api/dispositions", json={"path": p, "value": "edited"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[p]["value"], "edited")
        # 落盘可读回
        self.assertEqual(client.get("/api/dispositions").json()[p]["value"], "edited")
        # 非法 value 拒绝
        self.assertEqual(
            client.post("/api/dispositions", json={"path": p, "value": "nope"}).status_code, 400
        )
        # 清除
        cleared = client.post("/api/dispositions", json={"path": p, "value": None}).json()
        self.assertNotIn(p, cleared)

    def test_sources_endpoint_lists_work_and_input_text(self) -> None:
        # 准备真实目录结构
        (self.tmp_dir / "work/foo").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/foo/raw.txt").write_text("transcript A", encoding="utf-8")
        (self.tmp_dir / "work/bar baz").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/bar baz/raw.txt").write_text("transcript B", encoding="utf-8")
        (self.tmp_dir / "work/no-raw").mkdir(parents=True, exist_ok=True)  # 无 raw.txt，应被忽略
        (self.tmp_dir / "input/Text").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "input/Text/.gitkeep").write_text("", encoding="utf-8")  # 应被忽略
        (self.tmp_dir / "input/Text/snippet.md").write_text("hello", encoding="utf-8")
        (self.tmp_dir / "input/Text/random.bin").write_text(
            "nope", encoding="utf-8"
        )  # 非白名单后缀，应被忽略

        client = TestClient(create_app(self.tmp_dir))
        res = client.get("/sources")
        self.assertEqual(res.status_code, 200)
        items = res.json()
        paths = {item["path"] for item in items}

        self.assertIn("work/foo/raw.txt", paths)
        self.assertIn("work/bar baz/raw.txt", paths)
        self.assertIn("input/Text/snippet.md", paths)
        # 不应包含的:
        self.assertNotIn("input/Text/.gitkeep", paths)
        self.assertNotIn("input/Text/random.bin", paths)
        # work/no-raw 没 raw.txt → 整目录被跳
        for item in items:
            self.assertNotIn("no-raw", item["path"])

        # 每条记录必须含 kind/label/size/mtime
        for item in items:
            self.assertIn(item["kind"], ("transcript", "text"))
            self.assertTrue(item["label"])
            self.assertIsInstance(item["size"], int)
            self.assertIsInstance(item["mtime"], (int, float))

    def test_history_endpoint_reconstructs_completed_jobs_from_disk(self) -> None:
        # 模拟磁盘上有几个历史成品(都带合规 frontmatter)
        posts_dir = self.tmp_dir / "output/Posts/2026"
        posts_dir.mkdir(parents=True, exist_ok=True)
        reviews_dir = self.tmp_dir / "output/Reviews"
        reviews_dir.mkdir(parents=True, exist_ok=True)

        # 合规成品 + 对应 review
        (posts_dir / "2026-05-20-成品一.md").write_text(
            "---\ntitle: 成品一\ndate: '2026-05-20'\nentry: transcript\nmode: full\n"
            "routing: /lecture\nspeaker: 白墨西\nsource: work/foo/raw.txt\npass_score: 55/60\n---\n# 成品一\n正文\n",
            encoding="utf-8",
        )
        (reviews_dir / "2026-05-20-成品一.review.md").write_text(
            "## 评分\n...\n## Re-Brief\nok\n", encoding="utf-8"
        )

        # DRAFT 也应该出现,且 status=draft
        (posts_dir / "DRAFT-2026-05-21-未通过.md").write_text(
            "---\ntitle: 未通过\ndate: '2026-05-21'\nentry: transcript\nmode: quick\n"
            "routing: /default\nspeaker: 张三\nsource: input/Text/x.md\npass_score: —/60\n---\n# 未通过\n",
            encoding="utf-8",
        )

        # 无 frontmatter 的文件应被跳过
        (posts_dir / "no-frontmatter.md").write_text(
            "# 裸 markdown\n没合同信息\n", encoding="utf-8"
        )

        client = TestClient(create_app(self.tmp_dir))
        # Round 3：历史成品列表从 /jobs/history 迁到 /api/posts（行为一致）
        res = client.get("/api/posts")
        self.assertEqual(res.status_code, 200)
        items = res.json()

        # 应该有 2 条(成品一 + DRAFT),no-frontmatter 被过滤
        self.assertEqual(len(items), 2)

        by_title = {it["stem"]: it for it in items}
        self.assertIn("成品一", by_title)
        self.assertIn("未通过", by_title)

        ok = by_title["成品一"]
        self.assertEqual(ok["status"], "succeeded")
        self.assertEqual(ok["kind"], "historical")
        self.assertFalse(ok["is_draft"])
        self.assertEqual(ok["request"]["speaker"], "白墨西")
        self.assertEqual(ok["request"]["routing"], "/lecture")
        self.assertEqual(ok["pass_score"], "55/60")
        self.assertTrue(ok["id"].startswith("hist-"))
        self.assertEqual(ok["final_post_path"], "output/Posts/2026/2026-05-20-成品一.md")
        self.assertEqual(ok["review_path"], "output/Reviews/2026-05-20-成品一.review.md")
        # api_key 历史归档不存在,必须是 None
        self.assertIsNone(ok["request"]["api_key"])

        draft = by_title["未通过"]
        self.assertEqual(draft["status"], "draft")
        self.assertTrue(draft["is_draft"])
        # DRAFT 没对应 review 的话 review_path 应为 None
        self.assertIsNone(draft["review_path"])

        # ID 应该跨调用稳定(同 path → 同 hash)
        res2 = client.get("/api/posts")
        items2 = res2.json()
        self.assertEqual(
            {it["id"] for it in items},
            {it["id"] for it in items2},
        )

    def test_cancel_endpoint_marks_failed(self) -> None:
        """提交一个 queued/queued-running job,POST cancel,验证状态切到 failed。"""
        app = create_app(self.tmp_dir)
        service = app.state.video2blog_service
        client = TestClient(app)

        source_path = self.tmp_dir / "work/test/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("raw", encoding="utf-8")

        res = client.post(
            "/jobs",
            json={
                "source": "work/test/raw.txt",
                "mode": "quick",
                "speaker": "x",
                "routing": "/lecture",
                "api_key": "BAD",
            },
        )
        self.assertEqual(res.status_code, 202)
        job_id = res.json()["id"]

        cancel_res = client.post(f"/jobs/{job_id}/cancel")
        self.assertEqual(cancel_res.status_code, 200)
        self.assertEqual(cancel_res.json()["ok"], True)

        # 等 worker 线程退出
        service.wait_for_job(job_id, timeout=10)
        detail = client.get(f"/jobs/{job_id}").json()
        self.assertEqual(detail["status"], "failed")
        self.assertIsNotNone(detail["error"])

        # 404 on unknown id
        self.assertEqual(client.post("/jobs/does-not-exist/cancel").status_code, 404)
        service.shutdown()

    def test_open_path_rejects_escape_attempt(self) -> None:
        """安全:必须拒绝指向 repo 之外的路径(防越权)。"""
        (self.tmp_dir / "output/Posts/2026").mkdir(parents=True, exist_ok=True)
        ok_file = self.tmp_dir / "output/Posts/2026/x.md"
        ok_file.write_text("# x", encoding="utf-8")

        client = TestClient(create_app(self.tmp_dir))

        # ../../../ 越权
        res = client.post("/open", json={"path": "../../../etc/passwd", "mode": "finder"})
        self.assertEqual(res.status_code, 400)

        # 缺 path
        self.assertEqual(client.post("/open", json={}).status_code, 400)

        # 无效 mode
        self.assertEqual(
            client.post(
                "/open", json={"path": "output/Posts/2026/x.md", "mode": "browser"}
            ).status_code,
            400,
        )

        # 不存在的合法路径
        self.assertEqual(
            client.post(
                "/open", json={"path": "output/Posts/2026/nope.md", "mode": "finder"}
            ).status_code,
            404,
        )

        # 合法路径——subprocess.run 会被 mock,我们只验证路径校验通过
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.MagicMock(returncode=0)
            res = client.post("/open", json={"path": "output/Posts/2026/x.md", "mode": "finder"})
            self.assertEqual(res.status_code, 200)
            mock_run.assert_called_once()
            args = mock_run.call_args[0][0]
            self.assertEqual(args[:2], ["open", "-R"])

    def test_cors_headers_are_present(self) -> None:
        app = create_app(self.tmp_dir)
        client = TestClient(app)
        response = client.options(
            "/jobs",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"), "http://localhost:5173"
        )

    def test_cors_rejects_non_local_origins(self) -> None:
        app = create_app(self.tmp_dir)
        client = TestClient(app)
        response = client.options(
            "/jobs",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotEqual(
            response.headers.get("access-control-allow-origin"), "https://evil.example"
        )

    def test_test_llm_redacts_api_key_from_errors(self) -> None:
        secret = "secret-test-llm-api-key"
        app = create_app(self.tmp_dir)
        client = TestClient(app)

        with mock.patch("video2blog.engine.client.LLMClient") as mock_client_cls:
            mock_client = mock_client_cls.return_value
            mock_client.api_key = secret
            mock_client.call_api.side_effect = RuntimeError(f"upstream echoed {secret}")

            response = client.post("/api/test-llm", json={"api_key": secret})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["ok"])
        self.assertNotIn(secret, response.text)
        self.assertIn("***", response.json()["error"])

    def test_list_jobs_returns_jobs(self) -> None:
        app = create_app(self.tmp_dir)
        service = app.state.video2blog_service
        client = TestClient(app)

        # Initially empty
        res = client.get("/jobs")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

        # Submit a job
        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw text content", encoding="utf-8")

        res_submit = client.post(
            "/jobs",
            json={
                "source": "work/test_stem/raw.txt",
                "mode": "quick",
                "speaker": "梁老师",
                "routing": "/lecture",
            },
        )
        self.assertEqual(res_submit.status_code, 202)
        job_id = res_submit.json()["id"]

        # List jobs now
        res_list = client.get("/jobs")
        self.assertEqual(res_list.status_code, 200)
        jobs = res_list.json()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["id"], job_id)

        # Wait for background thread to exit so we can rmtree safely
        service.wait_for_job(job_id)
        service.shutdown()

    def test_submit_job_with_custom_api_key(self) -> None:
        app = create_app(self.tmp_dir)
        service = app.state.video2blog_service
        client = TestClient(app)

        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw text content", encoding="utf-8")

        res_submit = client.post(
            "/jobs",
            json={
                "source": "work/test_stem/raw.txt",
                "mode": "quick",
                "speaker": "梁老师",
                "routing": "/lecture",
                "api_key": "my-request-api-key",
            },
        )
        self.assertEqual(res_submit.status_code, 202)
        job_id = res_submit.json()["id"]

        job = service.get_job(job_id)
        self.assertEqual(job.request.api_key, "my-request-api-key")

        # 回归：HTTP 响应必须屏蔽 api_key，不允许把明文 key 通过 /jobs 或 /jobs/{id} 回吐。
        list_payload = client.get("/jobs").json()
        self.assertTrue(any(j["id"] == job_id for j in list_payload))
        for j in list_payload:
            if j["id"] == job_id:
                self.assertEqual(j["request"]["api_key"], "***")
                self.assertNotIn(
                    "my-request-api-key",
                    res_submit.text + client.get("/jobs").text + client.get(f"/jobs/{job_id}").text,
                )
        detail = client.get(f"/jobs/{job_id}").json()
        self.assertEqual(detail["request"]["api_key"], "***")
        events_path = self.tmp_dir / "work/test_stem/events.jsonl"
        if events_path.exists():
            self.assertNotIn("my-request-api-key", events_path.read_text(encoding="utf-8"))

        # Wait for background thread to exit so we can rmtree safely
        service.wait_for_job(job_id)
        service.shutdown()

    def test_full_flow_with_interactive_pauses_and_approvals(self) -> None:
        # Mock responses:
        # 1. Step 3 Clean
        # 2. Step 4 Insights
        # 3. Step 5 Outline
        # (Pause at outline, approve outline)
        # 4. Step 6 Draft
        # 5. Step 7 Quality Check REVIEW
        # (Pause at review, approve draft)
        # 6. Step 8 Summary
        responses = [
            "## 清洗稿\n\nClean text\n\n## 不确定清单\n- 无",
            "## 核心观点\n1. Insight\n\n## 待确认项\n- 无",
            "## 标题候选\n1. The Test Title\n\n## 骨架\n### 导语\nIntro",
            "# The Test Title\n\nDraft content rewrite",
            (
                "## 评分\n"
                "| 维度 | 分 | 依据 |\n"
                "|---|---|---|\n"
                "| 忠实度 | 7 | ok |\n"
                "| 可读性 | 7 | ok |\n"
                "| 观点密度 | 7 | ok |\n"
                "| 风格一致性 | 7 | ok |\n"
                "| 完整性 | 7 | ok |\n"
                "| 视角忠实度 | 7 | ok |\n"
                "| **合计** | **42/60** | — |\n\n"
                "## 判定\nREVIEW\n\n## Re-Brief\nFailed score, review required."
            ),
            "我（梁老师）完成了 The Test Title。",
        ]
        mock_client = MockLLMClient(responses)

        # Custom app builder to inject mock LLM client
        app = create_app(self.tmp_dir)
        service = app.state.video2blog_service
        service._client_factory = lambda _: mock_client

        client = TestClient(app)

        source_path = self.tmp_dir / "work/test_stem/raw.txt"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text("Raw text content", encoding="utf-8")

        # 1. Submit job (with pause_on_outline=True)
        res_submit = client.post(
            "/jobs",
            json={
                "source": "work/test_stem/raw.txt",
                "mode": "full",
                "speaker": "梁老师",
                "routing": "/lecture",
                "pause_on_outline": True,
                "max_retries": 0,
            },
        )
        self.assertEqual(res_submit.status_code, 202)
        job_id = res_submit.json()["id"]

        # Wait for the job to pause at WAITING_USER_OUTLINE
        finished = service.wait_for_job(job_id)
        self.assertEqual(finished.status, "paused")

        # Test retrieving outline file content
        res_outline_file = client.get(f"/jobs/{job_id}/files/outline")
        self.assertEqual(res_outline_file.status_code, 200)
        self.assertIn("## 标题候选", res_outline_file.json()["content"])

        state_path = self.tmp_dir / "work/test_stem/.state.json"
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        self.assertEqual(state["status"], "WAITING_USER_OUTLINE")

        # 2. Approve Outline
        res_approve_outline = client.post(
            f"/jobs/{job_id}/approve-outline",
            json={
                "outline_markdown": "## 标题候选\n1. Approved Title\n\n## 骨架\nUpdated skeleton"
            },
        )
        self.assertEqual(res_approve_outline.status_code, 200)

        # Wait for job to run and pause again at WAITING_USER_REVIEW
        finished = service.wait_for_job(job_id)
        self.assertEqual(finished.status, "paused")

        # Test retrieving draft and review file contents
        res_draft_file = client.get(f"/jobs/{job_id}/files/draft")
        self.assertEqual(res_draft_file.status_code, 200)
        self.assertIn("Draft content rewrite", res_draft_file.json()["content"])

        res_review_json = client.get(f"/jobs/{job_id}/files/review_json")
        self.assertEqual(res_review_json.status_code, 200)
        self.assertIn("REVIEW", res_review_json.json()["content"])

        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        self.assertEqual(state["status"], "WAITING_USER_REVIEW")

        # 3. Approve Draft
        res_approve_draft = client.post(
            f"/jobs/{job_id}/approve-draft",
            json={"accept": True},
        )
        self.assertEqual(res_approve_draft.status_code, 200)

        # Wait for job to finish formatting and outputting DRAFT post
        finished = service.wait_for_job(job_id)
        self.assertEqual(finished.status, "succeeded")

        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        self.assertEqual(state["status"], "FINISHED")
        self.assertIn("DRAFT-", finished.final_post_path)
        self.assertTrue((self.tmp_dir / finished.final_post_path).exists())

        service.shutdown()

    def test_knowledge_files_list_and_read(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        groups = client.get("/knowledge-files").json()
        names = {g["group"] for g in groups}
        self.assertIn("写作偏好", names)
        self.assertIn("步骤提示词", names)
        paths = {it["path"] for g in groups for it in g["items"]}
        self.assertIn("memory/PREFERENCES.md", paths)
        self.assertIn(".cursor/skills/video2blog/rewrite-blog/SKILL.md", paths)
        # 读白名单内文件
        r = client.get("/knowledge-file", params={"path": "knowledge/STYLE_GUIDE.md"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("Mock Style Guide", r.json()["content"])

    def test_knowledge_write_roundtrip_and_validation(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        # 正常写：ok=True
        r = client.put(
            "/knowledge-file",
            json={"path": "knowledge/STYLE_GUIDE.md", "content": "1. 新规则\n2. 简体中文"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])
        self.assertEqual(
            client.get("/knowledge-file", params={"path": "knowledge/STYLE_GUIDE.md"}).json()[
                "content"
            ],
            "1. 新规则\n2. 简体中文",
        )
        # 含占位符：仍落盘但 ok=False + errors
        r2 = client.put(
            "/knowledge-file", json={"path": "memory/PREFERENCES.md", "content": "目标字数：____"}
        )
        self.assertEqual(r2.status_code, 200)
        self.assertFalse(r2.json()["ok"])
        self.assertTrue(r2.json()["errors"])
        self.assertEqual(
            client.get("/knowledge-file", params={"path": "memory/PREFERENCES.md"}).json()[
                "content"
            ],
            "目标字数：____",
        )

    def test_knowledge_rejects_non_allowlisted(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        self.assertEqual(
            client.get("/knowledge-file", params={"path": "video2blog/server.py"}).status_code, 403
        )
        self.assertEqual(
            client.put(
                "/knowledge-file", json={"path": "video2blog/server.py", "content": "x"}
            ).status_code,
            403,
        )

    def test_upload_routes_by_extension_and_dedupes(self) -> None:
        client = TestClient(create_app(self.tmp_dir))
        # 文字稿 → input/Text
        r = client.post("/upload", params={"name": "稿子.txt"}, content="你好".encode())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["path"], "input/Text/稿子.txt")
        self.assertEqual(r.json()["kind"], "text")
        self.assertTrue((self.tmp_dir / "input/Text/稿子.txt").exists())
        # 重名 → -2
        r2 = client.post("/upload", params={"name": "稿子.txt"}, content=b"x")
        self.assertEqual(r2.json()["path"], "input/Text/稿子-2.txt")
        # 视频 → input/Video
        rv = client.post("/upload", params={"name": "clip.mp4"}, content=b"\x00\x01")
        self.assertEqual(rv.json()["path"], "input/Video/clip.mp4")
        self.assertEqual(rv.json()["kind"], "video")
        # 上传后能被 /sources 列出
        paths = {it["path"] for it in client.get("/sources").json()}
        self.assertIn("input/Text/稿子.txt", paths)
        self.assertIn("input/Video/clip.mp4", paths)
        # 不支持类型 / 空文件
        self.assertEqual(
            client.post("/upload", params={"name": "x.exe"}, content=b"x").status_code, 400
        )
        self.assertEqual(
            client.post("/upload", params={"name": "e.txt"}, content=b"").status_code, 400
        )
        # 路径穿越被 basename 化（不写到 input 之外）
        rt = client.post("/upload", params={"name": "../evil.txt"}, content=b"x")
        self.assertEqual(rt.json()["path"], "input/Text/evil.txt")

    def test_detect_speaker_heuristic_and_fallback(self) -> None:
        (self.tmp_dir / "work/intro").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/intro/raw.txt").write_text(
            "大家好，我是梁老师，今天聊学习。", encoding="utf-8"
        )
        (self.tmp_dir / "work/plain").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work/plain/raw.txt").write_text(
            "这段没有自我介绍，只是讲内容。", encoding="utf-8"
        )
        (self.tmp_dir / "input/Video").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "input/Video/c.mp4").write_bytes(b"x")
        client = TestClient(create_app(self.tmp_dir))
        # 自我介绍 → 启发式命中
        r = client.post("/api/detect-speaker", json={"source": "work/intro/raw.txt"})
        self.assertEqual(r.json()["speaker"], "梁老师")
        self.assertEqual(r.json()["method"], "heuristic")
        # 无自我介绍 → null（前端走兜底）
        self.assertIsNone(
            client.post("/api/detect-speaker", json={"source": "work/plain/raw.txt"}).json()[
                "speaker"
            ]
        )
        # 视频源 → null + 原因
        rv = client.post("/api/detect-speaker", json={"source": "input/Video/c.mp4"}).json()
        self.assertIsNone(rv["speaker"])
        self.assertIn("转录", rv["reason"])
        # 越权源 → 400
        self.assertEqual(
            client.post("/api/detect-speaker", json={"source": "../etc/passwd"}).status_code, 400
        )

    def _write_repo_contracts(self, root: Path) -> None:
        (root / "memory").mkdir(parents=True, exist_ok=True)
        (root / "knowledge").mkdir(parents=True, exist_ok=True)
        (root / ".cursor/skills/video2blog/clean-transcript").mkdir(parents=True, exist_ok=True)
        (root / ".cursor/skills/video2blog/extract-insights").mkdir(parents=True, exist_ok=True)
        (root / ".cursor/skills/video2blog/structure-narrative").mkdir(parents=True, exist_ok=True)
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
        (root / ".cursor/skills/video2blog/clean-transcript/SKILL.md").write_text(
            "---\nname: clean-transcript\n---\n# Clean",
            encoding="utf-8",
        )
        (root / ".cursor/skills/video2blog/extract-insights/SKILL.md").write_text(
            "---\nname: extract-insights\n---\n# Extract",
            encoding="utf-8",
        )
        (root / ".cursor/skills/video2blog/structure-narrative/SKILL.md").write_text(
            "---\nname: structure-narrative\n---\n# Structure",
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


class _FakeKeyring:
    """内存假钥匙串。"""

    class _Backend:
        priority = 1.0

    def __init__(self) -> None:
        self.store: dict[tuple[str, str], str] = {}

    def get_keyring(self):
        return self._Backend()

    def get_password(self, service, account):
        return self.store.get((service, account))

    def set_password(self, service, account, password):
        self.store[(service, account)] = password

    def delete_password(self, service, account):
        if (service, account) not in self.store:
            raise RuntimeError("not found")
        del self.store[(service, account)]


@unittest.skipIf(TestClient is None, "fastapi.testclient.TestClient is not installed")
class TestLlmProfilesAPI(unittest.TestCase):
    """配置档 CRUD 端点 —— 隔离 XDG_CONFIG_HOME + mock 钥匙串，不碰真实系统。"""

    def setUp(self) -> None:
        import os

        from video2blog.engine import secrets_store as ss

        self.tmp = Path(tempfile.mkdtemp())
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = str(self.tmp)
        self.ss = ss
        self._real_keyring = ss._keyring
        ss._keyring = _FakeKeyring()
        self._old_key = os.environ.pop("VIDEO2BLOG_API_KEY", None)
        self.client = TestClient(create_app(self.tmp))

    def tearDown(self) -> None:
        import os

        shutil.rmtree(self.tmp, ignore_errors=True)
        self.ss._keyring = self._real_keyring
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg
        if self._old_key is not None:
            os.environ["VIDEO2BLOG_API_KEY"] = self._old_key

    def test_crud_flow_and_no_plaintext(self) -> None:
        c = self.client
        self.assertEqual(c.get("/api/llm-profiles").json()["profiles"], [])

        # 建第一档（带 key）→ 自动成默认
        r = c.post(
            "/api/llm-profiles",
            json={
                "name": "DeepSeek",
                "provider": "deepseek",
                "model": "deepseek-chat",
                "api_key": "sk-AAAA1111",
            },
        )
        self.assertEqual(r.status_code, 201)
        pid = r.json()["created_id"]
        self.assertEqual(r.json()["defaultProfileId"], pid)

        # 建第二档并设默认
        r2 = c.post(
            "/api/llm-profiles",
            json={"name": "GPT", "provider": "openai", "model": "gpt-4o", "api_key": "sk-BBBB2222"},
        )
        pid2 = r2.json()["created_id"]
        self.assertEqual(
            c.post(f"/api/llm-profiles/{pid2}/default").json()["defaultProfileId"], pid2
        )

        snap = c.get("/api/llm-profiles").json()
        self.assertNotIn("sk-AAAA1111", json.dumps(snap))
        self.assertNotIn("sk-BBBB2222", json.dumps(snap))
        suffixes = {p["name"]: p["key_suffix"] for p in snap["profiles"]}
        self.assertEqual(suffixes, {"DeepSeek": "1111", "GPT": "2222"})

        # PUT 改名（不带 key，key 保留）
        c.put(f"/api/llm-profiles/{pid}", json={"name": "DS·改名"})
        names = {p["name"] for p in c.get("/api/llm-profiles").json()["profiles"]}
        self.assertIn("DS·改名", names)
        self.assertTrue(
            next(p for p in c.get("/api/llm-profiles").json()["profiles"] if p["id"] == pid)[
                "has_key"
            ]
        )

        # 删某档 key（仅 key）
        c.request("DELETE", f"/api/llm-profiles/{pid2}/key")
        self.assertFalse(
            next(p for p in c.get("/api/llm-profiles").json()["profiles"] if p["id"] == pid2)[
                "has_key"
            ]
        )

        # 删档 → 默认回退
        c.request("DELETE", f"/api/llm-profiles/{pid2}")
        snap = c.get("/api/llm-profiles").json()
        self.assertEqual(len(snap["profiles"]), 1)
        self.assertEqual(snap["defaultProfileId"], pid)

    def test_404_on_unknown_profile(self) -> None:
        self.assertEqual(
            self.client.put("/api/llm-profiles/nope", json={"name": "x"}).status_code, 404
        )
        self.assertEqual(self.client.request("DELETE", "/api/llm-profiles/nope").status_code, 404)
        self.assertEqual(self.client.post("/api/llm-profiles/nope/default").status_code, 404)


if __name__ == "__main__":
    unittest.main()

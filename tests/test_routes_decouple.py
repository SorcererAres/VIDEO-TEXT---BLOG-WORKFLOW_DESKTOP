"""DECOUPLE Round 1：新 /api/tasks*、/api/posts* 与旧 /jobs* 的行为一致性。

这一轮只搬代码、不改语义，所以"新端点 ≡ 旧端点"是验收基线。
等 Round 3 删除语义重写后再加 diverged-behavior 测试。
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None

from video2blog.server import create_app


@unittest.skipIf(TestClient is None, "fastapi.testclient.TestClient is not installed")
class TestDecoupleRound1Aliases(unittest.TestCase):
    """新 /api/* 端点与旧 /jobs/* 应返回完全一致的 JSON。"""

    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        (self.tmp_dir / "memory").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "knowledge").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "output" / "Posts" / "2026").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "output" / "Reviews").mkdir(parents=True, exist_ok=True)
        (self.tmp_dir / "work").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _seed_one_post(self) -> None:
        posts_dir = self.tmp_dir / "output" / "Posts" / "2026"
        (posts_dir / "2026-06-04-合规成品.md").write_text(
            "---\ntitle: 合规成品\ndate: '2026-06-04'\nentry: transcript\nmode: full\n"
            "routing: /lecture\nspeaker: 测试演讲人\nsource: work/foo/raw.txt\n"
            "pass_score: 55/60\n---\n# 合规成品\n正文\n",
            encoding="utf-8",
        )
        (self.tmp_dir / "output" / "Reviews" / "2026-06-04-合规成品.review.md").write_text(
            "## 评分\nok\n", encoding="utf-8"
        )

    def test_api_posts_equals_legacy_jobs_history(self) -> None:
        """GET /api/posts 与 GET /jobs/history 必须返回完全相同的 JSON。"""
        self._seed_one_post()
        client = TestClient(create_app(self.tmp_dir))

        legacy = client.get("/jobs/history")
        modern = client.get("/api/posts")

        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(modern.status_code, 200)
        # 列表内容必须一致（顺序也保留——同一函数生成）
        self.assertEqual(legacy.json(), modern.json())
        # 哨兵：至少有一条记录，验证 setUp 起效
        self.assertGreaterEqual(len(modern.json()), 1)
        self.assertEqual(modern.json()[0]["kind"], "historical")

    def test_api_posts_empty_when_no_posts(self) -> None:
        """没有任何成品时 /api/posts 返回 [] 而非 404。"""
        client = TestClient(create_app(self.tmp_dir))
        res = client.get("/api/posts")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

    def test_api_tasks_equals_legacy_jobs_list(self) -> None:
        """GET /api/tasks 与 GET /jobs 必须返回完全相同的 JSON。

        新装载的 app 在没提交任务且 work/ 干净时应为 []；两端点共用同一 service。
        """
        client = TestClient(create_app(self.tmp_dir))

        legacy = client.get("/jobs")
        modern = client.get("/api/tasks")

        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(modern.status_code, 200)
        self.assertEqual(legacy.json(), modern.json())
        # work/ 干净时无任务可恢复
        self.assertEqual(modern.json(), [])

    def test_api_tasks_unknown_id_returns_404(self) -> None:
        """未知任务 ID 应 404，错误信息透传 service 的 KeyError 文案。"""
        client = TestClient(create_app(self.tmp_dir))
        res = client.get("/api/tasks/does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertIn("未知任务", res.json()["detail"])

    def test_legacy_delete_history_still_works(self) -> None:
        """老 /jobs/history 删除链路重构后仍工作（行为依赖 post_repo.purge_post_chain）。

        建一条成品 + review，调老端点删，验证文件确实没了 + 返回 deleted 列表非空。
        Round 3 才会废除该端点，本轮仅验证下沉到 repos 后行为不变。
        """
        self._seed_one_post()
        client = TestClient(create_app(self.tmp_dir))

        res = client.delete(
            "/jobs/history",
            params={
                "post_path": "output/Posts/2026/2026-06-04-合规成品.md",
                "posts": "true",
                "reviews": "true",
                "work": "false",
                "history_index": "false",
                "fingerprints": "false",
            },
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["ok"])
        # 至少删掉了 post 和 review
        self.assertGreaterEqual(len(body["deleted"]), 2)
        # 文件物理消失
        self.assertFalse((self.tmp_dir / "output" / "Posts" / "2026" / "2026-06-04-合规成品.md").exists())
        self.assertFalse((self.tmp_dir / "output" / "Reviews" / "2026-06-04-合规成品.review.md").exists())

    def test_legacy_delete_history_rejects_path_traversal(self) -> None:
        """./../../ 攻击应被 post_repo 抛 ValueError，路由翻 400。"""
        client = TestClient(create_app(self.tmp_dir))
        res = client.delete(
            "/jobs/history",
            params={"post_path": "../../etc/passwd"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("非法路径", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()

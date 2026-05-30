"""健康检查 + LLM 连接测试。"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from video2blog.routes.models import TestLLMRequest
from video2blog.server_core import redact_sensitive_text

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "repo_root": str(root)}

    @app.post("/api/test-llm")
    def test_llm(payload: TestLLMRequest) -> dict[str, Any]:
        """测试 LLM 配置是否能联通 —— Settings 页"测试连接"按钮调它。

        用最小提示发 1 次请求,2xx 即 ok。不写入任何任务/缓存。
        - api_key/api_base/model 都是可选,缺什么按优先级链 fallback：request > 环境变量 > 钥匙串/config。
        - 短超时(15s 单次 / 20s 总死线),防止 hang 住用户。
        """
        from video2blog.engine.client import LLMClient
        from video2blog.engine.secrets_store import resolve_llm_config

        resolved = resolve_llm_config(
            payload.profile_id, payload.api_key, payload.api_base, payload.model
        )
        secret_candidates = [
            payload.api_key,
            os.environ.get("VIDEO2BLOG_API_KEY"),
            resolved["api_key"],
        ]
        try:
            client = LLMClient(
                api_key=resolved["api_key"],
                api_base=resolved["api_base"],
                model=resolved["model"],
                max_budget_tokens=100_000,
                per_request_timeout=15,
                max_total_seconds=20,
            )
            if not client.api_key:
                return {
                    "ok": False,
                    "error": "缺失 API Key —— request / 环境变量 VIDEO2BLOG_API_KEY / 系统钥匙串 都没有",
                }
            t0 = time.time()
            out = client.call_api(
                system_prompt="You are a connection test tool. Reply with exactly one word.",
                user_prompt="Say only the single word: pong",
                max_retries=1,
            )
            latency_ms = int((time.time() - t0) * 1000)
            return {
                "ok": True,
                "model": client.model,
                "api_base": client.api_base,
                "latency_ms": latency_ms,
                "sample": (out or "").strip()[:120],
                "key_source": resolved["key_source"],
            }
        except Exception as exc:
            return {"ok": False, "error": redact_sensitive_text(str(exc), *secret_candidates)}

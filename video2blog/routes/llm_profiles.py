"""LLM 多配置档 CRUD（非敏感字段落 config，key 走系统钥匙串）。"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from video2blog.routes.models import LlmProfileRequest

if TYPE_CHECKING:
    from fastapi import FastAPI

    from video2blog.server_core import EngineJobService


def register(app: FastAPI, service: EngineJobService, root: Path) -> None:
    from fastapi import HTTPException

    @app.get("/api/llm-profiles")
    def list_llm_profiles() -> dict[str, Any]:
        """返回全部配置档的安全快照 + 默认档 + 钥匙串/环境变量状态。

        **绝不返回明文 key** —— 防本地恶意页面经此端点窃取。
        """
        from video2blog.engine.secrets_store import public_profiles

        return public_profiles()

    @app.post("/api/llm-profiles", status_code=201)
    def create_llm_profile(payload: LlmProfileRequest) -> dict[str, Any]:
        """新建配置档；非敏感字段落 config，api_key 非空才写钥匙串。返回完整快照集合。"""
        from video2blog.engine import secrets_store as ss

        data = {k: v for k, v in payload.model_dump().items() if k != "api_key" and v is not None}
        profile = ss.create_profile(data)
        if payload.api_key and payload.api_key.strip():
            try:
                ss.set_key(profile["id"], payload.api_key)
            except RuntimeError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {**ss.public_profiles(), "created_id": profile["id"]}

    @app.put("/api/llm-profiles/{profile_id}")
    def update_llm_profile(profile_id: str, payload: LlmProfileRequest) -> dict[str, Any]:
        """更新某档非敏感字段；api_key 非空才覆盖钥匙串，省略 / null 则保留原 key。"""
        from video2blog.engine import secrets_store as ss

        patch = {k: v for k, v in payload.model_dump().items() if k != "api_key" and v is not None}
        if ss.update_profile(profile_id, patch) is None:
            raise HTTPException(status_code=404, detail=f"配置档不存在: {profile_id}")
        if payload.api_key is not None and payload.api_key.strip():
            try:
                ss.set_key(profile_id, payload.api_key)
            except RuntimeError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
        return ss.public_profiles()

    @app.delete("/api/llm-profiles/{profile_id}")
    def delete_llm_profile(profile_id: str) -> dict[str, Any]:
        """删档 + 删其钥匙串 key；删的是默认档时自动重选默认。"""
        from video2blog.engine import secrets_store as ss

        if not ss.delete_profile(profile_id):
            raise HTTPException(status_code=404, detail=f"配置档不存在: {profile_id}")
        return ss.public_profiles()

    @app.post("/api/llm-profiles/{profile_id}/default")
    def set_default_llm_profile(profile_id: str) -> dict[str, Any]:
        """把某档设为默认。"""
        from video2blog.engine import secrets_store as ss

        if not ss.set_default(profile_id):
            raise HTTPException(status_code=404, detail=f"配置档不存在: {profile_id}")
        return ss.public_profiles()

    @app.delete("/api/llm-profiles/{profile_id}/key")
    def delete_llm_profile_key(profile_id: str) -> dict[str, Any]:
        """仅清除某档钥匙串中的 key（保留档本身）。"""
        from video2blog.engine import secrets_store as ss

        if ss.get_profile(profile_id) is None:
            raise HTTPException(status_code=404, detail=f"配置档不存在: {profile_id}")
        ss.delete_key(profile_id)
        result = ss.public_profiles()
        if result["env_key_present"]:
            result["message"] = (
                "已清除钥匙串中的 Key，但环境变量 VIDEO2BLOG_API_KEY 仍在生效（优先级最高，覆盖所有档），"
                "如需彻底移除请在 shell / .env 中删除该变量。"
            )
        return result

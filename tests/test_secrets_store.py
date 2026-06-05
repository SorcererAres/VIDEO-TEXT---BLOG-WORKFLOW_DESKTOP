"""Tests for the LLM 多配置档安全存储层 (video2blog.engine.secrets_store)。

钥匙串通过内存假实现 mock，绝不触碰真实 macOS Keychain；config 文件隔离到临时目录。
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from video2blog.engine import secrets_store as ss


class _FakeBackend:
    priority = 1.0  # keyring_available() 用 priority>0 判断后端可用


class _FakeKeyring:
    """内存假钥匙串，模拟 keyring 的 get/set/delete_password。"""

    def __init__(self) -> None:
        self.store: dict[tuple[str, str], str] = {}

    def get_keyring(self):
        return _FakeBackend()

    def get_password(self, service: str, account: str):
        return self.store.get((service, account))

    def set_password(self, service: str, account: str, password: str) -> None:
        self.store[(service, account)] = password

    def delete_password(self, service: str, account: str) -> None:
        if (service, account) not in self.store:
            raise RuntimeError("PasswordDeleteError: not found")
        del self.store[(service, account)]


class SecretsStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = str(self.tmp)
        self._real_keyring = ss._keyring
        self.fake = _FakeKeyring()
        ss._keyring = self.fake
        self._old_envs = {
            k: os.environ.pop(k, None)
            for k in ("VIDEO2BLOG_API_KEY", "VIDEO2BLOG_API_BASE", "VIDEO2BLOG_MODEL")
        }

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)
        ss._keyring = self._real_keyring
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg
        for k, v in self._old_envs.items():
            if v is not None:
                os.environ[k] = v

    # ── 钥匙串按 profile 读写 ──

    def test_key_roundtrip_per_profile(self) -> None:
        self.assertIsNone(ss.get_key("p1"))
        ss.set_key("p1", "sk-aaa")
        ss.set_key("p2", "sk-bbb")
        self.assertEqual(ss.get_key("p1"), "sk-aaa")
        self.assertEqual(ss.get_key("p2"), "sk-bbb")
        self.assertTrue(ss.delete_key("p1"))
        self.assertIsNone(ss.get_key("p1"))
        self.assertEqual(ss.get_key("p2"), "sk-bbb")  # 互不影响
        self.assertFalse(ss.delete_key("p1"))  # 再删返回 False

    def test_set_empty_key_clears(self) -> None:
        ss.set_key("p1", "sk-xyz")
        ss.set_key("p1", "   ")
        self.assertIsNone(ss.get_key("p1"))

    # ── v1 → v2 迁移 ──

    def test_migration_v1_config_and_keychain(self) -> None:
        # 旧 v1 config + 旧钥匙串 api_key
        p = ss.config_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(
                {
                    "provider": "deepseek",
                    "api_base": "https://api.deepseek.com/v1",
                    "model": "deepseek-chat",
                }
            ),
            encoding="utf-8",
        )
        self.fake.store[(ss._KEYRING_SERVICE, "api_key")] = "sk-LEGACY"

        profiles = ss.list_profiles()
        self.assertEqual(len(profiles), 1)
        self.assertEqual(profiles[0]["name"], "默认")
        self.assertEqual(profiles[0]["provider"], "deepseek")
        self.assertEqual(profiles[0]["model"], "deepseek-chat")
        self.assertEqual(ss.get_default_id(), profiles[0]["id"])
        # 旧 key 迁到新档，旧 account 清除
        self.assertEqual(ss.get_key(profiles[0]["id"]), "sk-LEGACY")
        self.assertNotIn((ss._KEYRING_SERVICE, "api_key"), self.fake.store)
        # 落盘已是 v2
        self.assertEqual(json.loads(p.read_text())["schema_version"], 2)

    def test_fresh_env_has_no_profiles(self) -> None:
        self.assertEqual(ss.list_profiles(), [])
        self.assertIsNone(ss.get_default_id())

    # ── profiles CRUD ──

    def test_create_sets_first_as_default(self) -> None:
        a = ss.create_profile({"name": "A", "provider": "openai"})
        self.assertEqual(ss.get_default_id(), a["id"])
        b = ss.create_profile({"name": "B"})
        self.assertEqual(ss.get_default_id(), a["id"])  # 不抢默认
        self.assertEqual(len(ss.list_profiles()), 2)
        self.assertTrue(ss.set_default(b["id"]))
        self.assertEqual(ss.get_default_id(), b["id"])

    def test_update_only_known_fields(self) -> None:
        a = ss.create_profile({"name": "A"})
        ss.update_profile(a["id"], {"name": "A2", "temperature": 0.7, "junk": "x"})
        got = ss.get_profile(a["id"])
        self.assertEqual(got["name"], "A2")
        self.assertEqual(got["temperature"], 0.7)
        self.assertNotIn("junk", got)
        self.assertIsNone(ss.update_profile("nope", {"name": "x"}))

    def test_delete_profile_clears_key_and_reselects_default(self) -> None:
        a = ss.create_profile({"name": "A"})
        b = ss.create_profile({"name": "B"})
        ss.set_key(a["id"], "sk-a")
        ss.set_default(a["id"])
        self.assertTrue(ss.delete_profile(a["id"]))
        self.assertIsNone(ss.get_key(a["id"]))  # key 连带删
        self.assertEqual(ss.get_default_id(), b["id"])  # 默认回退到剩余的
        self.assertFalse(ss.delete_profile("nope"))

    # ── 解析优先级 ──

    def test_resolve_precedence_request_env_keychain(self) -> None:
        a = ss.create_profile(
            {"name": "A", "provider": "deepseek", "api_base": "https://x/v1", "model": "m1"}
        )
        ss.set_key(a["id"], "keychain-key")
        os.environ["VIDEO2BLOG_API_KEY"] = "env-key"
        try:
            r = ss.resolve_llm_config(a["id"], req_key="req-key")
            self.assertEqual((r["api_key"], r["key_source"]), ("req-key", "request"))
            r = ss.resolve_llm_config(a["id"])
            self.assertEqual((r["api_key"], r["key_source"]), ("env-key", "env"))
        finally:
            del os.environ["VIDEO2BLOG_API_KEY"]
        r = ss.resolve_llm_config(a["id"])
        self.assertEqual((r["api_key"], r["key_source"]), ("keychain-key", "keychain"))
        self.assertEqual(r["api_base"], "https://x/v1")
        self.assertEqual(r["model"], "m1")

    def test_resolve_unknown_profile_falls_back_to_default(self) -> None:
        a = ss.create_profile({"name": "A", "model": "default-model"})
        ss.set_key(a["id"], "sk-default")
        r = ss.resolve_llm_config("ghost-id")  # 不存在 → 回退默认档
        self.assertEqual(r["profile_id"], a["id"])
        self.assertEqual(r["model"], "default-model")
        self.assertEqual(r["api_key"], "sk-default")

    def test_resolve_none_when_no_profiles(self) -> None:
        r = ss.resolve_llm_config()
        self.assertEqual(r["api_key"], "")
        self.assertEqual(r["key_source"], "none")
        self.assertIsNone(r["profile_id"])

    # ── 对外快照不泄漏明文 ──

    def test_public_profiles_no_plaintext(self) -> None:
        a = ss.create_profile({"name": "A", "provider": "openai", "model": "gpt-4o"})
        ss.set_key(a["id"], "sk-supersecretvalue")
        pub = ss.public_profiles()
        self.assertNotIn("sk-supersecretvalue", json.dumps(pub))
        prof = pub["profiles"][0]
        self.assertTrue(prof["has_key"])
        self.assertEqual(prof["key_suffix"], "alue")
        self.assertEqual(prof["key_source"], "keychain")
        self.assertEqual(pub["defaultProfileId"], a["id"])
        self.assertTrue(pub["keyring_available"])
        self.assertFalse(pub["env_key_present"])

    def test_public_profiles_env_overrides_source(self) -> None:
        a = ss.create_profile({"name": "A"})
        ss.set_key(a["id"], "sk-keychain")
        os.environ["VIDEO2BLOG_API_KEY"] = "env-9999"
        try:
            pub = ss.public_profiles()
            self.assertTrue(pub["env_key_present"])
            prof = pub["profiles"][0]
            self.assertEqual(prof["key_source"], "env")
            self.assertEqual(prof["key_suffix"], "9999")
        finally:
            del os.environ["VIDEO2BLOG_API_KEY"]


if __name__ == "__main__":
    unittest.main()

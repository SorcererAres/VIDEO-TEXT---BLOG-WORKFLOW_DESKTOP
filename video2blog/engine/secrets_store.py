"""LLM 多配置档的安全存储层。

设计目标：API Key **绝不明文落盘**，每个配置档的 key 各存系统钥匙串（macOS Keychain）的
一条记录（account = ``profile:<id>``）；非敏感项（名称/provider/api_base/model/参数/启用）
存用户 config 目录的明文 JSON。

config.json (schema_version=2)::

    {
      "schema_version": 2,
      "profiles": [
        {"id", "name", "provider", "api_base", "model",
         "temperature", "max_tokens", "thinking", "enabled"},
        ...
      ],
      "defaultProfileId": "<id>" | null
    }

解析优先级（贯穿全局）：
  - api_key：request > 环境变量 VIDEO2BLOG_API_KEY（全局逃生口，覆盖所有档）> 该档钥匙串
  - api_base：request > 环境变量 VIDEO2BLOG_API_BASE > 该档 config > None
  - model：  request > 环境变量 VIDEO2BLOG_MODEL    > 该档 config > None
  - 用哪个档：request.profile_id > defaultProfileId
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from video2blog.utils import atomic_write

_KEYRING_SERVICE = "video2blog"
# v1 单配置时代的钥匙串 account（迁移时读取并清除）。
_LEGACY_ACCOUNT = "api_key"
_SCHEMA_VERSION = 2

# 配置档的非敏感字段及默认值（key 不在此，存钥匙串）。
_PROFILE_DEFAULTS: dict[str, Any] = {
    "name": "默认",
    "provider": "deepseek",
    "api_base": "",
    "model": "",
    "temperature": 0.0,
    "max_tokens": 1024,
    "thinking": "default",  # "default" | "on" | "off"
    "enabled": True,
}

# 优雅降级：keyring 装不上 / 没有可用 backend 时，整套退回「仅环境变量」，服务不崩。
try:  # pragma: no cover - 取决于运行环境是否装了 keyring
    import keyring as _keyring
    from keyring.errors import KeyringError as _KeyringError
except Exception:  # noqa: BLE001 - 任何导入期异常都视为不可用
    _keyring = None

    class _KeyringError(Exception):  # type: ignore[no-redef]
        """keyring 缺席时的占位异常类型。"""


def keyring_available() -> bool:
    """钥匙串后端当前是否可用。不可用时 UI 应提示退回环境变量。"""
    if _keyring is None:
        return False
    try:
        backend = _keyring.get_keyring()
    except Exception:  # noqa: BLE001
        return False
    return getattr(backend, "priority", 0) > 0


def _account(profile_id: str) -> str:
    return f"profile:{profile_id}"


# ─────────────────────────── 钥匙串读写（按 profile） ───────────────────────────


def get_key(profile_id: str) -> str | None:
    """取某档钥匙串里的 key；不存在 / 不可用 / 锁定都返回 None（绝不抛）。"""
    if _keyring is None or not profile_id:
        return None
    try:
        value = _keyring.get_password(_KEYRING_SERVICE, _account(profile_id))
    except Exception:  # noqa: BLE001 - 锁定、权限拒绝等都当作「取不到」
        return None
    return value or None


def set_key(profile_id: str, key: str) -> None:
    """把某档的 key 写进钥匙串。空值视为「清除」。钥匙串不可用时抛出可读错误。"""
    cleaned = (key or "").strip()
    if not cleaned:
        delete_key(profile_id)
        return
    if not keyring_available():
        raise RuntimeError(
            "系统钥匙串不可用，无法安全存储 API Key。"
            "请改用环境变量 VIDEO2BLOG_API_KEY，或检查 keyring 是否安装。"
        )
    try:
        _keyring.set_password(_KEYRING_SERVICE, _account(profile_id), cleaned)
    except _KeyringError as exc:  # pragma: no cover - 取决于系统钥匙串状态
        raise RuntimeError(f"写入系统钥匙串失败：{exc}") from exc


def delete_key(profile_id: str) -> bool:
    """从钥匙串删某档的 key。返回是否真的删掉了（原本不存在则 False）。"""
    if _keyring is None or not profile_id:
        return False
    try:
        _keyring.delete_password(_KEYRING_SERVICE, _account(profile_id))
        return True
    except Exception:  # noqa: BLE001 - PasswordDeleteError 等：本就没有，视为已清
        return False


def _delete_legacy_key() -> str | None:
    """读出并清除 v1 单配置时代的钥匙串 key（用于迁移）。"""
    if _keyring is None:
        return None
    try:
        value = _keyring.get_password(_KEYRING_SERVICE, _LEGACY_ACCOUNT)
    except Exception:  # noqa: BLE001
        return None
    if value:
        try:
            _keyring.delete_password(_KEYRING_SERVICE, _LEGACY_ACCOUNT)
        except Exception:  # noqa: BLE001
            pass
    return value or None


# ─────────────────────────── config 文件（profiles） ───────────────────────────


def config_path() -> Path:
    """非敏感配置文件路径（放仓库外，不碰 input/work/output 边界）。"""
    base = os.environ.get("XDG_CONFIG_HOME", "").strip() or str(Path.home() / ".config")
    return Path(base) / "video2blog" / "config.json"


def _read_raw() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - 损坏的 config 不应让服务崩
        return {}
    return data if isinstance(data, dict) else {}


def _write_raw(data: dict[str, Any]) -> None:
    atomic_write(config_path(), json.dumps(data, ensure_ascii=False, indent=2))


def _normalize_profile(raw: dict[str, Any]) -> dict[str, Any]:
    """补齐缺省字段、生成 id，确保形状统一。"""
    profile = {**_PROFILE_DEFAULTS, **(raw or {})}
    if not profile.get("id"):
        profile["id"] = uuid.uuid4().hex
    profile["enabled"] = bool(profile.get("enabled", True))
    return profile


def _load() -> dict[str, Any]:
    """读 config 并就地迁移到 v2；返回 {schema_version, profiles, defaultProfileId}。

    迁移幂等：v1（含旧 {provider,api_base,model} 或旧钥匙串 api_key）→ 建一个名为「默认」的
    profile，把旧钥匙串 key 迁到 profile:<id>，设为 default，写回 schema_version=2。
    """
    raw = _read_raw()

    if raw.get("schema_version") == _SCHEMA_VERSION and isinstance(raw.get("profiles"), list):
        # 已是 v2：规范化即可（防手改坏）。
        profiles = [_normalize_profile(p) for p in raw["profiles"] if isinstance(p, dict)]
        default_id = raw.get("defaultProfileId")
        if default_id not in {p["id"] for p in profiles}:
            default_id = profiles[0]["id"] if profiles else None
        return {"schema_version": _SCHEMA_VERSION, "profiles": profiles, "defaultProfileId": default_id}

    # ── v1 → v2 迁移 ──
    legacy_key = _delete_legacy_key()
    has_v1_config = any(raw.get(k) for k in ("provider", "api_base", "model"))

    state: dict[str, Any] = {"schema_version": _SCHEMA_VERSION, "profiles": [], "defaultProfileId": None}
    if has_v1_config or legacy_key:
        profile = _normalize_profile(
            {
                "name": "默认",
                "provider": raw.get("provider") or _PROFILE_DEFAULTS["provider"],
                "api_base": raw.get("api_base") or "",
                "model": raw.get("model") or "",
            }
        )
        state["profiles"] = [profile]
        state["defaultProfileId"] = profile["id"]
        _write_raw(state)
        if legacy_key:
            # 旧 key 迁到新档（钥匙串可用时）。
            try:
                set_key(profile["id"], legacy_key)
            except RuntimeError:
                pass
    else:
        # 全新环境：落一个空 v2 骨架，避免每次都跑迁移分支。
        _write_raw(state)
    return state


# ─────────────────────────── profiles CRUD ───────────────────────────


def list_profiles() -> list[dict[str, Any]]:
    return _load()["profiles"]


def get_default_id() -> str | None:
    return _load()["defaultProfileId"]


def get_profile(profile_id: str) -> dict[str, Any] | None:
    for profile in _load()["profiles"]:
        if profile["id"] == profile_id:
            return profile
    return None


def _resolve_profile(profile_id: str | None) -> dict[str, Any] | None:
    """解析要用的档：显式 id 优先；找不到（已删/陈旧）则回退默认档。"""
    state = _load()
    by_id = {p["id"]: p for p in state["profiles"]}
    if profile_id and profile_id in by_id:
        return by_id[profile_id]
    default_id = state["defaultProfileId"]
    if default_id and default_id in by_id:
        return by_id[default_id]
    return None


def create_profile(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """新建一个档；首个档自动设为默认。返回新档。"""
    state = _load()
    profile = _normalize_profile(data or {})
    state["profiles"].append(profile)
    if not state["defaultProfileId"]:
        state["defaultProfileId"] = profile["id"]
    _write_raw(state)
    return profile


def update_profile(profile_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    """更新某档的非敏感字段（忽略 id / 未知键）。返回更新后的档，找不到返回 None。"""
    state = _load()
    updated: dict[str, Any] | None = None
    for profile in state["profiles"]:
        if profile["id"] == profile_id:
            for key in _PROFILE_DEFAULTS:
                if key in patch and patch[key] is not None:
                    profile[key] = patch[key]
            updated = profile
            break
    if updated is not None:
        _write_raw(state)
    return updated


def delete_profile(profile_id: str) -> bool:
    """删档 + 删其钥匙串 key；若删的是默认档，自动把剩余第一个升为默认。"""
    state = _load()
    before = len(state["profiles"])
    state["profiles"] = [p for p in state["profiles"] if p["id"] != profile_id]
    if len(state["profiles"]) == before:
        return False
    delete_key(profile_id)
    if state["defaultProfileId"] == profile_id:
        state["defaultProfileId"] = state["profiles"][0]["id"] if state["profiles"] else None
    _write_raw(state)
    return True


def set_default(profile_id: str) -> bool:
    state = _load()
    if profile_id not in {p["id"] for p in state["profiles"]}:
        return False
    state["defaultProfileId"] = profile_id
    _write_raw(state)
    return True


# ─────────────────────────── 解析与对外快照 ───────────────────────────


def _first_nonempty(*values: Any) -> str | None:
    for value in values:
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def resolve_llm_config(
    profile_id: str | None = None,
    req_key: str | None = None,
    req_base: str | None = None,
    req_model: str | None = None,
) -> dict[str, Any]:
    """按优先级链解析出真正要用的 {api_key, api_base, model, key_source, profile_id, provider}。

    key_source ∈ {"request", "env", "keychain", "none"}。
    api_base / model 解析不到时返回 None，交给 LLMClient 套自身内置默认。
    """
    profile = _resolve_profile(profile_id)
    resolved_pid = profile["id"] if profile else None

    # ── api_key：request > env > 该档钥匙串 ──
    env_key = os.environ.get("VIDEO2BLOG_API_KEY", "").strip()
    if req_key and req_key.strip():
        api_key, key_source = req_key.strip(), "request"
    elif env_key:
        api_key, key_source = env_key, "env"
    else:
        kc_key = get_key(resolved_pid) if resolved_pid else None
        if kc_key:
            api_key, key_source = kc_key, "keychain"
        else:
            api_key, key_source = "", "none"

    api_base = _first_nonempty(
        req_base,
        os.environ.get("VIDEO2BLOG_API_BASE"),
        profile.get("api_base") if profile else None,
    )
    model = _first_nonempty(
        req_model,
        os.environ.get("VIDEO2BLOG_MODEL"),
        profile.get("model") if profile else None,
    )

    return {
        "api_key": api_key,
        "api_base": api_base,
        "model": model,
        "key_source": key_source,
        "profile_id": resolved_pid,
        "provider": profile.get("provider") if profile else None,
    }


def _public_profile(profile: dict[str, Any], env_key_present: bool) -> dict[str, Any]:
    """单档安全快照 —— **绝不含明文 key**，只给 last4 与来源。"""
    kc_key = get_key(profile["id"])
    if env_key_present:
        has_key, key_source, suffix = True, "env", os.environ["VIDEO2BLOG_API_KEY"].strip()[-4:]
    elif kc_key:
        has_key, key_source, suffix = True, "keychain", kc_key[-4:]
    else:
        has_key, key_source, suffix = False, "none", None
    return {
        "id": profile["id"],
        "name": profile["name"],
        "provider": profile["provider"],
        "api_base": profile["api_base"],
        "model": profile["model"],
        "temperature": profile["temperature"],
        "max_tokens": profile["max_tokens"],
        "thinking": profile["thinking"],
        "enabled": profile["enabled"],
        "has_key": has_key,
        "key_source": key_source,
        "key_suffix": suffix,
    }


def public_profiles() -> dict[str, Any]:
    """给 GET /api/llm-profiles 的安全快照集合。"""
    state = _load()
    env_present = bool(os.environ.get("VIDEO2BLOG_API_KEY", "").strip())
    return {
        "profiles": [_public_profile(p, env_present) for p in state["profiles"]],
        "defaultProfileId": state["defaultProfileId"],
        "keyring_available": keyring_available(),
        "env_key_present": env_present,
    }

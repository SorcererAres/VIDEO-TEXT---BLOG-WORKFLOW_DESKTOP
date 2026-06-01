"""打包版首启初始化：把工作目录建好、合同模板补齐，让双击全新 .app 开箱即用。

打包版（frozen）工作目录默认 ~/Documents/Video2Blog，全新时没有写作合同
（WORKFLOW.md / memory / knowledge / .cursor/skills），改写链 Pre-Flight 会失败。
server 启动时调 ensure_repo_initialized()，从 onedir/contracts/（scripts/bundle_contracts.sh
打包的模板）复制缺失的合同 + 建标准目录结构。只补缺失项，绝不覆盖用户已改的。

dev（非 frozen）下仓库自带合同，本模块只确保目录存在、不复制。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

# 工作目录的标准子目录（input 原料 / work 过程 / output 成品）。
_STANDARD_DIRS = ("input/Video", "input/Text", "work", "output")
# 从打包模板按需复制的合同项（顶层名）。
_CONTRACT_ITEMS = ("WORKFLOW.md", "memory", "knowledge", ".cursor")


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundled_contracts_dir() -> Path | None:
    """frozen 下打包的合同模板目录（<exe_dir>/contracts/）；dev 或缺失返回 None。"""
    if not is_frozen():
        return None
    d = Path(sys.executable).resolve().parent / "contracts"
    return d if d.is_dir() else None


def ensure_repo_initialized(repo_root: Path) -> list[str]:
    """首启初始化工作目录：建标准目录 + 从打包模板补齐缺失合同。

    幂等、非破坏：只新建不存在的目录、只复制工作目录里还没有的合同项，
    用户已经改过的合同（如在 GUI「风格」里编辑过的 PREFERENCES）绝不覆盖。
    返回这次新建/复制的项列表（供日志）。
    """
    repo_root = Path(repo_root)
    repo_root.mkdir(parents=True, exist_ok=True)

    created: list[str] = []
    for sub in _STANDARD_DIRS:
        p = repo_root / sub
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
            created.append(sub + "/")

    contracts = bundled_contracts_dir()
    if contracts is None:
        # dev：仓库本身就是工作目录，合同齐全，不复制。
        return created

    for item in _CONTRACT_ITEMS:
        src = contracts / item
        dst = repo_root / item
        if not src.exists() or dst.exists():
            continue
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        created.append(item)

    # fingerprints.jsonl 是机器生成的风格指纹，首启建空（Step 8 后续追加）。
    mem = repo_root / "memory"
    fp = mem / "fingerprints.jsonl"
    if mem.exists() and not fp.exists():
        fp.write_text("", encoding="utf-8")
        created.append("memory/fingerprints.jsonl")

    return created

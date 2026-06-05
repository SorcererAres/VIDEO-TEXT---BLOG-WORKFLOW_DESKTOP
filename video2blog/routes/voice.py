"""风格：从 memory/fingerprints.jsonl 聚合出「文风画像」。

只读、纯本地、无密钥。memory/ 不在 /file 白名单（那只放 output/work），故单开此端点。
聚合在后端做，前端只渲染。
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI

    from video2blog.server_core import EngineJobService


def register(app: FastAPI, service: EngineJobService, root: Path) -> None:
    @app.get("/fingerprints")
    def get_fingerprints() -> dict[str, Any]:
        """聚合风格指纹 → 文风画像。空/缺文件返回 count=0。"""
        path = root / "memory" / "fingerprints.jsonl"
        records: list[dict[str, Any]] = []
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # 跳过坏行，不让一行坏数据拖垮整个画像

        if not records:
            return {
                "count": 0,
                "avg_sentence_len": None,
                "avg_paragraph_len": None,
                "per_post": [],
                "top_terms": [],
            }

        def _nums(key: str) -> list[float]:
            out = []
            for r in records:
                v = r.get(key)
                if isinstance(v, (int, float)):
                    out.append(float(v))
            return out

        sent = _nums("avg_sentence_len")
        para = _nums("avg_paragraph_len")

        # 每篇一个点，按时间正序，供前端画句长走势 sparkline。
        per_post = sorted(
            (
                {
                    "title": r.get("title") or Path(r.get("path", "")).stem,
                    "avg_sentence_len": r.get("avg_sentence_len"),
                    "avg_paragraph_len": r.get("avg_paragraph_len"),
                    "created_at": r.get("created_at", ""),
                }
                for r in records
            ),
            key=lambda x: x.get("created_at") or "",
        )

        # top_terms 跨篇聚合：统计每个词在多少篇里出现过 → 反复在用的词。
        term_posts: Counter[str] = Counter()
        for r in records:
            terms = r.get("top_terms")
            if isinstance(terms, list):
                for t in {str(x) for x in terms if x}:  # 同篇去重，按"出现篇数"计
                    term_posts[t] += 1
        top_terms = [{"term": t, "posts": c} for t, c in term_posts.most_common(28)]

        return {
            "count": len(records),
            "avg_sentence_len": round(sum(sent) / len(sent), 1) if sent else None,
            "avg_paragraph_len": round(sum(para) / len(para), 1) if para else None,
            "per_post": per_post,
            "top_terms": top_terms,
        }

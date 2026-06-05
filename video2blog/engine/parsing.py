"""纯函数：标题清洗 + Step 输出的解析/抽取（无 Engine 状态，便于单测与复用）。

从 runner.py 抽出（H2）。runner 仍 re-export 这些名字，保持 `from ...runner import X` 兼容。
依赖仅 stdlib + strip_frontmatter，绝不反向依赖 runner / Engine。
"""

from __future__ import annotations

import json
import re
from typing import Any

from video2blog.utils import strip_frontmatter


def clean_title(title: str) -> str:
    """清洗标题用于文件名：保留中文，去掉文件系统不安全字符与常见标点（与既有成品命名惯例对齐）。"""
    # 在原有不安全字符基础上补齐中英文标点（顿号、逗号、句号、感叹/问号、省略号、破折号、间隔号等）。
    bad_chars = r'/\\:*?"<>|：；“”‘’《》「」()、，。！？…—·.,!;'
    for c in bad_chars:
        title = title.replace(c, "")
    # 既有成品惯例：与中文相邻的空格直接去掉（“AI 时代” → “AI时代”），其余空格按英文 slug 转连字符。
    title = re.sub(r"(?<=[一-鿿])\s+|\s+(?=[一-鿿])", "", title)
    title = re.sub(r"\s+", "-", title)
    title = re.sub(r"-+", "-", title)
    return title.strip("-")


def parse_markdown_review(text: str) -> dict[str, Any]:
    """Parses a Markdown review sheet according to quality-check SKILL.md.

    Extracts verdict, scores, total, and rebrief.
    """
    # 1. Parse individual scores
    scores = {}
    dimensions = ["忠实度", "可读性", "观点密度", "风格一致", "完整性", "视角忠实度"]
    for dim in dimensions:
        dim_pattern = dim
        if dim == "风格一致":
            dim_pattern = "风格一致(?:性)?"
        match = re.search(rf"\|\s*({dim_pattern})\s*\|\s*(\d+)(?:\/\d+)?\s*\|", text)
        if match:
            scores[dim] = int(match.group(2))
        else:
            scores[dim] = 0

    # 2. Compute total score — 以合同里权威的「合计/总分」行为主，累加六维仅作兜底。
    summed_total = sum(scores.values())
    total_score = summed_total
    total_row = re.search(
        r"\|\s*\*{0,2}\s*(?:合计|总分|总计)\s*\*{0,2}\s*\|\s*\*{0,2}\s*(\d+)\s*/\s*60",
        text,
    )
    if total_row:
        total_score = int(total_row.group(1))

    # 解析失败硬 guard：六维全 0 且无合计行 → 说明 LLM 根本没按 quality-check 合同输出评分表，
    # 必须拒掉，绝不能 silent fallback 给 0/60，否则会被引擎当成"低分"误触发自修正。
    if all(v == 0 for v in scores.values()) and total_row is None:
        raise ValueError(
            "Step 7 LLM 输出未找到任何评分行或合计行（不符合 quality-check 合同输出格式）"
        )

    # 3. Parse verdict
    # Contract: "总分 >= 42 且 视角忠实度 > 5 为 PASS，否则为 REVIEW"
    # Also respects LLM's explicit "## 判定" in markdown if present
    verdict_markdown = "PASS"  # Default to PASS if ## 判定 is missing but scores pass
    verdict_match = re.search(r"##\s*判定\s*\n\s*(PASS|REVIEW)", text, re.IGNORECASE)
    if verdict_match:
        verdict_markdown = verdict_match.group(1).upper()

    perspective_score = scores.get("视角忠实度", 0)
    verdict = (
        "PASS"
        if (total_score >= 42 and perspective_score > 5 and verdict_markdown == "PASS")
        else "REVIEW"
    )

    # 4. Extract Re-Brief
    rebrief = ""
    rebrief_match = re.search(
        r"^#{2,6}\s*Re-Brief\s*\n(.*?)(?=\n\s*---\s*\n|\n#{1,6}\s*Step\s+\d+\b|\Z)",
        text,
        re.DOTALL | re.IGNORECASE | re.MULTILINE,
    )
    if rebrief_match:
        rebrief = rebrief_match.group(1).strip()
    else:
        # Fallback: take last few lines
        rebrief = text[-200:].strip()

    return {
        "verdict": verdict,
        "scores": scores,
        "total": f"{total_score}/60",
        "rebrief": rebrief,
        "raw_markdown": text,
    }


def render_quality_review_markdown(result: dict[str, Any]) -> str:
    """Render a normalized quality review JSON object into the legacy Markdown report."""
    scores = result.get("scores") if isinstance(result.get("scores"), dict) else {}
    rows = "\n".join(
        f"| {dim} | {scores.get(dim, 0)} | — |"
        for dim in ["忠实度", "可读性", "观点密度", "风格一致", "完整性", "视角忠实度"]
    )
    return (
        "## 评分\n"
        "| 维度 | 分 | 依据 |\n"
        "|---|---|---|\n"
        f"{rows}\n"
        f"| **合计** | **{result.get('total', '0/60')}** | — |\n\n"
        "## 判定\n"
        f"{result.get('verdict', 'REVIEW')}\n\n"
        "## Re-Brief\n"
        f"{result.get('rebrief', '')}"
    ).strip()


def parse_quality_json_review(text: str) -> dict[str, Any]:
    """Parse the preferred Step 7 JSON response and normalize it to review dict shape."""
    obj = extract_json_object(text)
    verdict = str(obj.get("verdict", "REVIEW")).upper()
    if verdict not in {"PASS", "REVIEW"}:
        verdict = "REVIEW"
    raw_scores = obj.get("scores") if isinstance(obj.get("scores"), dict) else {}
    scores: dict[str, int] = {}
    for dim in ["忠实度", "可读性", "观点密度", "风格一致", "完整性", "视角忠实度"]:
        aliases = [dim]
        if dim == "风格一致":
            aliases.append("风格一致性")
        value = next((raw_scores.get(alias) for alias in aliases if alias in raw_scores), 0)
        try:
            scores[dim] = max(0, min(10, int(value)))
        except (TypeError, ValueError):
            scores[dim] = 0
    if not any(scores.values()):
        raise ValueError("Step 7 JSON 输出缺少有效 scores")
    total_value = obj.get("total")
    if isinstance(total_value, str) and re.fullmatch(r"\d{1,2}/60", total_value.strip()):
        total_score = int(total_value.split("/", 1)[0])
    else:
        total_score = sum(scores.values())
    perspective_score = scores.get("视角忠实度", 0)
    normalized_verdict = (
        "PASS" if (total_score >= 42 and perspective_score > 5 and verdict == "PASS") else "REVIEW"
    )
    result = {
        "verdict": normalized_verdict,
        "scores": scores,
        "total": f"{total_score}/60",
        "rebrief": str(obj.get("rebrief") or obj.get("re_brief") or ""),
    }
    result["raw_markdown"] = render_quality_review_markdown(result)
    return result


def looks_like_json_mode_unsupported(exc: Exception) -> bool:
    """Return True when an OpenAI-compatible provider rejects response_format=json_object."""
    message = str(exc).lower()
    mentions_json_mode = any(
        marker in message
        for marker in ("response_format", "json_object", "json mode", "json schema")
    )
    provider_rejected_request = any(
        marker in message
        for marker in (
            "http 400",
            "unsupported",
            "not support",
            "invalid_request",
            "invalid parameter",
            "unknown parameter",
        )
    )
    return mentions_json_mode and provider_rejected_request


def extract_json_object(text: str) -> dict[str, Any]:
    """Robustly extracts and parses a JSON object from text (handling markdown wrappers)."""
    # Find ```json ... ``` code blocks
    json_match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if json_match:
        text_to_parse = json_match.group(1).strip()
    else:
        # Fallback: search for the first '{' and last '}'
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            text_to_parse = text[start : end + 1].strip()
        else:
            text_to_parse = text.strip()

    return json.loads(text_to_parse)


def strip_runtime_scaffold(text: str, expected_heading_pattern: str) -> str:
    """Drops model-invented Pre-Flight / Step chatter before a step's contracted output."""
    _, body = strip_frontmatter(text)
    normalized = body.replace("\r\n", "\n").replace("\r", "\n")
    match = re.search(expected_heading_pattern, normalized, re.MULTILINE)
    if match:
        normalized = normalized[match.start() :]
    return normalized.strip()


def extract_quality_review(text: str) -> str:
    """Extracts only the Step 7 quality report from an over-complete LLM response."""
    _, body = strip_frontmatter(text)
    lines = body.replace("\r\n", "\n").replace("\r", "\n").splitlines()

    for idx, line in enumerate(lines):
        if re.match(r"^\s*#{1,6}\s*Step\s+7\b", line, re.IGNORECASE):
            lines = lines[idx + 1 :]
            while lines and (not lines[0].strip() or lines[0].strip() in {"---", "***", "___"}):
                lines.pop(0)
            break
    else:
        joined = "\n".join(lines)
        score_match = re.search(r"^#{2,6}\s*评分\b", joined, re.MULTILINE)
        if score_match:
            lines = joined[score_match.start() :].splitlines()

    cut_at = len(lines)
    for idx, line in enumerate(lines):
        if re.match(r"^\s*#{1,6}\s*Step\s+8\b", line, re.IGNORECASE):
            cut_at = idx
            break
    lines = lines[:cut_at]
    while lines and (not lines[-1].strip() or lines[-1].strip() in {"---", "***", "___"}):
        lines.pop()
    return "\n".join(lines).strip()


def extract_markdown_section(text: str, heading: str) -> str:
    """Extract a section body under a level-2 heading, if present."""
    pattern = re.compile(
        rf"^##\s*{re.escape(heading)}\s*\n(.*?)(?=\n##\s+|\Z)",
        re.DOTALL | re.MULTILINE,
    )
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def combine_clean_chunks(chunks: list[str]) -> str:
    """Deterministically reduce Step 3 chunk outputs into one clean.md."""
    clean_parts: list[str] = []
    uncertain_items: list[str] = []
    for chunk in chunks:
        clean = extract_markdown_section(chunk, "清洗稿") or chunk.strip()
        uncertain = extract_markdown_section(chunk, "不确定清单")
        if clean:
            clean_parts.append(clean)
        for line in uncertain.splitlines():
            stripped = line.strip()
            if not stripped or stripped in {"- 无", "无"}:
                continue
            if stripped not in uncertain_items:
                uncertain_items.append(stripped)

    uncertain_block = "\n".join(uncertain_items) if uncertain_items else "- 无"
    return (
        "## 清洗稿\n\n"
        + "\n\n".join(clean_parts).strip()
        + "\n\n## 不确定清单\n"
        + uncertain_block
        + "\n"
    )


def extract_blog_body(text: str) -> str:
    """Extracts only the Step 6 blog body from a possibly over-complete LLM response."""
    _, body = strip_frontmatter(text)
    lines = body.replace("\r\n", "\n").replace("\r", "\n").splitlines()

    def is_step_heading(line: str, step_nums: tuple[int, ...] | None = None) -> bool:
        match = re.match(r"^\s*#{1,6}\s*Step\s+(\d+)\b", line, re.IGNORECASE)
        if not match:
            return False
        if step_nums is None:
            return True
        return int(match.group(1)) in step_nums

    # If the model returned a whole workflow transcript, keep only the Step 6 section.
    for idx, line in enumerate(lines):
        if is_step_heading(line, (6,)):
            lines = lines[idx + 1 :]
            while lines and (not lines[0].strip() or lines[0].strip() in {"---", "***", "___"}):
                lines.pop(0)
            break

    # Cut off review/output sections if they leaked after the article body.
    cut_at = len(lines)
    for idx, line in enumerate(lines):
        if is_step_heading(line, (7, 8)):
            cut_at = idx
            break
    lines = lines[:cut_at]

    # Drop Pre-Flight / routing chatter before the first real H1 title.
    first_content = next((line.strip() for line in lines if line.strip()), "")
    has_runtime_preamble = (
        "Pre-Flight" in first_content
        or first_content.startswith("> ENTRY")
        or first_content.startswith("ENTRY")
        or first_content.startswith("# Step")
    )
    if has_runtime_preamble:
        for idx, line in enumerate(lines):
            if re.match(r"^#\s+(?!Pre-Flight\b|Step\s+\d+\b).+", line.strip(), re.IGNORECASE):
                lines = lines[idx:]
                break

    cleaned = "\n".join(lines).strip()
    return cleaned


def validate_rewrite_output(text: str) -> None:
    """Fails closed when Step 6 output still contains workflow scaffolding."""
    if not text.strip():
        raise ValueError("Step 6 输出为空，拒绝进入质检。")
    if not re.search(r"^#\s+\S+", text, re.MULTILINE):
        raise ValueError("Step 6 输出缺少文章一级标题，拒绝进入质检。")
    forbidden_patterns = [
        r"^#\s*Pre-Flight\b",
        r"^>\s*Pre-Flight\b",
        r"^>\s*ENTRY\s*→",
        r"^#\s*Step\s+[3478]\b",
    ]
    for pattern in forbidden_patterns:
        if re.search(pattern, text, re.MULTILINE | re.IGNORECASE):
            raise ValueError(f"Step 6 输出仍包含运行过程痕迹: {pattern}")

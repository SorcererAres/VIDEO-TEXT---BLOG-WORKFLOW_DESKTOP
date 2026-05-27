#!/usr/bin/env python3
"""Video2Blog 引擎回归脚本。

用 mock LLM 在隔离的临时 repo 里跑指定 fixture，验证状态机、缓存键、frontmatter、
VIEWER_RE、HISTORY 与 fingerprints 等"确定性环节"不退化。

默认 mock 模式，确定性、零成本、可入 CI。--live 预留给手动跑真 LLM 的回归。

约定：
- fixture 目录在 `tests/fixtures/regression/<name>/`
- 每个 fixture 必须有 `fixture.yaml`、`source.md`、`expected/<step-name>.{md,json}`
- mock 通过 system_prompt 中的 `# <step-name>` 行（来自 SKILL.md body 首行）识别当前 step
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from video2blog.engine.runner import Engine  # noqa: E402
from video2blog.utils import VIEWER_RE, strip_frontmatter  # noqa: E402


# SKILL.md body 的首个一级标题，引擎拼进 system_prompt 后这行稳定可见。
# 顺序由长到短无所谓——marker 之间互不前缀。
STEP_MARKERS: list[tuple[str, str]] = [
    ("# clean-transcript", "clean-transcript"),
    ("# extract-insights", "extract-insights"),
    ("# structure-narrative", "structure-narrative"),
    ("# rewrite-blog", "rewrite-blog"),
    ("# quality-check", "quality-check"),
]


class MockLLMClient:
    """按 fixture/expected/*.{md,json} 路由的 mock LLM 客户端。

    与 video2blog.engine.client.LLMClient 接口兼容；
    引擎只用到 model / api_base / api_key / total_input_tokens / total_output_tokens /
    total_cost / call_api / check_budget，这里全实现。
    """

    def __init__(self, fixture_dir: Path) -> None:
        self.fixture_dir = Path(fixture_dir)
        self.model = "mock-regression"
        self.api_base = "mock://localhost"
        self.api_key = "mock-key"
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.calls: list[dict[str, Any]] = []

    @property
    def total_cost(self) -> float:
        return 0.0

    def check_budget(self, _text: str) -> None:
        return None

    def call_api(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = False,
        max_retries: int = 5,
        backoff_factor: float = 2.0,
    ) -> str:
        step = self._identify_step(system_prompt)
        if step is None:
            raise RuntimeError(
                "Mock 无法从 system_prompt 识别 step；"
                f"前 300 字：{system_prompt[:300]!r}"
            )
        ext = "json" if step == "quality-check" else "md"
        expected_path = self.fixture_dir / "expected" / f"{step}.{ext}"
        if not expected_path.exists():
            raise FileNotFoundError(
                f"fixture {self.fixture_dir.name} 缺少 expected/{step}.{ext}"
            )
        content = expected_path.read_text(encoding="utf-8")
        # 模拟 token 计数（按字符数粗略折算，方便调试看用量）
        self.total_input_tokens += len(system_prompt) + len(user_prompt)
        self.total_output_tokens += len(content)
        self.calls.append({"step": step, "json_mode": json_mode, "out_chars": len(content)})
        return content

    @staticmethod
    def _identify_step(system_prompt: str) -> str | None:
        for marker, step in STEP_MARKERS:
            if marker in system_prompt:
                return step
        return None


@dataclass
class RegressionResult:
    name: str
    ok: bool
    errors: list[str] = field(default_factory=list)
    mock_calls: list[dict[str, Any]] = field(default_factory=list)
    final_post_path: str | None = None
    pass_score: str | None = None


def setup_tmp_repo(source_repo: Path, tmp_root: Path) -> None:
    """在 tmp_root 搭一个最小可运行的引擎 repo。

    必须复制（不能 symlink，避免链接路径被引擎误当成 tmp 内文件污染源仓库）。
    """
    shutil.copy2(source_repo / "WORKFLOW.md", tmp_root / "WORKFLOW.md")
    shutil.copytree(source_repo / "knowledge", tmp_root / "knowledge")
    shutil.copytree(source_repo / ".cursor", tmp_root / ".cursor")

    mem = tmp_root / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    for name in ("PREFERENCES.md", "CONFIG.md", "HISTORY.md"):
        shutil.copy2(source_repo / "memory" / name, mem / name)
    # fingerprints 从空开始：让引擎 upsert 之后验证"本篇被记录"
    (mem / "fingerprints.jsonl").write_text("", encoding="utf-8")

    year = datetime.now().strftime("%Y")
    (tmp_root / "output" / "Posts" / year).mkdir(parents=True, exist_ok=True)
    (tmp_root / "output" / "Reviews").mkdir(parents=True, exist_ok=True)
    (tmp_root / "work").mkdir(parents=True, exist_ok=True)
    (tmp_root / "input" / "Text").mkdir(parents=True, exist_ok=True)


def run_fixture(
    fixture_dir: Path,
    source_repo: Path,
    *,
    verbose: bool = False,
) -> RegressionResult:
    meta = yaml.safe_load((fixture_dir / "fixture.yaml").read_text(encoding="utf-8"))
    name = meta["name"]
    result = RegressionResult(name=name, ok=False)

    with tempfile.TemporaryDirectory(prefix=f"v2b-regression-{name}-") as tmp:
        tmp_root = Path(tmp).resolve()
        setup_tmp_repo(source_repo, tmp_root)

        source_dst = tmp_root / "input" / "Text" / f"{name}.md"
        shutil.copy2(fixture_dir / "source.md", source_dst)

        client = MockLLMClient(fixture_dir)
        engine = Engine(repo_root=tmp_root, client=client)

        # 静音引擎 stdout，除非 verbose
        stdout_buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(stdout_buf):
                final_path = engine.run_job(
                    stem=name,
                    source_path=source_dst,
                    mode=meta["mode"],
                    routing=meta["routing"],
                    speaker=meta["speaker"],
                    max_retries=0,
                    pause_on_outline=bool(meta.get("pause_on_outline", False)),
                )
        except Exception as exc:
            result.errors.append(f"engine.run_job raised: {exc}")
            if verbose:
                print(stdout_buf.getvalue(), file=sys.stderr)
            return result

        if verbose:
            print(stdout_buf.getvalue())

        result.mock_calls = list(client.calls)

        # ── 验证 ─────────────────────────────────────────
        if final_path is None:
            result.errors.append("engine.run_job 返回 None（未产生成品）")
            return result

        state_path = tmp_root / "work" / name / ".state.json"
        if not state_path.exists():
            result.errors.append(f"缺少 state 文件: {state_path}")
            return result
        state = json.loads(state_path.read_text(encoding="utf-8"))

        expected_status = meta.get("expected_final_status", "FINISHED")
        if state.get("status") != expected_status:
            result.errors.append(
                f"状态机终态错误：expected {expected_status}，actual {state.get('status')}"
            )

        rel_final = state.get("final_post_path") or ""
        result.final_post_path = rel_final
        if not rel_final.startswith(f"output/Posts/"):
            result.errors.append(f"final_post_path 路径不规范：{rel_final}")

        post_abs = tmp_root / rel_final if rel_final else None
        if not post_abs or not post_abs.exists():
            result.errors.append(f"成品文件不存在：{rel_final}")
            return result

        post_text = post_abs.read_text(encoding="utf-8")
        fm, body = strip_frontmatter(post_text)

        required_fm = {"title", "date", "entry", "mode", "routing", "speaker", "source", "pass_score"}
        missing_fm = required_fm - set(fm)
        if missing_fm:
            result.errors.append(f"frontmatter 缺字段：{sorted(missing_fm)}")

        if fm.get("mode") != meta["mode"]:
            result.errors.append(f"frontmatter.mode 错：{fm.get('mode')} ≠ {meta['mode']}")
        if fm.get("routing") != meta["routing"]:
            result.errors.append(f"frontmatter.routing 错：{fm.get('routing')} ≠ {meta['routing']}")
        if fm.get("speaker") != meta["speaker"]:
            result.errors.append(f"frontmatter.speaker 错：{fm.get('speaker')} ≠ {meta['speaker']}")

        result.pass_score = fm.get("pass_score")
        expected_score = meta.get("expected_pass_score")
        if expected_score and fm.get("pass_score") != expected_score:
            result.errors.append(
                f"pass_score 错：{fm.get('pass_score')} ≠ {expected_score}"
            )

        if VIEWER_RE.search(body):
            match = VIEWER_RE.search(body)
            result.errors.append(f"正文含观看者视角词：{match.group(0)!r}")

        # Review
        review_rel = post_abs.stem
        if review_rel.startswith("DRAFT-"):
            review_rel = review_rel[len("DRAFT-"):]
        review_path = tmp_root / "output" / "Reviews" / f"{review_rel}.review.md"
        if not review_path.exists():
            result.errors.append(f"Review 文件不存在：{review_path.relative_to(tmp_root)}")
        else:
            review_text = review_path.read_text(encoding="utf-8")
            if "## 评分" not in review_text or "## Re-Brief" not in review_text:
                result.errors.append("Review 缺少 ## 评分 或 ## Re-Brief")

        # HISTORY
        history_text = (tmp_root / "memory" / "HISTORY.md").read_text(encoding="utf-8")
        if rel_final not in history_text:
            result.errors.append("HISTORY.md 未记录本篇成品路径")

        # Fingerprint（DRAFT 不更新指纹；非 DRAFT 必须有记录）
        if not post_abs.stem.startswith("DRAFT-"):
            fp_lines = (tmp_root / "memory" / "fingerprints.jsonl").read_text(encoding="utf-8").splitlines()
            fp_records = [json.loads(line) for line in fp_lines if line.strip()]
            if not any(r.get("path") == rel_final for r in fp_records):
                result.errors.append("fingerprints.jsonl 未记录本篇")

        # mock 调用次数
        expected_calls = {"quick": 2, "full": 5}.get(meta["mode"])
        if expected_calls and len(client.calls) != expected_calls:
            result.errors.append(
                f"mock 调用次数错：expected {expected_calls}，actual {len(client.calls)}"
            )

    result.ok = not result.errors
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Video2Blog 引擎回归脚本：用 mock LLM 验证确定性环节不退化"
    )
    parser.add_argument(
        "--fixture",
        action="append",
        default=None,
        help="只跑指定 fixture 名（可重复）；省略则跑所有",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=REPO_ROOT,
        help="repo 根（默认 scripts/ 的上一级）",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="输出引擎日志")
    parser.add_argument(
        "--live",
        action="store_true",
        help="（预留）真调 LLM 跑回归，目前未实现",
    )
    args = parser.parse_args(argv)

    if args.live:
        print("--live 暂未实现；请用默认 mock 模式", file=sys.stderr)
        return 2

    fixtures_root = args.repo / "tests" / "fixtures" / "regression"
    if not fixtures_root.is_dir():
        print(f"未找到 fixtures 目录：{fixtures_root}", file=sys.stderr)
        return 2

    fixtures = sorted(
        p for p in fixtures_root.iterdir()
        if p.is_dir() and (p / "fixture.yaml").exists()
    )
    if args.fixture:
        wanted = set(args.fixture)
        fixtures = [f for f in fixtures if f.name in wanted]
        if not fixtures:
            print(f"未找到匹配的 fixture：{args.fixture}", file=sys.stderr)
            return 2

    print(f"跑 {len(fixtures)} 个 fixture（mock 模式）...\n")
    failures: list[RegressionResult] = []
    for fixture in fixtures:
        result = run_fixture(fixture, args.repo, verbose=args.verbose)
        marker = "PASS" if result.ok else "FAIL"
        score = f" score={result.pass_score}" if result.pass_score else ""
        print(f"[{marker}] {result.name}{score} mock_calls={len(result.mock_calls)}")
        if not result.ok:
            for err in result.errors:
                print(f"        - {err}")
            failures.append(result)

    if failures:
        print(f"\n{len(failures)} / {len(fixtures)} fixture FAIL")
        return 1
    print(f"\n{len(fixtures)} / {len(fixtures)} fixture PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

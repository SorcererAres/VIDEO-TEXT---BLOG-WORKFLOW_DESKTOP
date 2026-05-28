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

    路由规则：
      Step 3-5：按 SKILL marker 单文件路由 expected/<step>.md。
      Step 7：按"本 step 调用第几次"路由——
        - 第 1 次 → expected/quality-check.json
        - 第 N>1 次 → expected/quality-check-v{N}.json
        覆盖自修正闭环（v1 REVIEW → v2 PASS）等多轮场景。
      Step 6 (rewrite-blog)：先看 user_prompt 是否含"### 本节任务"——
        - 含「导语」→ expected/rewrite-blog-intro.md
        - 含「收尾」→ expected/rewrite-blog-outro.md
        - 含「正文一节」→ expected/rewrite-blog-body-{已见次数:02d}.md
        - 都不含（一次性整篇路径）：
          · 第 1 次 → expected/rewrite-blog.md
          · 第 N>1 次 → expected/rewrite-blog-v{N}.md
    """

    def __init__(self, fixture_dir: Path) -> None:
        self.fixture_dir = Path(fixture_dir)
        self.model = "mock-regression"
        self.api_base = "mock://localhost"
        self.api_key = "mock-key"
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.calls: list[dict[str, Any]] = []
        self._body_section_counter = 0  # rewrite-blog body-* 调用计数（按出现顺序映射 fixture）
        # 自修正等多轮场景下，同一 step 第 N 次调用映射到 -v{N} 后缀的 expected 文件。
        # quality-check 总用这条路径；rewrite-blog 只在"一次性整篇"路径（非按节）下用。
        self._versioned_step_counts: dict[str, int] = {}

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

        if step == "rewrite-blog":
            section_kind = self._identify_section_kind(user_prompt)
            if section_kind == "intro":
                fname = "rewrite-blog-intro.md"
            elif section_kind == "outro":
                fname = "rewrite-blog-outro.md"
            elif section_kind == "body":
                fname = f"rewrite-blog-body-{self._body_section_counter:02d}.md"
                self._body_section_counter += 1
            else:
                # 一次性整篇路径：第 1 次走基名，后续按 -v{N} 路由（覆盖自修正第 2 轮）
                fname = self._versioned_filename("rewrite-blog", "md")
        elif step == "quality-check":
            # 自修正闭环里 Step 7 会被多次调用，每轮 verdict 可能不同，按 -v{N} 路由
            fname = self._versioned_filename("quality-check", "json")
        else:
            # Step 3-5：理论上单 job 只调一次，超过 1 次仍按 -v{N} 路由，便于扩展
            fname = self._versioned_filename(step, "md")

        expected_path = self.fixture_dir / "expected" / fname
        if not expected_path.exists():
            raise FileNotFoundError(
                f"fixture {self.fixture_dir.name} 缺少 expected/{fname}"
            )
        content = expected_path.read_text(encoding="utf-8")
        self.total_input_tokens += len(system_prompt) + len(user_prompt)
        self.total_output_tokens += len(content)
        self.calls.append(
            {
                "step": step,
                "section_kind": self._identify_section_kind(user_prompt) if step == "rewrite-blog" else None,
                "fixture_file": fname,
                "json_mode": json_mode,
                "out_chars": len(content),
            }
        )
        return content

    def _versioned_filename(self, step: str, ext: str) -> str:
        """递增计数器，返回第 N 次调用对应的 expected 文件名。

        N==1 → "{step}.{ext}"；N>1 → "{step}-v{N}.{ext}"。
        """
        n = self._versioned_step_counts.get(step, 0) + 1
        self._versioned_step_counts[step] = n
        if n == 1:
            return f"{step}.{ext}"
        return f"{step}-v{n}.{ext}"

    @staticmethod
    def _identify_step(system_prompt: str) -> str | None:
        for marker, step in STEP_MARKERS:
            if marker in system_prompt:
                return step
        return None

    @staticmethod
    def _identify_section_kind(user_prompt: str) -> str | None:
        """识别"按节滚动"模式下 rewrite-blog 的本节 kind。

        与 runner._build_section_task 的指令文本耦合 —— 它若改，这里也得跟。
        """
        if "### 本节任务（导语" in user_prompt:
            return "intro"
        if "### 本节任务（收尾" in user_prompt:
            return "outro"
        if "### 本节任务（正文一节）" in user_prompt:
            return "body"
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
        rewrite_strategy = meta.get("rewrite_strategy", "single")
        engine = Engine(
            repo_root=tmp_root,
            client=client,
            rewrite_strategy=rewrite_strategy,
        )

        # 静音引擎 stdout，除非 verbose
        stdout_buf = io.StringIO()
        max_retries = int(meta.get("max_retries", 0))
        try:
            with contextlib.redirect_stdout(stdout_buf):
                final_path = engine.run_job(
                    stem=name,
                    source_path=source_dst,
                    mode=meta["mode"],
                    routing=meta["routing"],
                    speaker=meta["speaker"],
                    max_retries=max_retries,
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
        expected_status = meta.get("expected_final_status", "FINISHED")
        # paused 终态（WAITING_USER_REVIEW / WAITING_USER_OUTLINE）下 run_job 合法返回 None，
        # 引擎只把中间产物落盘并等待人工——这是 §9-B 设计。
        paused_terminal = expected_status.startswith("WAITING_USER_")

        if final_path is None and not paused_terminal:
            result.errors.append("engine.run_job 返回 None（未产生成品）")
            return result
        if final_path is not None and paused_terminal:
            result.errors.append(
                f"预期 {expected_status} 但 run_job 仍产出成品 {final_path}"
            )
            return result

        state_path = tmp_root / "work" / name / ".state.json"
        if not state_path.exists():
            result.errors.append(f"缺少 state 文件: {state_path}")
            return result
        state = json.loads(state_path.read_text(encoding="utf-8"))

        if state.get("status") != expected_status:
            result.errors.append(
                f"状态机终态错误：expected {expected_status}，actual {state.get('status')}"
            )

        if paused_terminal:
            # paused 终态校验：work/<stem>/draft_v{best}.md + review_v{best}.json 必须存在；
            # final_post_path 应为空，HISTORY / fingerprints 不该被更新。
            best_ver = state.get("best_version", state.get("version", 1))
            draft_path = tmp_root / "work" / name / f"draft_v{best_ver}.md"
            review_json = tmp_root / "work" / name / f"review_v{best_ver}.json"
            if not draft_path.exists():
                result.errors.append(f"paused 下应有 work/{name}/draft_v{best_ver}.md")
            if not review_json.exists():
                result.errors.append(f"paused 下应有 work/{name}/review_v{best_ver}.json")
            if state.get("final_post_path"):
                result.errors.append(
                    f"paused 终态不该有 final_post_path：{state.get('final_post_path')}"
                )

            if review_json.exists():
                review_data = json.loads(review_json.read_text(encoding="utf-8"))
                result.pass_score = review_data.get("total")
                expected_score = meta.get("expected_pass_score")
                if expected_score and result.pass_score != expected_score:
                    result.errors.append(
                        f"pass_score 错：{result.pass_score} ≠ {expected_score}"
                    )
                # 解析失败标记（parse_failed=True 走的"跳过自修正、直接转人工"路径）
                if meta.get("expect_parse_failed") and not review_data.get("parse_failed"):
                    result.errors.append(
                        "fixture 期望 parse_failed=True，但 review json 没标记"
                    )

            # paused 终态不该污染人类索引 / 机器指纹（Step 8 没跑）
            history_text = (tmp_root / "memory" / "HISTORY.md").read_text(encoding="utf-8")
            for line in history_text.splitlines():
                if line.startswith("|") and name in line and "日期" not in line:
                    result.errors.append(
                        f"paused 终态不该把任务写进 HISTORY.md: {line.strip()[:80]}"
                    )
            fp_text = (tmp_root / "memory" / "fingerprints.jsonl").read_text(encoding="utf-8")
            for fp_line in fp_text.splitlines():
                if not fp_line.strip():
                    continue
                try:
                    fp_obj = json.loads(fp_line)
                except json.JSONDecodeError:
                    continue
                if name in (fp_obj.get("path") or ""):
                    result.errors.append(
                        f"paused 终态不该写 fingerprints.jsonl: {fp_obj.get('path')}"
                    )
        else:
            # FINISHED 路径：完整产物链路 + frontmatter + Review + HISTORY + fingerprint
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

        # mock 调用次数。fixture.yaml 显式指定 expected_total_mock_calls 时优先；
        # 否则按 mode 默认（quick=2, full single=5）兜底。
        expected_calls = meta.get(
            "expected_total_mock_calls",
            {"quick": 2, "full": 5}.get(meta["mode"]),
        )
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

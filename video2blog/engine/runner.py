"""StepRunner and State Machine coordinator for the Video2Blog workflow engine."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
import yaml

from video2blog.engine.chunking import TextChunk, chunk_prompt, split_text_chunks
from video2blog.engine.client import LLMClient
from video2blog.engine.outline import OutlineSections, parse_outline_sections
from video2blog.engine.parser import ContextLoader
from video2blog.engine.utils import atomic_write
from video2blog.utils import VIEWER_RE, strip_frontmatter

# H2：纯解析/文本 helper 已抽到 engine/parsing.py；此处 re-export 保持兼容（含 tests 的 import）。
from video2blog.engine.parsing import (
    clean_title,
    combine_clean_chunks,
    extract_blog_body,
    extract_json_object,
    extract_markdown_section,
    extract_quality_review,
    looks_like_json_mode_unsupported,
    parse_markdown_review,
    parse_quality_json_review,
    render_quality_review_markdown,
    strip_runtime_scaffold,
    validate_rewrite_output,
)

VALID_REWRITE_STRATEGIES = {"single", "sectioned"}

# Try importing fingerprint generation from scripts if available in python path
try:
    from scripts.update_fingerprint import fingerprint, upsert_jsonl
except ImportError:
    fingerprint = None
    upsert_jsonl = None


def _label_step_num(step_label: str) -> int | None:
    """从 "Step 5" 这类标签里抽出步骤号，供结构化进度事件用；抽不出返回 None。"""
    m = re.search(r"Step\s+(\d+)", step_label)
    return int(m.group(1)) if m else None


class Engine:
    """Drives the step-based workflow pipeline from raw ASR input to final blog posts."""

    def __init__(
        self,
        repo_root: Path | str,
        client: LLMClient,
        chunk_char_limit: int | None = None,
        chunk_context_chars: int | None = None,
        cancel_check: Callable[[], bool] | None = None,
        rewrite_strategy: str | None = None,
        emit_event: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.client = client
        self.loader = ContextLoader(self.repo_root)
        self.chunk_char_limit = chunk_char_limit or int(os.environ.get("VIDEO2BLOG_CHUNK_CHAR_LIMIT", "30000"))
        self.chunk_context_chars = chunk_context_chars or int(os.environ.get("VIDEO2BLOG_CHUNK_CONTEXT_CHARS", "1200"))
        self.cancel_check = cancel_check
        # 结构化进度事件回调（外壳层注入）。CLI / 无回调时为 None，引擎静默退化为纯 print。
        self._emit_event = emit_event
        strategy = (rewrite_strategy or os.environ.get("VIDEO2BLOG_REWRITE_STRATEGY", "single")).strip().lower()
        if strategy not in VALID_REWRITE_STRATEGIES:
            raise ValueError(
                f"未知 rewrite_strategy: {strategy!r}，可选 {sorted(VALID_REWRITE_STRATEGIES)}"
            )
        self.rewrite_strategy = strategy

    def _check_cancelled(self) -> None:
        if self.cancel_check and self.cancel_check():
            raise RuntimeError("任务被用户手动中断")

    def _progress(self, kind: str, **fields: Any) -> None:
        """发一条结构化进度事件给外壳层（server → SSE → 前端叙事）。

        设计要点：每个 _progress 都紧挨着一条人类可读的 print —— print 给人看
        （CLI / 原始日志面板），_progress 给机器用（前端结构化叙事 + StepProgress）。
        语义字段（kind/step/verdict…）由后端拥有，展示文案（"撰写博文草稿"）由前端拥有。
        无回调（CLI 直跑）时静默退化；事件本身尽力而为，绝不让外壳层异常拖垮主流程。
        """
        if self._emit_event is None:
            return
        payload: dict[str, Any] = {"kind": kind}
        payload.update({k: v for k, v in fields.items() if v is not None})
        try:
            self._emit_event("progress", payload)
        except Exception:
            pass

    def calculate_contract_fingerprint(self) -> str:
        """Calculates a fingerprint (sha256 hash) of all contract documents and skills."""
        h = hashlib.sha256()
        files = [
            self.repo_root / "WORKFLOW.md",
            self.repo_root / "knowledge/STYLE_GUIDE.md",
            self.repo_root / "memory/PREFERENCES.md",
        ]
        # Include all skill files
        skills_dir = self.repo_root / ".cursor/skills/video2blog"
        if skills_dir.exists():
            for f in sorted(skills_dir.glob("**/SKILL.md")):
                files.append(f)
        # Include few-shot examples (合同的一部分；改动范文应使缓存失效)。
        # 注意：不纳入 memory/fingerprints.jsonl —— 它每出一篇都会变，纳入会让缓存永远失效。
        examples_dir = self.repo_root / "knowledge/Examples"
        if examples_dir.exists():
            for f in sorted(examples_dir.glob("*.md")):
                if f.name.lower() == "readme.md":
                    continue
                files.append(f)
        for fp in files:
            if fp.exists():
                h.update(fp.read_bytes())
        return h.hexdigest()[:16]

    def load_state(self, stem: str) -> dict[str, Any]:
        """Loads the current execution state for a given job stem."""
        state_path = self.repo_root / "work" / stem / ".state.json"
        if state_path.exists():
            try:
                return json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {
            "stem": stem,
            "status": "PENDING",
            "mode": "quick",
            "version": 1,
            "variables": {},
            "history": [],
            "checked_results": [],
            "cache": {},
        }

    def save_state(self, stem: str, state: dict[str, Any]) -> None:
        """Atomically saves the current execution state."""
        state_path = self.repo_root / "work" / stem / ".state.json"
        content = json.dumps(state, ensure_ascii=False, indent=2)
        atomic_write(state_path, content)

    def _hash_text(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

    def _run_content_step(
        self,
        *,
        stem: str,
        state: dict[str, Any],
        status_name: str,
        step_name: str,
        step_label: str,
        input_text: str,
        output_path: Path,
        next_status: str,
        contract_fingerprint: str,
        include_examples: bool,
        expected_heading_pattern: str | None = None,
    ) -> str:
        """Runs one deterministic content-producing LLM step with disk cache."""
        self._check_cancelled()
        print(f"[+] [{step_label}] 正在生成 {output_path.name}...", flush=True)
        self._progress("step", step=_label_step_num(step_label))
        cache_key = status_name
        cached_meta = state.get("cache", {}).get(cache_key)
        current_cache_meta = {
            "input_hash": self._hash_text(input_text),
            "model": self.client.model,
            "contract_fingerprint": contract_fingerprint,
        }
        cache_hit = (
            cached_meta is not None
            and cached_meta.get("input_hash") == current_cache_meta["input_hash"]
            and cached_meta.get("model") == self.client.model
            and cached_meta.get("contract_fingerprint") == contract_fingerprint
            and output_path.exists()
        )

        if cache_hit and not state.get("force_retry", False):
            print(f"    -> 发现已有 {output_path.name}，跳过 API 请求 (缓存命中)。", flush=True)
            content = output_path.read_text(encoding="utf-8")
        else:
            system_prompt, user_prompt = self.loader.assemble_prompt(
                step_name=step_name,
                variables=state["variables"],
                raw_input=input_text,
                include_examples=include_examples,
            )
            content = self.client.call_api(system_prompt, user_prompt)
            atomic_write(output_path, content)
            state.setdefault("cache", {})[cache_key] = current_cache_meta

        if expected_heading_pattern:
            cleaned_content = strip_runtime_scaffold(content, expected_heading_pattern)
            if cleaned_content != content:
                print(f"    -> 已清理 {output_path.name} 中的运行过程痕迹。", flush=True)
                atomic_write(output_path, cleaned_content)
                content = cleaned_content

        history_entry = {
            "step": status_name,
            "path": str(output_path.relative_to(self.repo_root)),
            "timestamp": datetime.now().isoformat(),
        }
        state["history"] = [
            h
            for h in state.get("history", [])
            if not (h.get("step") == status_name and h.get("path") == history_entry["path"])
        ]
        state["history"].append(history_entry)
        state["status"] = next_status
        state["force_retry"] = False
        self.save_state(stem, state)
        return content

    def _record_content_step(
        self,
        *,
        stem: str,
        state: dict[str, Any],
        status_name: str,
        output_path: Path,
        next_status: str,
    ) -> None:
        history_entry = {
            "step": status_name,
            "path": str(output_path.relative_to(self.repo_root)),
            "timestamp": datetime.now().isoformat(),
        }
        state["history"] = [
            h
            for h in state.get("history", [])
            if not (h.get("step") == status_name and h.get("path") == history_entry["path"])
        ]
        state["history"].append(history_entry)
        state["status"] = next_status
        state["force_retry"] = False
        self.save_state(stem, state)

    def _run_chunked_clean_step(
        self,
        *,
        stem: str,
        state: dict[str, Any],
        input_text: str,
        output_path: Path,
        contract_fingerprint: str,
    ) -> str:
        """Runs Step 3 as chunked map plus deterministic reduce."""
        self._check_cancelled()
        chunks = split_text_chunks(input_text, self.chunk_char_limit, self.chunk_context_chars)
        if len(chunks) <= 1:
            return self._run_content_step(
                stem=stem,
                state=state,
                status_name="CLEANING",
                step_name="clean-transcript",
                step_label="Step 3",
                input_text=input_text,
                output_path=output_path,
                next_status="EXTRACTING",
                contract_fingerprint=contract_fingerprint,
                include_examples=False,
                expected_heading_pattern=r"^##\s*清洗稿\b",
            )

        print(f"[+] [Step 3] 输入较长，启动分块清洗 ({len(chunks)} chunks)...", flush=True)
        self._progress("step", step=3, chunks=len(chunks))
        cache_key = "CLEANING"
        current_cache_meta = {
            "input_hash": self._hash_text(input_text),
            "model": self.client.model,
            "contract_fingerprint": contract_fingerprint,
            "chunk_count": len(chunks),
            "chunk_char_limit": self.chunk_char_limit,
            "chunk_context_chars": self.chunk_context_chars,
        }
        cached_meta = state.get("cache", {}).get(cache_key)
        cache_hit = (
            cached_meta is not None
            and all(cached_meta.get(k) == v for k, v in current_cache_meta.items())
            and output_path.exists()
        )
        if cache_hit and not state.get("force_retry", False):
            print("    -> 发现已有 clean.md，跳过分块清洗 (缓存命中)。", flush=True)
            content = output_path.read_text(encoding="utf-8")
            self._record_content_step(
                stem=stem,
                state=state,
                status_name="CLEANING",
                output_path=output_path,
                next_status="EXTRACTING",
            )
            return content

        chunk_dir = output_path.parent / "chunks" / "clean"
        chunk_outputs: list[str] = []
        for chunk in chunks:
            self._check_cancelled()
            chunk_path = chunk_dir / f"chunk_{chunk.index:04d}.md"
            chunk_cache_key = f"CLEANING_chunk_{chunk.index:04d}"
            chunk_input = chunk_prompt(chunk, "Step 3 clean-transcript")
            chunk_meta = {
                "input_hash": self._hash_text(chunk_input),
                "model": self.client.model,
                "contract_fingerprint": contract_fingerprint,
            }
            cached_chunk_meta = state.get("cache", {}).get(chunk_cache_key)
            if (
                cached_chunk_meta is not None
                and cached_chunk_meta == chunk_meta
                and chunk_path.exists()
                and not state.get("force_retry", False)
            ):
                print(f"    -> clean chunk {chunk.index}/{chunk.total} 缓存命中。", flush=True)
                chunk_content = chunk_path.read_text(encoding="utf-8")
            else:
                print(f"    -> clean chunk {chunk.index}/{chunk.total} 调用 LLM...", flush=True)
                system_prompt, user_prompt = self.loader.assemble_prompt(
                    step_name="clean-transcript",
                    variables=state["variables"],
                    raw_input=chunk_input,
                    include_examples=False,
                )
                chunk_content = self.client.call_api(system_prompt, user_prompt)
                chunk_content = strip_runtime_scaffold(chunk_content, r"^##\s*清洗稿\b")
                atomic_write(chunk_path, chunk_content)
                state.setdefault("cache", {})[chunk_cache_key] = chunk_meta
                self.save_state(stem, state)
            chunk_outputs.append(chunk_content)

        content = combine_clean_chunks(chunk_outputs)
        atomic_write(output_path, content)
        state.setdefault("cache", {})[cache_key] = current_cache_meta
        self._record_content_step(
            stem=stem,
            state=state,
            status_name="CLEANING",
            output_path=output_path,
            next_status="EXTRACTING",
        )
        return content

    def _run_chunked_extract_step(
        self,
        *,
        stem: str,
        state: dict[str, Any],
        input_text: str,
        output_path: Path,
        contract_fingerprint: str,
        source_chunk_dir: Path | None = None,
    ) -> str:
        """Runs Step 4 as chunked extraction maps plus LLM reduce."""
        self._check_cancelled()
        source_chunk_paths = sorted(source_chunk_dir.glob("chunk_*.md")) if source_chunk_dir and source_chunk_dir.exists() else []
        if len(source_chunk_paths) > 1:
            source_texts = [path.read_text(encoding="utf-8") for path in source_chunk_paths]
            chunks = [
                TextChunk(
                    index=idx,
                    total=len(source_texts),
                    text=text,
                    previous_context=source_texts[idx - 2][-self.chunk_context_chars :] if idx > 1 else "",
                )
                for idx, text in enumerate(source_texts, start=1)
            ]
            input_fingerprint_text = "\n\n".join(source_texts)
            chunk_source = "clean_chunks"
        else:
            chunks = split_text_chunks(input_text, self.chunk_char_limit, self.chunk_context_chars)
            input_fingerprint_text = input_text
            chunk_source = "resplit_clean"
        if len(chunks) <= 1:
            return self._run_content_step(
                stem=stem,
                state=state,
                status_name="EXTRACTING",
                step_name="extract-insights",
                step_label="Step 4",
                input_text=input_text,
                output_path=output_path,
                next_status="STRUCTURING",
                contract_fingerprint=contract_fingerprint,
                include_examples=False,
                expected_heading_pattern=r"^##\s*核心观点\b",
            )

        print(f"[+] [Step 4] 清洗稿较长，启动分块提炼 ({len(chunks)} chunks)...", flush=True)
        self._progress("step", step=4, chunks=len(chunks))
        cache_key = "EXTRACTING"
        current_cache_meta = {
            "input_hash": self._hash_text(input_fingerprint_text),
            "model": self.client.model,
            "contract_fingerprint": contract_fingerprint,
            "chunk_count": len(chunks),
            "chunk_char_limit": self.chunk_char_limit,
            "chunk_context_chars": self.chunk_context_chars,
            "chunk_source": chunk_source,
        }
        cached_meta = state.get("cache", {}).get(cache_key)
        cache_hit = (
            cached_meta is not None
            and all(cached_meta.get(k) == v for k, v in current_cache_meta.items())
            and output_path.exists()
        )
        if cache_hit and not state.get("force_retry", False):
            print("    -> 发现已有 insights.md，跳过分块提炼 (缓存命中)。", flush=True)
            content = output_path.read_text(encoding="utf-8")
            self._record_content_step(
                stem=stem,
                state=state,
                status_name="EXTRACTING",
                output_path=output_path,
                next_status="STRUCTURING",
            )
            return content

        chunk_dir = output_path.parent / "chunks" / "insights"
        chunk_outputs: list[str] = []
        for chunk in chunks:
            self._check_cancelled()
            chunk_path = chunk_dir / f"chunk_{chunk.index:04d}.md"
            chunk_cache_key = f"EXTRACTING_chunk_{chunk.index:04d}"
            chunk_input = chunk_prompt(chunk, "Step 4 extract-insights")
            chunk_meta = {
                "input_hash": self._hash_text(chunk_input),
                "model": self.client.model,
                "contract_fingerprint": contract_fingerprint,
            }
            cached_chunk_meta = state.get("cache", {}).get(chunk_cache_key)
            if (
                cached_chunk_meta is not None
                and cached_chunk_meta == chunk_meta
                and chunk_path.exists()
                and not state.get("force_retry", False)
            ):
                print(f"    -> insights chunk {chunk.index}/{chunk.total} 缓存命中。", flush=True)
                chunk_content = chunk_path.read_text(encoding="utf-8")
            else:
                print(f"    -> insights chunk {chunk.index}/{chunk.total} 调用 LLM...", flush=True)
                system_prompt, user_prompt = self.loader.assemble_prompt(
                    step_name="extract-insights",
                    variables=state["variables"],
                    raw_input=chunk_input,
                    include_examples=False,
                )
                chunk_content = self.client.call_api(system_prompt, user_prompt)
                chunk_content = strip_runtime_scaffold(chunk_content, r"^##\s*核心观点\b")
                atomic_write(chunk_path, chunk_content)
                state.setdefault("cache", {})[chunk_cache_key] = chunk_meta
                self.save_state(stem, state)
            chunk_outputs.append(chunk_content)

        reduce_input = (
            "### 分块提要合并任务\n"
            "下面是同一篇清洗稿按顺序分块提炼出的提要。请去重、合并、按全局重要性排序，"
            "只输出 Step 4 合同要求的 Markdown 结构，不要写正文，不要输出 Pre-Flight 或 Step 说明。\n\n"
            + "\n\n".join(
                f"### 分块 {idx}/{len(chunk_outputs)} 提要\n{content}"
                for idx, content in enumerate(chunk_outputs, start=1)
            )
        )
        system_prompt, user_prompt = self.loader.assemble_prompt(
            step_name="extract-insights",
            variables=state["variables"],
            raw_input=reduce_input,
            include_examples=False,
        )
        content = self.client.call_api(system_prompt, user_prompt)
        content = strip_runtime_scaffold(content, r"^##\s*核心观点\b")
        atomic_write(output_path, content)
        state.setdefault("cache", {})[cache_key] = current_cache_meta
        self._record_content_step(
            stem=stem,
            state=state,
            status_name="EXTRACTING",
            output_path=output_path,
            next_status="STRUCTURING",
        )
        return content

    # ─── §9-C 按节滚动改写 ──────────────────────────────────────────────────

    @staticmethod
    def _build_section_plan(
        sections: OutlineSections,
    ) -> list[tuple[str, str, str]]:
        """返回有序 [(kind, heading, brief), ...] —— 含 intro / body-N / outro。

        intro / outro 的 brief 为空时跳过，确保短稿不被强制塞导语/收尾节。
        """
        plan: list[tuple[str, str, str]] = []
        if sections.intro:
            plan.append(("intro", "导语", sections.intro))
        for idx, body in enumerate(sections.body):
            plan.append((f"body-{idx:02d}", body.heading, body.brief))
        if sections.outro:
            plan.append(("outro", "收尾", sections.outro))
        return plan

    @staticmethod
    def _build_section_task(
        *, kind: str, heading: str, brief: str,
        clean_text: str, insights_text: str,
    ) -> str:
        """组装"本节任务"的 user-prompt raw_input。

        每节都附带 clean / insights 全文供查证，但通过明确指令把 LLM 的
        输出范围限制在本节——不写其他节、不写一级总标题（intro 除外）。
        """
        if kind == "intro":
            task = (
                "### 本节任务（导语 + 文章总标题）\n"
                "请只输出文章总标题与导语段落，**不要**输出任何 `## 二级小标题`、其他节内容或收尾段。\n"
                "- 第一行：`# <文章总标题>`（从骨架的标题候选中选最贴的一条，可微调用词）\n"
                "- 紧接：开场段落，承载骨架描述\n\n"
                f"骨架描述：{brief}"
            )
        elif kind == "outro":
            task = (
                "### 本节任务（收尾段）\n"
                "请只输出收尾段落。**不要**输出 `## 小标题`、不要重述其他节已写过的具体例子、"
                "不要重新写文章总标题。\n\n"
                f"骨架描述：{brief}"
            )
        else:
            task = (
                "### 本节任务（正文一节）\n"
                f"请只输出本节，以 `{heading}` 行作为节起点，下面跟若干段落。\n"
                "**不要**输出文章总标题（`# `）、其他节的 `## `、收尾段。\n\n"
                f"骨架描述：{brief}"
            )

        return (
            "### Step 3 清洗稿（供查证细节，禁止照抄整段）\n"
            f"{clean_text}\n\n"
            "### Step 4 提要\n"
            f"{insights_text}\n\n"
            f"{task}"
        )

    @staticmethod
    def _clean_section_output(content: str) -> str:
        """剥掉单节输出可能携带的 frontmatter / Pre-Flight / Step 标题脚手架。"""
        _, body = strip_frontmatter(content)
        lines = body.replace("\r\n", "\n").replace("\r", "\n").splitlines()
        drop_prefixes = ("> Pre-Flight", "> ENTRY", "> MODE", "> ROUTING", "> SOURCE", "> SPEAKER", "> STYLE")
        # 顶部连续的 Pre-Flight 引用块 + Step 标题行先剥掉
        while lines and (
            not lines[0].strip()
            or lines[0].strip().startswith(drop_prefixes)
            or re.match(r"^#{1,6}\s*Step\s+\d+\b", lines[0].strip(), re.IGNORECASE)
        ):
            lines.pop(0)
        # 末尾空行剥掉
        while lines and not lines[-1].strip():
            lines.pop()
        return "\n".join(lines).strip()

    def _run_rewrite_sectioned(
        self,
        *,
        stem: str,
        state: dict[str, Any],
        work_dir: Path,
        clean_text: str,
        insights_text: str,
        outline_text: str,
        sections: OutlineSections,
        contract_fingerprint: str,
        version: int,
    ) -> str:
        """按节滚动调用 LLM，最终合并成整篇 draft。每节独立缓存键。"""
        plan = self._build_section_plan(sections)
        section_dir = work_dir / "chunks" / "rewrite" / f"v{version}"
        section_dir.mkdir(parents=True, exist_ok=True)

        parts: list[str] = []
        prev_tail: str = ""  # 上一节末段（最后 400 字承上启下）

        for kind, heading, brief in plan:
            self._check_cancelled()
            section_path = section_dir / f"{kind}.md"
            cache_key = f"REWRITING_v{version}_{kind}"

            section_task = self._build_section_task(
                kind=kind, heading=heading, brief=brief,
                clean_text=clean_text, insights_text=insights_text,
            )
            current_cache_meta = {
                "input_hash": self._hash_text(section_task + "\n---prev---\n" + prev_tail),
                "model": self.client.model,
                "contract_fingerprint": contract_fingerprint,
                "outline_hash": self._hash_text(outline_text),
            }
            cached_meta = state.get("cache", {}).get(cache_key)
            cache_hit = (
                cached_meta is not None
                and all(cached_meta.get(k) == v for k, v in current_cache_meta.items())
                and section_path.exists()
            )

            if cache_hit and not state.get("force_retry", False):
                print(f"    -> rewrite section {kind} 缓存命中。", flush=True)
                content = section_path.read_text(encoding="utf-8")
            else:
                print(f"    -> rewrite section {kind} ({heading}) 调用 LLM...", flush=True)
                system_prompt, user_prompt = self.loader.assemble_prompt(
                    step_name="rewrite-blog",
                    variables=state["variables"],
                    raw_input=section_task,
                    prev_written_section=prev_tail or None,
                    global_outline=outline_text,
                )
                raw_content = self.client.call_api(system_prompt, user_prompt)
                content = self._clean_section_output(raw_content)
                atomic_write(section_path, content)
                state.setdefault("cache", {})[cache_key] = current_cache_meta
                self.save_state(stem, state)

            parts.append(content)
            prev_tail = content

        merged = "\n\n".join(p.strip() for p in parts if p.strip()) + "\n"

        # 兜底：合并后若没有 `# 标题`，从 outline 标题候选首条补上——保证下游
        # validate_rewrite_output 的 `^#\s+\S+` 校验通过，否则 Step 6 直接 raise。
        if not re.search(r"^#\s+\S+", merged, re.MULTILINE):
            fallback_title = self._first_title_candidate(outline_text) or "未命名博文"
            merged = f"# {fallback_title}\n\n{merged.lstrip()}"

        return merged

    @staticmethod
    def _first_title_candidate(outline_text: str) -> str:
        """从 outline 的「## 标题候选」区抓首条编号项，作为合并后兜底标题。"""
        m = re.search(
            r"^##\s*标题候选\s*\n(.*?)(?=^##\s|\Z)",
            outline_text,
            re.MULTILINE | re.DOTALL,
        )
        if not m:
            return ""
        for line in m.group(1).splitlines():
            line = line.strip()
            item = re.match(r"^\d+[\.\)、]\s*(.+)$", line)
            if item:
                return item.group(1).strip()
        return ""

    def run_job(
        self,
        stem: str,
        source_path: Path,
        mode: str = "quick",
        routing: str = "/default",
        speaker: str = "我",
        max_retries: int = 1,
        user_confirm_callback: Callable[[str, dict[str, Any]], bool] | None = None,
        pause_on_outline: bool = True,
    ) -> Path | None:
        """Executes the full or quick workflow.
        
        Quick transitions: PENDING -> REWRITING -> CHECKING -> DONE/WAITING_USER_REVIEW.
        Full transitions: PENDING -> CLEANING -> EXTRACTING -> STRUCTURING -> REWRITING -> CHECKING.
        """
        self._check_cancelled()
        if mode not in {"quick", "full"}:
            raise ValueError(f"未知 MODE: {mode}")

        # Run pre-flight configurations checks first
        errors = self.loader.check_placeholders()
        if errors:
            raise ValueError(
                "Pre-Flight 校验失败，请修改以下占位符后重新运行:\n" + "\n".join(f"- {e}" for e in errors)
            )

        source_path = Path(source_path).resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"输入源文件不存在: {source_path}")

        raw_input = source_path.read_text(encoding="utf-8", errors="replace")
        
        # Calculate contract fingerprint and input hash for cache checking
        contract_fingerprint = self.calculate_contract_fingerprint()
        input_hash = hashlib.sha256(raw_input.encode("utf-8")).hexdigest()[:16]

        # Load or initialize state
        state = self.load_state(stem)
        loaded_mode = state.get("mode")
        if (
            state.get("status") == "FINISHED"
            and state.get("mode") == mode
            and not state.get("force_retry", False)
            and state.get("final_post_path")
        ):
            final_path = self.repo_root / state["final_post_path"]
            best_version = state.get("best_version", 1)
            rewrite_meta = state.get("cache", {}).get(f"REWRITING_v{best_version}", {})
            cleaning_meta = state.get("cache", {}).get("CLEANING", {})
            # 关键：rewrite_strategy 也得算进短路命中条件。否则上次 single 跑完
            # cache 命中后，用户重提 sectioned 会被直接短路返回 single 成品 ——
            # 用户意图被悄悄无视。5/28 第 5 次 sectioned 验证撞到的具体 bug。
            cached_strategy = rewrite_meta.get("strategy", "single")
            finished_cache_valid = (
                final_path.exists()
                and rewrite_meta.get("model") == self.client.model
                and rewrite_meta.get("contract_fingerprint") == contract_fingerprint
                and cached_strategy == self.rewrite_strategy
            )
            if mode == "quick":
                finished_cache_valid = (
                    finished_cache_valid
                    and rewrite_meta.get("input_hash") == input_hash
                )
            else:
                finished_cache_valid = (
                    finished_cache_valid
                    and cleaning_meta.get("input_hash") == input_hash
                    and cleaning_meta.get("model") == self.client.model
                    and cleaning_meta.get("contract_fingerprint") == contract_fingerprint
                    and cleaning_meta.get("chunk_char_limit", self.chunk_char_limit) == self.chunk_char_limit
                    and cleaning_meta.get("chunk_context_chars", self.chunk_context_chars) == self.chunk_context_chars
                )
            if finished_cache_valid:
                print(f"[*] 已完成且缓存命中，直接返回成品: {state['final_post_path']}", flush=True)
                return final_path
            # 短路失败时**不**改 status — 留 FINISHED，让下面的统一重置路径
            # 来清 cache / final_post_path / 旧 draft / chunks 等。直接 = "PENDING"
            # 会让那条路径漏掉 FINISHED 分支，残留 final_post_path 让 Step 8
            # 同源去重误删上一轮真实成品（5/28 撞过的 bug）。

        if loaded_mode and loaded_mode != mode and state.get("status") != "PENDING":
            state["status"] = "PENDING"
            state["version"] = 1

        # FINISHED / FAILED / CANCELLED 都视为"上一轮已经收尾"——重新提交同
        # stem 时全部走 PENDING 重置 + 清旧 Step 6/7 产物。否则：
        # - FAILED/CANCELLED: 入口所有 if 不匹配，run_job return None，
        #   server 抛"工作流未产生成品"；
        # - FINISHED: 上次的 draft_v* 仍留在磁盘，前端 fetch /files/draft
        #   拿到旧内容渲染，UI tab 把任务硬切到 review 模式。
        # 5/28 长稿 live 验证撞到的 UI bug 根因都汇总到这一处。
        if state.get("status") in {"FINISHED", "FAILED", "CANCELLED"}:
            state["status"] = "PENDING"
            state["version"] = 1
            state["checked_results"] = []
            state.pop("best_version", None)
            # FINISHED 之后用户重新提交时，旧 final_post_path 也不该残留 —— 否则
            # Step 8 同源去重逻辑会去删掉那个上一轮的成品（即使新一轮还没产出）。
            state.pop("final_post_path", None)
            state["cache"] = {
                k: v
                for k, v in (state.get("cache") or {}).items()
                if not (k.startswith("REWRITING_v") or k.startswith("CHECKING_v"))
            }
            # 清磁盘上的旧 draft_v* / review_v* / chunks/rewrite/*
            import shutil as _shutil
            stale_work_dir = self.repo_root / "work" / stem
            if stale_work_dir.exists():
                for old in stale_work_dir.glob("draft_v*.md"):
                    old.unlink(missing_ok=True)
                for old in stale_work_dir.glob("review_v*.json"):
                    old.unlink(missing_ok=True)
                stale_rewrite_chunks = stale_work_dir / "chunks" / "rewrite"
                if stale_rewrite_chunks.exists():
                    _shutil.rmtree(stale_rewrite_chunks, ignore_errors=True)

        state["mode"] = mode
        state["variables"] = {
            "SPEAKER": speaker,
            "ROUTING": routing,
            "MODE": mode,
            "SOURCE": str(source_path.relative_to(self.repo_root) if source_path.is_relative_to(self.repo_root) else source_path),
            "PREV_TOTAL": "N/A",
            "PREV_REBRIEF": "无",
        }
        self.save_state(stem, state)

        work_dir = self.repo_root / "work" / stem
        work_dir.mkdir(parents=True, exist_ok=True)

        print(f"[*] 开始执行工作流 Job: {stem} (模式: {mode})", flush=True)
        self._progress("job_start", mode=mode)

        if state["status"] == "PENDING":
            state["status"] = "CLEANING" if mode == "full" else "REWRITING"
            state["version"] = 1
            self.save_state(stem, state)

        if mode == "full" and state["status"] == "CLEANING":
            clean_path = work_dir / "clean.md"
            self._run_chunked_clean_step(
                stem=stem,
                state=state,
                input_text=raw_input,
                output_path=clean_path,
                contract_fingerprint=contract_fingerprint,
            )

        if mode == "full" and state["status"] == "EXTRACTING":
            clean_path = work_dir / "clean.md"
            if not clean_path.exists():
                raise FileNotFoundError(f"缺失 Step 3 清洗稿: {clean_path}")
            clean_text = clean_path.read_text(encoding="utf-8")
            insights_path = work_dir / "insights.md"
            self._run_chunked_extract_step(
                stem=stem,
                state=state,
                input_text=clean_text,
                output_path=insights_path,
                contract_fingerprint=contract_fingerprint,
                source_chunk_dir=work_dir / "chunks" / "clean",
            )

        if mode == "full" and state["status"] == "STRUCTURING":
            insights_path = work_dir / "insights.md"
            if not insights_path.exists():
                raise FileNotFoundError(f"缺失 Step 4 提要: {insights_path}")
            insights_text = insights_path.read_text(encoding="utf-8")
            outline_path = work_dir / "outline.md"
            self._run_content_step(
                stem=stem,
                state=state,
                status_name="STRUCTURING",
                step_name="structure-narrative",
                step_label="Step 5",
                input_text=insights_text,
                output_path=outline_path,
                next_status="WAITING_USER_OUTLINE" if pause_on_outline else "REWRITING",
                contract_fingerprint=contract_fingerprint,
                include_examples=True,
                expected_heading_pattern=r"^##\s*标题候选\b",
            )

        if state["status"] == "WAITING_USER_OUTLINE":
            outline_path = work_dir / "outline.md"
            print(f"\n[!] 任务暂停：骨架已生成于 {outline_path.relative_to(self.repo_root)}，等待用户审批大纲...", flush=True)
            if sys.stdin.isatty():
                input("    请在编辑完大纲后，按回车键恢复执行...")
                state["status"] = "REWRITING"
                self.save_state(stem, state)
                print("    -> 状态恢复为 REWRITING，继续执行...", flush=True)
            else:
                print("    [提示] 当前处于非交互环境。大纲已暂停挂起，请通过 API 确认后重新拉起。", flush=True)
                return None

        if mode == "full":
            clean_path = work_dir / "clean.md"
            insights_path = work_dir / "insights.md"
            outline_path = work_dir / "outline.md"
            if state["status"] in ("REWRITING", "CHECKING", "DONE", "DRAFT_DONE"):
                missing = [p for p in (clean_path, insights_path, outline_path) if not p.exists()]
                if missing:
                    rels = ", ".join(str(p.relative_to(self.repo_root)) for p in missing)
                    raise FileNotFoundError(f"Full 模式缺失上游产物: {rels}")
            rewrite_input = (
                "### Step 3 清洗稿\n"
                f"{clean_path.read_text(encoding='utf-8')}\n\n"
                "### Step 4 提要\n"
                f"{insights_path.read_text(encoding='utf-8')}\n\n"
                "### Step 5 骨架\n"
                f"{outline_path.read_text(encoding='utf-8')}"
            )
        else:
            rewrite_input = raw_input

        # ----------------------------------------------------
        # Loop for REWRITING <-> CHECKING (Self-correction)
        # ----------------------------------------------------
        while state["status"] in ("REWRITING", "CHECKING"):
            self._check_cancelled()
            version = state["version"]
            draft_path = work_dir / f"draft_v{version}.md"
            review_path = work_dir / f"review_v{version}.json"

            if state["status"] == "REWRITING":
                print(f"[+] [Step 6] 正在生成第 {version} 版博文草稿...", flush=True)
                self._progress("step", step=6, version=version)

                # §9-C 按节策略仅在 full 模式 + outline 骨架可解析时生效，
                # 自修正循环 (version>1) 强制回退 single：上轮失败要看全局，不再分节。
                active_strategy = "single"
                outline_sections: OutlineSections | None = None
                outline_text_for_rewrite = ""
                if (
                    self.rewrite_strategy == "sectioned"
                    and mode == "full"
                    and version == 1
                ):
                    outline_path = work_dir / "outline.md"
                    if outline_path.exists():
                        outline_text_for_rewrite = outline_path.read_text(encoding="utf-8")
                        parsed_sections = parse_outline_sections(outline_text_for_rewrite)
                        if parsed_sections.has_skeleton:
                            outline_sections = parsed_sections
                            active_strategy = "sectioned"
                        else:
                            print(
                                "    -> outline 骨架不可解析，回退一次性整篇改写。",
                                flush=True,
                            )

                # Check idempotence / cache (hash of input + step/version + model + contract + strategy)
                cache_key = f"REWRITING_v{version}"
                cached_meta = state.get("cache", {}).get(cache_key)

                current_cache_meta = {
                    "input_hash": self._hash_text(rewrite_input),
                    "model": self.client.model,
                    "contract_fingerprint": contract_fingerprint,
                    "strategy": active_strategy,
                }

                cache_hit = (
                    cached_meta is not None
                    and all(cached_meta.get(k) == v for k, v in current_cache_meta.items())
                    and draft_path.exists()
                )

                if cache_hit and not state.get("force_retry", False):
                    print(f"    -> 发现已有第 {version} 版草稿，跳过 API 请求 (缓存命中)。", flush=True)
                    draft_content = draft_path.read_text(encoding="utf-8")
                else:
                    # Inject variables for templates (A4 contract requirement)
                    if version > 1:
                        prev_review = state["checked_results"][-1]
                        state["variables"]["PREV_TOTAL"] = prev_review.get("total", "0/60")
                        state["variables"]["PREV_REBRIEF"] = prev_review.get("rebrief", "无")
                    else:
                        state["variables"]["PREV_TOTAL"] = "N/A"
                        state["variables"]["PREV_REBRIEF"] = "无"

                    if active_strategy == "sectioned":
                        assert outline_sections is not None
                        clean_text_for_rewrite = (work_dir / "clean.md").read_text(encoding="utf-8")
                        insights_text_for_rewrite = (work_dir / "insights.md").read_text(encoding="utf-8")
                        print(
                            f"    -> 按节滚动改写：导语 + {len(outline_sections.body)} 节 + 收尾"
                            f"（预计 {outline_sections.total_calls} 次 LLM 调用）...",
                            flush=True,
                        )
                        draft_content = self._run_rewrite_sectioned(
                            stem=stem,
                            state=state,
                            work_dir=work_dir,
                            clean_text=clean_text_for_rewrite,
                            insights_text=insights_text_for_rewrite,
                            outline_text=outline_text_for_rewrite,
                            sections=outline_sections,
                            contract_fingerprint=contract_fingerprint,
                            version=version,
                        )
                    else:
                        system_prompt, user_prompt = self.loader.assemble_prompt(
                            step_name="rewrite-blog",
                            variables=state["variables"],
                            raw_input=rewrite_input,
                        )
                        draft_content = self.client.call_api(system_prompt, user_prompt)

                    atomic_write(draft_path, draft_content)

                    # Update cache key
                    state.setdefault("cache", {})[cache_key] = current_cache_meta
                    self.save_state(stem, state)

                cleaned_draft_content = extract_blog_body(draft_content)
                validate_rewrite_output(cleaned_draft_content)
                if cleaned_draft_content != draft_content:
                    print("    -> 已清理 Step 6 输出中的运行过程痕迹。", flush=True)
                    atomic_write(draft_path, cleaned_draft_content)
                    draft_content = cleaned_draft_content

                # Save history record
                history_entry = {
                    "step": "REWRITING",
                    "version": version,
                    "draft_path": str(draft_path.relative_to(self.repo_root)),
                    "timestamp": datetime.now().isoformat(),
                }
                # Dedup history entries
                state["history"] = [
                    h
                    for h in state["history"]
                    if not (h.get("step") == "REWRITING" and h.get("version") == version)
                ]
                state["history"].append(history_entry)
                state["status"] = "CHECKING"
                state["force_retry"] = False
                self.save_state(stem, state)

            if state["status"] == "CHECKING":
                print(f"[+] [Step 7] 正在对第 {version} 版草稿进行质检校验...", flush=True)
                self._progress("step", step=7, version=version)
                draft_content = draft_path.read_text(encoding="utf-8")

                # Local free check first: VIEWER_RE scan
                viewer_match = VIEWER_RE.search(draft_content)
                if viewer_match:
                    print(f"    -> [拦截] 触发本地视角违规词: '{viewer_match.group(0)}' (零成本拦截，不调用大模型评分)", flush=True)
                    self._progress("viewer_blocked", word=viewer_match.group(0))
                    check_result = {
                        "version": version,
                        "verdict": "REVIEW",
                        "scores": {
                            "忠实度": 0, "可读性": 0, "观点密度": 0,
                            "风格一致": 0, "完整性": 0, "视角忠实度": 0
                        },
                        "total": "0/60",
                        "rebrief": f"触发本地视角违规词: '{viewer_match.group(0)}'。请确保使用演讲者第一人称口吻，禁止出现“我看完、读者、编者按”等词汇。"
                    }
                else:
                    # Check Step 7 cache
                    cache_key = f"CHECKING_v{version}"
                    cached_meta = state.get("cache", {}).get(cache_key)
                    current_cache_meta = {
                        "input_hash": hashlib.sha256(draft_content.encode("utf-8")).hexdigest()[:16],
                        "model": self.client.model,
                        "contract_fingerprint": contract_fingerprint,
                        "quality_format": "json-first",
                    }
                    
                    cache_hit = (
                        cached_meta is not None
                        and cached_meta.get("input_hash") == current_cache_meta["input_hash"]
                        and cached_meta.get("model") == self.client.model
                        and cached_meta.get("contract_fingerprint") == contract_fingerprint
                        and review_path.exists()
                    )

                    if cache_hit:
                        print(f"    -> 发现已有第 {version} 版质检结果，跳过 API 质检请求 (缓存命中)。", flush=True)
                        check_result = json.loads(review_path.read_text(encoding="utf-8"))
                    else:
                        system_prompt, user_prompt = self.loader.assemble_prompt(
                            step_name="quality-check",
                            variables=state["variables"],
                            raw_input=draft_content,
                            include_examples=False,   # 质检无需范文锚定，省 token；指纹仍会注入用于风格一致性判分
                            include_workflow=False,   # 关掉整份 WORKFLOW.md：避免 LLM 看见 Step 3-8 说明后跑歪、把全工作流复述一遍
                        )
                        quality_user_prompt = (
                            user_prompt
                            + "\n\n### 输出格式补充\n"
                            "优先输出 JSON object，字段必须为 verdict、scores、total、rebrief。"
                            "scores 必须包含：忠实度、可读性、观点密度、风格一致、完整性、视角忠实度。"
                            "如果无法满足 JSON，再退回本步骤 SKILL.md 的 Markdown 评分表格式。"
                        )
                        try:
                            check_resp = self.client.call_api(system_prompt, quality_user_prompt, json_mode=True)
                        except Exception as exc:
                            if not looks_like_json_mode_unsupported(exc):
                                raise
                            print(
                                "    -> 当前 LLM provider 不支持 JSON mode，退回 Markdown 质检格式。",
                                flush=True,
                            )
                            check_resp = self.client.call_api(system_prompt, user_prompt, json_mode=False)
                        try:
                            check_result = parse_quality_json_review(check_resp)
                            check_result["version"] = version
                        except ValueError as e:
                            markdown_resp = extract_quality_review(check_resp)
                            try:
                                check_result = parse_markdown_review(markdown_resp)
                                check_result["version"] = version
                            except ValueError as markdown_error:
                                # 解析失败硬 guard：LLM 没按 quality-check 合同输出评分表。
                                # 标 parse_failed=True，下游跳过自修正、直接转人工审稿——避免基于假反馈烧 token。
                                print(
                                    f"    -> [拦截] Step 7 输出不符合合同: JSON={e}; Markdown={markdown_error}",
                                    flush=True,
                                )
                                check_result = {
                                    "version": version,
                                    "verdict": "REVIEW",
                                    "scores": {},
                                    "total": "—/60",
                                    "rebrief": (
                                        "Step 7 LLM 输出不符合 quality-check 合同"
                                        f"（JSON={e}; Markdown={markdown_error}）。\n"
                                        f"已跳过自修正，转人工审稿——请直接审阅 draft_v{version}.md 决定接受或弃用。\n"
                                        f"LLM 原始响应前 500 字：\n{check_resp[:500]}"
                                    ),
                                    "raw_markdown": check_resp,
                                    "parse_failed": True,
                                }
                        atomic_write(review_path, json.dumps(check_result, ensure_ascii=False, indent=2))
                        
                        # Update cache key
                        state.setdefault("cache", {})[cache_key] = current_cache_meta
                        self.save_state(stem, state)

                # Update checked results
                state["checked_results"] = [r for r in state["checked_results"] if r["version"] != version]
                state["checked_results"].append(check_result)

                verdict = check_result.get("verdict", "REVIEW")
                score_str = check_result.get("total", "0/60")
                print(f"    -> 质检结论: {verdict} (得分: {score_str})", flush=True)
                self._progress("verdict", step=7, version=version, verdict=verdict, total=score_str)

                if verdict == "PASS":
                    state["status"] = "DONE"
                    state["best_version"] = version
                    self.save_state(stem, state)
                elif check_result.get("parse_failed"):
                    # Step 7 LLM 输出不合同 → 跳过自修正（避免基于假反馈再烧一轮 token），直接挂人工审
                    print("    -> Step 7 解析失败，跳过自修正，转人工审稿。", flush=True)
                    self._progress("parse_failed", step=7)
                    state["best_version"] = version
                    state["status"] = "WAITING_USER_REVIEW"
                    self.save_state(stem, state)
                else:
                    # Self-correction check
                    if version <= max_retries:
                        print(f"    -> [自修正] 启动自我修正循环，尝试第 {version + 1} 轮重写...", flush=True)
                        self._progress("self_correct", step=7, round=version + 1)
                        state["status"] = "REWRITING"
                        state["version"] = version + 1
                        self.save_state(stem, state)
                    else:
                        # Exceeded retries, select the best version
                        print("    -> 已达到最大重试次数。开始评估并选择最佳版本...", flush=True)
                        self._progress("max_retries", step=7)
                        best_ver = 1
                        best_score = -1
                        # Parse score string (e.g. "54/60" -> 54)
                        for r in state["checked_results"]:
                            tot = r.get("total", "0/60")
                            try:
                                val = int(tot.split("/")[0])
                            except Exception:
                                val = 0
                            # Penalize VIEWER_RE violations heavily
                            if "视角违规" in r.get("rebrief", "") or "0/60" in tot:
                                val -= 100
                            if val > best_score:
                                best_score = val
                                best_ver = r["version"]

                        state["best_version"] = best_ver
                        best_result = next(r for r in state["checked_results"] if r["version"] == best_ver)
                        
                        if best_result.get("verdict") == "PASS":
                            state["status"] = "DONE"
                        else:
                            state["status"] = "WAITING_USER_REVIEW"
                        
                        self.save_state(stem, state)

        # ----------------------------------------------------
        # WAITING_USER_REVIEW (Human approval checkpoint)
        # ----------------------------------------------------
        if state["status"] == "WAITING_USER_REVIEW":
            best_ver = state["best_version"]
            best_result = next(r for r in state["checked_results"] if r["version"] == best_ver)
            print(f"\n[!] 任务暂停：该博文未通过质量把关 (最佳版本为第 {best_ver} 版，得分 {best_result.get('total', '0/60')})", flush=True)
            print(f"    改进建议: {best_result.get('rebrief', '')}", flush=True)
            
            accept_draft = False
            if user_confirm_callback:
                accept_draft = user_confirm_callback(stem, best_result)
            elif sys.stdin.isatty():
                ans = input("    是否接受该版本并输出为草稿 (DRAFT)？[y/N]: ").strip().lower()
                accept_draft = ans in ("y", "yes")
            else:
                print("    [提示] 当前处于非交互环境。工作流已暂停挂起，等待 API 审核确认。", flush=True)
                return None

            if accept_draft:
                state["status"] = "DRAFT_DONE"
                self.save_state(stem, state)
                print("    -> 用户接受草稿，进入 Step 8 落盘。", flush=True)
            else:
                print("    -> 用户拒绝草稿，工作流中止。你可以修改相关规范合同后使用 --force 重跑。", flush=True)
                return None

        # ----------------------------------------------------
        # DONE or DRAFT_DONE -> Step 8 Format and Save
        # ----------------------------------------------------
        if state["status"] in ("DONE", "DRAFT_DONE"):
            best_ver = state["best_version"]
            draft_path = work_dir / f"draft_v{best_ver}.md"
            review_json = next(r for r in state["checked_results"] if r["version"] == best_ver)
            
            draft_content = draft_path.read_text(encoding="utf-8")
            
            # Extract title for the filename
            title = "未命名博文"
            for line in draft_content.splitlines():
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
            
            clean_title_str = clean_title(title)
            date_str = datetime.now().strftime("%Y-%m-%d")
            
            # Resolve destination file name
            yyyy = datetime.now().strftime("%Y")
            posts_dir = self.repo_root / "output" / "Posts" / yyyy
            posts_dir.mkdir(parents=True, exist_ok=True)
            
            if state["status"] == "DRAFT_DONE":
                filename = f"DRAFT-{date_str}-{clean_title_str}.md"
            else:
                filename = f"{date_str}-{clean_title_str}.md"
                
            post_path = posts_dir / filename

            # 同源重跑去重：删掉本 job 上一次产出的旧成品（标题一变文件名就变，否则成品库会堆积重复）。
            reviews_dir = self.repo_root / "output" / "Reviews"
            prev_post_rel = state.get("final_post_path")
            replaced_rel: str | None = None
            if prev_post_rel:
                prev_abs = self.repo_root / prev_post_rel
                if prev_abs.exists() and prev_abs.resolve() != post_path.resolve():
                    prev_abs.unlink()
                    replaced_rel = prev_post_rel
                    rev_stem = prev_abs.stem[len("DRAFT-"):] if prev_abs.stem.startswith("DRAFT-") else prev_abs.stem
                    (reviews_dir / f"{rev_stem}.review.md").unlink(missing_ok=True)

            # §6 同名冲突（来自不同 job）：追加 -v2/-v3；同 job 同名直接覆盖。
            if post_path.exists() and str(post_path.relative_to(self.repo_root)) != prev_post_rel:
                base = post_path.stem
                n = 2
                while (posts_dir / f"{base}-v{n}.md").exists():
                    n += 1
                post_path = posts_dir / f"{base}-v{n}.md"

            # Write final blog with YAML frontmatter (safe dump to prevent format errors with ": ")
            frontmatter = {
                "title": title,
                "date": date_str,
                "entry": "transcript",
                "mode": mode,
                "routing": routing,
                "speaker": speaker,
                "source": state["variables"]["SOURCE"],
                "pass_score": review_json.get("total", "0/60"),
            }
            
            # Clean body: 去掉 frontmatter，并剥掉泄漏的 HTML 注释（如 <!-- video2blog ... Speaker=X -->），
            # 避免正文里的 Speaker= 注释与 frontmatter 的 speaker 自相矛盾。
            _, final_body = strip_frontmatter(draft_content)
            final_body = re.sub(r"<!--.*?-->\s*", "", final_body, flags=re.DOTALL).strip()

            # Make sure title heading exists; Step 6 may legally start with an HTML comment.
            if not re.search(r"^#\s+\S+", final_body, re.MULTILINE):
                final_body = f"# {title}\n\n" + final_body.strip()

            yaml_block = "---\n" + yaml.safe_dump(frontmatter, allow_unicode=True, default_flow_style=False) + "---\n"
            final_content = yaml_block + final_body
            
            # Atomic save
            atomic_write(post_path, final_content)
            print(f"[✓] 博文已输出到成品目录: {post_path.relative_to(self.repo_root)}", flush=True)
            self._progress("artifact", step=8, what="post", path=str(post_path.relative_to(self.repo_root)))

            # Write Review report (re-using the raw markdown quality-check output from LLM)
            reviews_dir.mkdir(parents=True, exist_ok=True)
            # review 文件名跟随最终成品名（含可能的 -v2 / DRAFT- 前缀去除），保持成品与质检一一对应。
            review_stem = post_path.stem[len("DRAFT-"):] if post_path.stem.startswith("DRAFT-") else post_path.stem
            review_md_path = reviews_dir / f"{review_stem}.review.md"
            
            raw_review_md = review_json.get("raw_markdown")
            if not raw_review_md:
                scores = review_json.get("scores", {})
                score_table_rows = []
                for dim, sc in scores.items():
                    score_table_rows.append(f"| {dim} | {sc} |")
                score_table_str = "\n".join(score_table_rows)

                raw_review_md = (
                    f"# 质检评分报告 - {title}\n\n"
                    f"## 评分\n"
                    f"| 维度 | 分数 |\n"
                    f"|---|---|\n"
                    f"{score_table_str}\n"
                    f"| **总分** | **{review_json.get('total', '0/60')}** |\n\n"
                    f"## Re-Brief\n"
                    f"{review_json.get('rebrief', '通过')}\n"
                )
            atomic_write(review_md_path, raw_review_md)
            print(f"[✓] 质检报告已保存: {review_md_path.relative_to(self.repo_root)}", flush=True)
            self._progress("artifact", step=8, what="review", path=str(review_md_path.relative_to(self.repo_root)))

            # Update HISTORY.md（按成品路径去重，并清掉被同源替换掉的旧记录）
            self._update_history(post_path, title, mode, state["status"], final_body, speaker, replaced_rel)
            
            # Update Fingerprints
            self._update_fingerprint(post_path)

            state["status"] = "FINISHED"
            state["final_post_path"] = str(post_path.relative_to(self.repo_root))
            self.save_state(stem, state)
            print("[*] 任务执行完毕！\n", flush=True)
            return post_path
            
        return None

    def generate_summary(self, post_body: str, title: str, speaker: str) -> str:
        """生成 HISTORY.md 一句摘要：纯模板、确定性、零 LLM 调用。

        刻意去掉 LLM 调用——finalize 步骤不应有任何可能卡 5+ 分钟的网络依赖。
        （今天此处已亲历两次 LLM 卡死：Step 6 v2 + 此处 generate_summary 各一次。）
        speaker 中的括号注解（如「葛旭（孤独的阅读者创办者）」中的「(...)」）会被剥掉，
        HISTORY 摘要列只用主体姓名。若需要更精炼的一句摘要，请人工编辑 memory/HISTORY.md。

        post_body 参数保留是为了不破坏调用方签名；本函数不读它。
        """
        clean_speaker = re.sub(r"（.*?）|\(.*?\)", "", speaker).strip() or speaker
        return f"我（{clean_speaker}）分享了关于《{title}》的内容。"

    def _update_history(self, post_path: Path, title: str, mode: str, status: str, post_body: str, speaker: str, replaced_rel: str | None = None) -> None:
        """Updates the memory/HISTORY.md table, prepending the new post, keeping max 10 records."""
        history_path = self.repo_root / "memory" / "HISTORY.md"
        date_str = datetime.now().strftime("%Y-%m-%d")
        rel_path = str(post_path.relative_to(self.repo_root))

        # 摘要由 generate_summary 走纯模板（确定性、零 LLM 调用），杜绝 finalize 步骤被 LLM 卡死。
        summary = self.generate_summary(post_body, title, speaker)
        print(f"[+] HISTORY 索引已生成（模板摘要，无 LLM 调用）", flush=True)
        
        # New markdown table row: | 日期 | 标题 | 演讲人 | 一句摘要（演讲人视角） | 成品路径 |
        new_row = f"| {date_str} | {title} | {speaker} | {summary} | {rel_path} |"
        
        headers = []
        table_started = False
        existing_rows = []
        
        if history_path.exists():
            for line in history_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                if line.startswith("|"):
                    table_started = True
                    if any(h in line for h in ("日期", "---")):
                        # Capture header format
                        headers.append(line.strip())
                    else:
                        existing_rows.append(line.strip())
                elif not table_started:
                    headers.append(line.strip())
                    
        # Make sure standard headers exist
        if not headers or not any("日期" in h for h in headers):
            headers = [
                "# 近期博文索引",
                "",
                "保留最近 10 篇。这里只做人类索引；风格比对使用 `memory/fingerprints.jsonl`。",
                "",
                "| 日期 | 标题 | 演讲人 | 一句摘要（演讲人视角） | 成品路径 |",
                "|---|---|---|---|---|"
            ]
            
        # 按成品路径去重：去掉指向同一 path 或被同源替换掉的旧记录，避免重复堆积。
        def _row_path(row_line: str) -> str:
            cells = [c.strip() for c in row_line.strip().strip("|").split("|")]
            return cells[4] if len(cells) >= 5 else ""

        drop_paths = {rel_path}
        if replaced_rel:
            drop_paths.add(replaced_rel)
        existing_rows = [r for r in existing_rows if _row_path(r) not in drop_paths]

        # Limit to last 9 records so the new row makes it 10
        existing_rows = existing_rows[:9]
        
        # Split headers into prefix (explanation) and table headers
        prefix_parts = []
        table_headers = []
        for h in headers:
            if h.startswith("|"):
                table_headers.append(h)
            else:
                prefix_parts.append(h)
                
        all_lines = prefix_parts + [""] + table_headers + [new_row] + existing_rows
        history_content = "\n".join(all_lines) + "\n"
        
        atomic_write(history_path, history_content)
        print(f"[✓] 已更新历史索引 memory/HISTORY.md", flush=True)
        self._progress("artifact", step=8, what="history")

    def _update_fingerprint(self, post_path: Path) -> None:
        """Updates the style fingerprints JSONL for the generated post."""
        if fingerprint is None or upsert_jsonl is None:
            print("[!] 未导入 scripts/update_fingerprint.py，跳过风格指纹更新。", flush=True)
            return
            
        try:
            # Skip draft posts from updating machine style fingerprint
            if post_path.name.startswith("DRAFT-"):
                return
            out_jsonl = self.repo_root / "memory" / "fingerprints.jsonl"
            record = fingerprint(post_path, self.repo_root)
            upsert_jsonl(out_jsonl, record)
            print("[✓] 已生成并更新风格指纹 memory/fingerprints.jsonl", flush=True)
            self._progress("artifact", step=8, what="fingerprint")
        except Exception as e:
            print(f"[!] 风格指纹更新失败: {e}", flush=True)

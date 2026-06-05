"""Context and prompt loader for the Video2Blog engine, parsing skill files and enforcing guards."""

from __future__ import annotations

import re
from pathlib import Path

from video2blog.utils import PLACEHOLDER_RE, strip_frontmatter


class ContextLoader:
    """Loads guidelines, style guides, memory config, and step-specific skills to assemble prompts."""

    def __init__(self, repo_root: Path | str) -> None:
        self.repo_root = Path(repo_root).resolve()

    def check_placeholders(self) -> list[str]:
        """Scans memory/PREFERENCES.md, memory/CONFIG.md, and memory/HISTORY.md for placeholders.

        Returns a list of error strings.
        """
        errors = []
        for rel in ("memory/PREFERENCES.md", "memory/CONFIG.md", "memory/HISTORY.md"):
            path = self.repo_root / rel
            if not path.exists():
                errors.append(f"缺失配置文件: {rel}")
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for lineno, line in enumerate(text.splitlines(), start=1):
                if line.strip().startswith(">") or line.strip().startswith("```"):
                    continue
                if PLACEHOLDER_RE.search(line):
                    errors.append(f"发现占位符 {rel}:{lineno}: {line.strip()}")
        return errors

    def get_skill_instruction(self, step_name: str) -> tuple[dict[str, str], str]:
        """Reads and parses the SKILL.md file for a given step.

        Returns:
            A tuple of (frontmatter_dict, markdown_body_text).
        """
        skill_path = self.repo_root / f".cursor/skills/video2blog/{step_name}/SKILL.md"
        if not skill_path.exists():
            raise FileNotFoundError(f"缺失技能指令文件: {skill_path}")

        content = skill_path.read_text(encoding="utf-8", errors="replace")
        frontmatter, body = strip_frontmatter(content)
        return frontmatter, body

    def assemble_prompt(
        self,
        step_name: str,
        variables: dict[str, str],
        raw_input: str,
        prev_written_section: str | None = None,
        global_outline: str | None = None,
        include_examples: bool = True,
        max_examples: int = 2,
        include_workflow: bool = True,
    ) -> tuple[str, str]:
        """Assembles the system and user prompts for a specific step.

        Performs fail-closed interpolation on variables.
        合同要求：注入 knowledge/Examples 范文（锚定文风）与 memory/fingerprints.jsonl（风格一致性参考）。
        """
        # 1. Load context files
        workflow_path = self.repo_root / "WORKFLOW.md"
        style_path = self.repo_root / "knowledge/STYLE_GUIDE.md"
        pref_path = self.repo_root / "memory/PREFERENCES.md"

        if not workflow_path.exists():
            raise FileNotFoundError(f"缺失规范文件: {workflow_path}")
        if not style_path.exists():
            raise FileNotFoundError(f"缺失风格指南: {style_path}")
        if not pref_path.exists():
            raise FileNotFoundError(f"缺失写入偏好: {pref_path}")

        workflow_text = workflow_path.read_text(encoding="utf-8", errors="replace")
        style_text = style_path.read_text(encoding="utf-8", errors="replace")
        pref_text = pref_path.read_text(encoding="utf-8", errors="replace")

        _, skill_body = self.get_skill_instruction(step_name)

        # Load few-shot examples (合同要求至少 1 篇范文) 与机器风格指纹。
        # 这些是静态参考内容，不参与 {{VAR}} 插值。
        example_block = ""
        if include_examples:
            examples_dir = self.repo_root / "knowledge/Examples"
            picked: list[str] = []
            if examples_dir.exists():
                for ex in sorted(examples_dir.glob("*.md")):
                    if ex.name.lower() == "readme.md":
                        continue
                    picked.append(
                        f"--- 范文：{ex.stem} ---\n{ex.read_text(encoding='utf-8', errors='replace')}"
                    )
                    if len(picked) >= max_examples:
                        break
            example_block = "\n\n".join(picked)

        fingerprints_path = self.repo_root / "memory/fingerprints.jsonl"
        fingerprints_text = (
            fingerprints_path.read_text(encoding="utf-8", errors="replace").strip()
            if fingerprints_path.exists()
            else ""
        )

        # 2. Perform variable interpolation with fail-closed checks only on dynamic parts
        # Matches {{VAR_NAME}}
        template_pattern = re.compile(r"\{\{([A-Za-z0-9_-]+)\}\}")

        def replace_match(match: re.Match) -> str:
            var_name = match.group(1)
            if var_name not in variables:
                raise ValueError(f"缺少模板变量: {{{{{var_name}}}}}")
            return variables[var_name]

        # Interpolate only preferences, skill body, and user query
        pref_text = template_pattern.sub(replace_match, pref_text)
        skill_body = template_pattern.sub(replace_match, skill_body)

        # Build User Prompt template first, then interpolate
        user_parts = []
        if global_outline:
            user_parts.extend(["### 全局大纲树", global_outline, ""])
        if prev_written_section:
            user_parts.extend(
                [
                    "### 上一章节改写成稿（最后 200 字参考，用于承上启下）",
                    prev_written_section[-400:],
                    "",
                ]
            )

        user_parts.extend(["### 输入内容", raw_input])
        user_prompt = "\n".join(user_parts)
        user_prompt = template_pattern.sub(replace_match, user_prompt)

        # Fail-closed validation only on the interpolated sections
        for name, text in [
            ("PREFERENCES", pref_text),
            ("SKILL", skill_body),
            ("USER_PROMPT", user_prompt),
        ]:
            rem = template_pattern.search(text)
            if rem:
                raise ValueError(f"在 {name} 中发现未解析的变量: {rem.group(0)}")

        # 3. Build System Prompt (using the interpolated pref_text and skill_body)
        # 注意：quality-check 这类强格式化的步骤可关掉 include_workflow，避免 LLM 看见
        # WORKFLOW.md 里 Step 3-8 全部说明后跑歪、把整个工作流又复述一遍。
        system_parts = [
            "# SYSTEM INSTRUCTIONS",
            "你是一个专业的写作大牛与AI助手。请严格按照以下写作合同、风格规范与用户偏好来完成任务。",
            "",
        ]
        if include_workflow:
            system_parts += [
                "## 1. 运行合同 (WORKFLOW.md)",
                workflow_text,
                "",
            ]
        system_parts += [
            "## 2. 风格硬约束 (STYLE_GUIDE.md)",
            style_text,
            "",
            "## 3. 个人写作偏好 (PREFERENCES.md)",
            pref_text,
            "",
            "## 4. 本步骤执行细则 (SKILL.md)",
            skill_body,
        ]
        if example_block:
            system_parts += [
                "",
                "## 5. 参考范文 (knowledge/Examples，学习其节奏与段落密度，勿照抄原句)",
                example_block,
            ]
        if fingerprints_text:
            system_parts += [
                "",
                "## 6. 机器风格指纹 (memory/fingerprints.jsonl，用于风格一致性参考)",
                fingerprints_text,
            ]
        system_prompt = "\n".join(system_parts)

        return system_prompt, user_prompt

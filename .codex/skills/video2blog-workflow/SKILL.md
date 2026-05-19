---
name: video2blog-workflow
description: Run this repository's video/transcript-to-blog workflow in Codex. Use when the user asks Codex to process video transcripts, turn transcript text into blog posts, continue from video2blog.py output, migrate or operate the .cursor/skills/video2blog chain, or run ENTRY/ROUTING/SOURCE based video-to-blog tasks.
---

# Video2Blog Workflow

## Core Rule

Treat the repository as the source of truth. This Codex skill is an adapter for Codex, not a fork of the workflow.

Before processing any video-to-blog or transcript-to-blog request, read these repo files:

1. `memory/PREFERENCES.md`
2. `memory/CONFIG.md`
3. `knowledge/ROUTER.md`
4. `memory/HISTORY.md` when quality check or style comparison is needed

Then run the Step 3-8 chain by reading the repo-local step contracts:

1. `.cursor/skills/video2blog/clean-transcript/SKILL.md`
2. `.cursor/skills/video2blog/extract-insights/SKILL.md`
3. `.cursor/skills/video2blog/structure-narrative/SKILL.md`
4. `.cursor/skills/video2blog/rewrite-blog/SKILL.md`
5. `.cursor/skills/video2blog/quality-check/SKILL.md`
6. `.cursor/skills/video2blog/format-output/SKILL.md`

Never skip Step 4-7 unless the user explicitly accepts `DRAFT`; still record the exception.

## Start Procedure

1. Resolve the repository root from the current working directory. If the required repo files are missing, stop and ask the user to run the task from the video blog workflow repository.
2. Parse the user's `ENTRY`, `ROUTING`, `SOURCE`, and optional `SPEAKER`, `STRUCTURE`, `STYLE`, `SKIP clean`, or `light-clean` directives.
3. If the user did not provide `SOURCE`, stop and ask for the transcript path or video2blog.py `.txt` output path.
4. Run `scripts/preflight_check.py --repo <repo-root> --entry <entry> --source <source> [--routing <routing>]` when available. If the script reports placeholder hits, stop and report the exact `<file>:<field/line>` items.
5. Output the mandatory Pre-Flight block before any transformation work:

```text
> Pre-Flight ✓
> PREFERENCES: <语言>｜<人称>｜<字数区间>｜禁用套话 N 条
> CONFIG: input_root=<…>｜skills=.cursor/skills/video2blog/
> HISTORY: 近 3 篇标题摘要（或「无可比」）
> ENTRY → video | transcript
> ROUTING → /default | /lecture | /dialogue | /screencast | /meeting
> SOURCE → <path>
> ROUTER → Structure=knowledge/Structures/<f>.md｜Style=knowledge/Styles/<f>.md（由 ROUTER.md 解析；用户覆盖时回显覆盖值）
```

If `ROUTING` is absent, suggest one from the source filename and first 200 characters, then wait for confirmation unless the user wrote `端到端跑`, `跳过确认`, or an equivalent instruction.

## Entry Handling

- `ENTRY → video`: `SOURCE` must point to the `.txt` produced by `video2blog.py`, not the original video file. If only a video file is provided, explain that local Step 1-2 must be run first with `python video2blog.py <video>`.
- `ENTRY → transcript`: do not run `video2blog.py`; start from Step 3.
- If the user asks only to transcribe a video, use `video2blog.py` and do not run Step 3-8 unless they also ask for a blog post.

## Routing

Use `knowledge/ROUTER.md` as the only mapping source. Support:

- `/default`
- `/lecture`
- `/dialogue`
- `/screencast`
- `/meeting`

User overrides win:

```text
STRUCTURE → scqa
STYLE → deep-dive
SPEAKER → 某某
```

If an override is not listed in `knowledge/ROUTER.md` or does not resolve to an existing file, stop and list valid options.

## Output And Files

When Step 8 writes files, use normal Codex file editing rules and the repo contract:

- PASS post: `output/Posts/<YYYY>/<YYYY-MM-DD>-<slug>.md`
- DRAFT post: `output/Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<slug>.md`
- Review: `output/Reviews/<YYYY-MM-DD>-<slug>.review.md`
- History update: append to `memory/HISTORY.md` and keep only the latest 10 records

Do not write finished posts into `input/Text/`; that is input-side storage.

## Verification

After writing outputs:

1. Run a placeholder scan on the changed files.
2. Confirm the Review contains the Step 7 score table and Re-Brief.
3. Confirm the post frontmatter matches Step 8's required fields.
4. Confirm `memory/HISTORY.md` contains an演讲人第一人称 summary and at most 10 records.

## Resource

Use `scripts/preflight_check.py` for deterministic Pre-Flight summaries and placeholder checks. The script intentionally ignores quoted/template explanation lines so repo documentation examples do not create false stops.

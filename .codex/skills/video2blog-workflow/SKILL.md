---
name: video2blog-workflow
description: Run this repository's video/transcript-to-blog workflow in Codex.
---

# Video2Blog Workflow Adapter

This is a Codex adapter, not the workflow contract.

For any video-to-blog or transcript-to-blog task:

1. Read `WORKFLOW.md` first.
2. Read `memory/PREFERENCES.md`, `memory/CONFIG.md`, `knowledge/STYLE_GUIDE.md`.
3. Read at least one relevant file in `knowledge/Examples/`.
4. Follow `ENTRY`, `MODE`, `ROUTING`, `SOURCE`, Pre-Flight, and output rules from `WORKFLOW.md`.

Use repo-local Step contracts in `.cursor/skills/video2blog/` only as execution details. Do not reintroduce old `knowledge/ROUTER.md` or `knowledge/Structures|Styles` dependencies; those are archived.

Useful helper:

```bash
python3 .codex/skills/video2blog-workflow/scripts/preflight_check.py --repo . --entry transcript --source <path>
```

# Cursor Skills To Codex Skill

This Codex skill intentionally keeps `.cursor/skills/video2blog/*/SKILL.md` as the step-level source of truth.

Reason:

- Cursor and Codex should not drift into two different workflows.
- The Codex skill only adds discovery, Pre-Flight, routing, and Codex-specific execution rules.
- Step behavior remains editable in one place inside the repository.

If the project later needs a fully portable Codex skill, copy each step contract into `references/steps/` and update `SKILL.md` to prefer those bundled references when the repo-local `.cursor/skills` directory is absent.

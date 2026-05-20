---
name: video2blog-format-output
description: Step 8 落盘正文、Review、HISTORY 和机器指纹。
---

# format-output

适用：Step 7 `PASS`，或用户明确接受 `REVIEW` 稿作为 `DRAFT`。

执行前读 `WORKFLOW.md`、`memory/CONFIG.md`、`output/README.md`。

落盘：

- PASS：`output/Posts/<YYYY>/<YYYY-MM-DD>-<中文短标题>.md`
- DRAFT：`output/Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<中文短标题>.md`
- Review：`output/Reviews/<YYYY-MM-DD>-<中文短标题>.review.md`
- HISTORY：追加到 `memory/HISTORY.md`，保留最近 10 条
- Fingerprint：必须运行 `python3 scripts/update_fingerprint.py <post>`

frontmatter：

```yaml
---
title: <标题>
date: <YYYY-MM-DD>
entry: video | transcript
mode: full | quick
routing: /default | /lecture | /dialogue | /screencast | /meeting
speaker: <演讲人>
source: <SOURCE>
pass_score: <xx>/60
---
```

要求：

- 不写入 `input/Text/` 或 `work/`。
- Review 必须复制 Step 7 评分表和 Re-Brief。
- 正文、Review、HISTORY、Fingerprint 全部完成后，Step 8 才算完成。
- `<中文短标题>` 取自文章标题，保留中文语义，去掉 `/ \ : * ? " < > |` 和冒号、引号、书名号等标点，建议 8-18 个汉字。
- 同名冲突追加 `-v2`、`-v3`，不覆盖。

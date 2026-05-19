---
name: video2blog-format-output
description: Step 8 文件名、可选 frontmatter、归档落盘与 HISTORY 登记表增量。
---

# format-output

## 何时使用

- Step 7 已 `PASS`，或用户接受 `DRAFT` 明示。

## 执行前必读

- `Context/CONFIG.md` 约定目录
- `Context/Work/README.md` 归档结构与命名约定

## 落盘强契约（PASS / DRAFT 共通）

| 文件 | 路径 | 何时写 |
|---|---|---|
| 定稿正文 | `Context/Work/Posts/<YYYY>/<YYYY-MM-DD>-<slug>.md` | PASS |
| 草稿正文 | `Context/Work/Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<slug>.md` | REVIEW 且用户接受先落 |
| 评分报告 | `Context/Work/Reviews/<YYYY-MM-DD>-<slug>.review.md` | **PASS / REVIEW 都写**（含 Step 7 评分表 + Re-Brief 全文） |
| HISTORY 增行 | `Context/HISTORY.md` | PASS / DRAFT 都写（仅 10 条） |

- **slug**：用主题英文短语或 pinyin，无空格，长度 ≤ 40 字符
- **同名冲突**：追加 `-v2` / `-v3`，禁覆盖
- Ask 模式无写权限时：在对话里完整给出三份 patch（正文、Review、HISTORY），让用户复制

## YAML frontmatter（可选）

`PREFERENCES.md` 未禁则默认开启：

```yaml
---
title: <文章标题>
date: <YYYY-MM-DD>
entry: video | transcript
routing: /default | /lecture | /dialogue | /screencast | /meeting
speaker: <演讲人姓名 + 一句身份说明>
structure: Knowledge/Structures/<file>.md
style: Knowledge/Styles/<file>.md
source: <相对仓库路径或绝对路径>
pass_score: <Step 7 总分>/60
---
```

并在正文首行 HTML 注释里追加 `Speaker=<姓名>`：

```html
<!-- video2blog: Style=… Structure=… Prompt=… Speaker=<姓名> -->
```

## HISTORY 强契约

- **PASS 与 DRAFT 都须**在 `Context/HISTORY.md` 表格追加一行：

  ```markdown
  | 2026-05-14 | 标题 | 演讲人 | 一句摘要（演讲人视角，≤ 40 字，含核心观点而非剧透） |
  ```

- 摘要必须是**演讲人第一人称**（「我（XX）……」），与正文视角对齐；写成「这篇博文讲了 XX」即视为不合规

- 若 HISTORY 仍存「示例占位行」（含 `YYYY-MM-DD`），**先删除该行**再追加。
- 保留最近 **10** 条，**删最旧**，不要无限增长。

## 步骤

1. 生成 slug，确认年份目录 `Context/Work/Posts/<YYYY>/` 存在；不存在则创建。
2. 写正文（按 PASS/DRAFT 决定前缀；frontmatter 按上节模板填齐）。
3. 写 Review：从 Step 7 输出复制评分表与 Re-Brief，加文件头注明对应 Post 文件名。
4. 改 HISTORY（按上节强契约）。
5. 回报用户三份产物的相对路径。

## 反例

- 写到 `drafts/` 目录——那是**输入侧**，不要污染。
- 同名覆盖已有定稿。
- 跳过 Review 落盘——「质量曲线」靠这份历史看。
- 跳过 HISTORY 写入——Step 7 风格一致维度依赖它。

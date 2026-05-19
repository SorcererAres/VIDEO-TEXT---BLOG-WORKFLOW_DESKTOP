# Context/Work/ — Agent 写入侧

PM OS 把 `Context/` 分成「读」与「写」两侧：上一层（`PREFERENCES.md` / `CONFIG.md` / `HISTORY.md`）是读侧（用户记忆）；本目录是**写侧**，由 `format-output` / `quality-check` 落盘。

## 结构

```
Context/Work/
├── Posts/<YYYY>/<YYYY-MM-DD>-<slug>.md         ← 定稿（PASS）
├── Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<slug>.md   ← 未通过但用户接受先落（DRAFT）
└── Reviews/<YYYY-MM-DD>-<slug>.review.md       ← Step 7 评分报告（PASS/REVIEW 都存）
```

## 命名约定

- **slug**：用主题英文短语或 pinyin，避免空格；长度 ≤ 40 字符
- **示例**：`Posts/2026/2026-05-14-manus-acquisition-eve.md`
- **同名冲突**：追加 `-v2` `-v3`，**不要**覆盖

## 为何 PASS 与 DRAFT 都进 `Posts/`

- 仓库根的 `drafts/` 是**输入侧**（`ENTRY → transcript` 的源稿放这里）
- `Context/Work/Posts/` 是**输出侧**——`DRAFT-` 前缀已足够区分质量等级
- 这么做避免输入/输出目录混用

## Reviews 的用途

- Step 7 评分 + Re-Brief 留底，便于事后看「质量曲线」
- PASS 篇的 Review 也要存，回顾时知道当时五项打分多少
- 文件名与对应 Post 同 stem，便于关联

## 与 HISTORY.md 的关系

- `HISTORY.md` = **指纹库**（仅 10 条，供 Step 7 风格比对）
- `Posts/` = **全量归档**（不限条数，年级目录分隔）
- 二者由 Step 8 `format-output` 同步写入

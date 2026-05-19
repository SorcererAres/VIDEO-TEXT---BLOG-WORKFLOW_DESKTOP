# output/ — 写侧成品（博文定稿与质检报告）

本仓库按**五分结构**组织：

- `input/` — 用户喂料（视频 `input/Video/`、文字稿源稿 `input/Text/`）
- `knowledge/` — 写作配方（ROUTER / Structures / Styles / Prompts）
- `memory/` — 读侧用户记忆（`PREFERENCES.md` / `CONFIG.md` / `HISTORY.md`）
- `work/` — 流水线中转（`work/asr/` 原始 ASR 产物、`work/Transcripts/` 规整后统一文字稿）
- `output/` — **本目录，写侧成品**，Posts/Reviews 由 `format-output` / `quality-check` 落盘

输入侧（`input/`）与输出侧（`output/`）严格不互串；中转物一律走 `work/`。

## 结构

```
output/
├── Posts/<YYYY>/<YYYY-MM-DD>-<slug>.md         ← 定稿（PASS）
├── Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<slug>.md   ← 未通过但用户接受先落（DRAFT）
└── Reviews/<YYYY-MM-DD>-<slug>.review.md       ← Step 7 评分报告（PASS/REVIEW 都存）
```

## 命名约定

- **slug**：用主题英文短语或 pinyin，避免空格；长度 ≤ 40 字符
- **示例**：`Posts/2026/2026-05-14-manus-acquisition-eve.md`
- **同名冲突**：追加 `-v2` `-v3`，**不要**覆盖

## 为何 PASS 与 DRAFT 都进 `Posts/`

- 仓库根的 `input/Text/` 是**输入侧**（`ENTRY → transcript` 的源稿放这里）
- `output/Posts/` 是**输出侧**——`DRAFT-` 前缀已足够区分质量等级
- 这么做避免输入/输出目录混用

## Reviews 的用途

- Step 7 评分 + Re-Brief 留底，便于事后看「质量曲线」
- PASS 篇的 Review 也要存，回顾时知道当时五项打分多少
- 文件名与对应 Post 同 stem，便于关联

## 与 HISTORY.md 的关系

- `HISTORY.md` = **指纹库**（仅 10 条，供 Step 7 风格比对）
- `Posts/` = **全量归档**（不限条数，年级目录分隔）
- 二者由 Step 8 `format-output` 同步写入

# Video2Blog Workflow

本文件是运行单一来源。旧规则见 `Archive/knowledge-old/`，只作历史参考。

## 1. 入口

- `ENTRY → video`：先用 `python3 transcribe.py <video>` 生成 `work/<stem>/raw.txt`，再交给 Agent。
- `ENTRY → transcript`：已有文字稿或成文稿，直接给 `SOURCE`。
- `SOURCE` 必填，可指向 `work/<stem>/raw.txt`、`work/<stem>/clean.md`、`input/Text/*` 或已有文章。
- `MODE` 可选：`full` 或 `quick`；未声明默认 `full`。
- `ROUTING` 可选：`/default`、`/lecture`、`/dialogue`、`/screencast`、`/meeting`；未声明时 Agent 按文件名和前 200 字建议。
- `SPEAKER → 某某` 可覆盖默认演讲人主体。

## 2. Pre-Flight

Agent 处理前必须读：

1. `WORKFLOW.md`
2. `memory/PREFERENCES.md`
3. `memory/CONFIG.md`
4. `knowledge/STYLE_GUIDE.md`
5. `knowledge/Examples/` 中至少 1 篇相近范文

读完后扫描 `memory/` 占位符：`____`、`YYYY-MM-DD`、`[填写]`、`[TODO]`、`[占位]`。命中即停止并报告文件与行号。

起手输出：

```text
> Pre-Flight ✓
> ENTRY → video|transcript
> MODE → full|quick
> ROUTING → /...
> SPEAKER → ...
> SOURCE → ...
> STYLE → knowledge/STYLE_GUIDE.md + knowledge/Examples/<file>
```

## 3. 模式

- `full`：Step 3→4→5→6→7→8。用于长视频、重要文章、正式定稿。
- `quick`：Step 6→7→8。用于已清晰文字稿或轻量改写；Step 6 内部完成必要提炼和结构组织，不单独输出 Step 4/5。
- `quick` 不需要 DRAFT 豁免；低质由 Step 7 判定 `REVIEW`。若用户明确接受未通过稿，Step 8 再以 `DRAFT-` 前缀落盘。

## 4. Step 合同

- Step 3 `clean-transcript`：只在 `full` 必跑；原始 ASR 不覆盖，清洗稿写 `work/<stem>/clean.md`。
- Step 4 `extract-insights`：只在 `full` 显式输出观点、金句、案例、数据、疑点。
- Step 5 `structure-narrative`：只在 `full` 显式输出标题候选和骨架。
- Step 6 `rewrite-blog`：以演讲人第一人称写 Markdown；必须引用 `STYLE_GUIDE.md` 和范文；禁止观看者/编者视角。
- Step 7 `quality-check`：检查忠实度、可读性、观点密度、风格一致、完整性、视角忠实度；结合 `memory/fingerprints.jsonl`；只判定 `PASS` 或 `REVIEW`。
- Step 8 `format-output`：`PASS` 写正常正文；用户明确接受 `REVIEW` 稿时写 `DRAFT-` 正文；同时写 `output/Reviews/`，更新 `memory/HISTORY.md` 和 `memory/fingerprints.jsonl`。

## 5. 路由与主体

- `/lecture`：主讲人是“我”。
- `/dialogue`：嘉宾是“我”，主持人降权为提问背景。
- `/screencast`：录屏讲解者是“我”。
- `/meeting`：主持或主决策者是“我”。
- `/default`：主声音方是“我”，Step 6 前须声明。

## 6. 产物

- `work/<stem>/raw.txt|raw.srt|raw.log|meta.json`：脚本生成的原始层。
- `work/<stem>/clean.md`：Agent 清洗层。
- `output/Posts/<YYYY>/<date>-<中文短标题>.md`：PASS 正文。
- `output/Posts/<YYYY>/DRAFT-<date>-<中文短标题>.md`：用户明确接受的 REVIEW 稿。
- `output/Reviews/<date>-<中文短标题>.review.md`：Step 7 评分与 Re-Brief。
- `<中文短标题>` 取自文章标题，保留中文语义，去掉 `/ \ : * ? " < > |` 和冒号、引号、书名号等标点；同名冲突追加 `-v2`、`-v3`。
- `memory/HISTORY.md`：最近 10 篇人类索引。
- `memory/fingerprints.jsonl`：脚本生成的机器风格指纹。

# output/

写侧成品目录。

```text
output/Posts/<YYYY>/<YYYY-MM-DD>-<中文短标题>.md
output/Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<中文短标题>.md
output/Reviews/<YYYY-MM-DD>-<中文短标题>.review.md
```

- PASS 与 DRAFT 都写入 `Posts/`。DRAFT 只用于用户明确接受的 REVIEW 稿，并用文件名前缀区分。
- 输出目录保持英文；文件名使用日期 + 中文短标题。
- Review 必须包含 Step 7 评分表与 Re-Brief。
- Step 8 同步更新 `memory/HISTORY.md` 和 `memory/fingerprints.jsonl`。
- 不要把成品写回 `input/Text/` 或 `work/`。

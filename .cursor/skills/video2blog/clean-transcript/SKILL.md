---
name: video2blog-clean-transcript
description: Step 3 清洗转录/文字稿，不改动事实。
---

# clean-transcript

适用：`MODE → full` 必跑；`MODE → quick` 默认跳过，除非输入是原始 ASR。

执行前读 `WORKFLOW.md`、`memory/PREFERENCES.md`、`knowledge/STYLE_GUIDE.md`。

输入：`work/<stem>/raw.txt`、旧 `work/asr/*.txt`、或 `input/Text/*`。

输出：

```markdown
## 清洗稿
...

## 不确定清单
- [?] ...
```

落盘：写 `work/<stem>/clean.md`。不得覆盖 `raw.txt` 或旧 `work/asr/` 原始件。

要求：

- 删除口头禅、求互动话术、无意义重复。
- 合并碎句，保留语义和顺序。
- 中英数字混排按 `STYLE_GUIDE.md` 规范。
- 不确定听辨标 `[?]`，不要猜成事实。
- 不新增原稿没有的人名、书名、数据、案例。

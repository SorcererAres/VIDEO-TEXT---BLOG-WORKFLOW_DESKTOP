# 管线配置

## 输入

- 视频输入根：`$VIDEO2BLOG_INPUT_ROOT` 或命令行 `--input-root DIR`。
- 视频入口支持 `.mp4`、`.mov`、`.mkv`。
- 文字稿入口建议放 `input/Text/`，也可在指令里给绝对路径。

## 中转

`video2blog.py` 默认写入：

```text
work/<stem>/raw.txt
work/<stem>/raw.srt
work/<stem>/raw.log
work/<stem>/meta.json
```

Agent 清洗稿写入：

```text
work/<stem>/clean.md
```

旧 `work/asr/` 和 `work/Transcripts/` 为历史产物目录，不强制迁移。

## 输出

- PASS 正文：`output/Posts/<year>/<date>-<中文短标题>.md`
- DRAFT 正文：`output/Posts/<year>/DRAFT-<date>-<中文短标题>.md`
- Review：`output/Reviews/<date>-<中文短标题>.review.md`
- 人类索引：`memory/HISTORY.md`
- 机器指纹：`memory/fingerprints.jsonl`

## ASR

- 引擎：`--engine auto|mlx|whisper-cpp|external`
- fallback：`--fallback-policy ask|auto|stop`
- MLX 模型：`VIDEO2BLOG_WHISPER_MODEL`
- whisper.cpp 模型：`VIDEO2BLOG_WHISPER_CPP_MODEL` 或 `--whisper-cpp-model`
- whisper.cpp 命令：`VIDEO2BLOG_WHISPER_CPP_BIN` 或 `--whisper-cpp-bin`
- 沙箱自动转 Terminal：在 Cursor / Codex / Claude Code 内跑时，脚本会检测沙箱并自动用 osascript 开普通 macOS Terminal 重跑 MLX（绕开沙箱 Metal 限制）；禁用：`--no-auto-terminal` 或 `VIDEO2BLOG_NO_AUTO_TERMINAL=1`

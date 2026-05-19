# 管线配置（可随时改）

## 输入文件根与单次输入文件

### 视频（`ENTRY → video`，由 `video2blog.py` 处理）

- **视频输入文件根**：本机放待转写视频的「收件根目录」。推荐与 shell 环境变量 **`VIDEO2BLOG_INPUT_ROOT`**（或每次命令行 **`--input-root DIR`**）保持一致，例如 `~/Movies/inbox`。
  - 在此根之下，若你使用**相对路径**指定「单次输入文件」或「监听子目录」，脚本会先 `根 + 相对路径` 再解析。
  - 若路径已是**绝对路径**，则不再拼根。
- **单次输入文件**：指**某一个**具体视频文件（`.mp4` / `.mov` / `.mkv`），对应命令行位置参数 `VIDEO`。

### 文字稿（`ENTRY → transcript`，不经 `video2blog.py`）

- **文字稿输入文件根**（建议约定）：例如本仓库的 **`input/Text/`**，或你自建的 `~/Notes/transcript-inbox`。Agent 指令里 `SOURCE → path` 推荐写成相对仓库根或绝对路径，避免歧义。

## 路径（与上表配合）

| 用途 | 路径 | 说明 |
|---|---|---|
| 视频收件箱（输入侧） | `$VIDEO2BLOG_INPUT_ROOT`（如 `~/Movies/inbox`） | 「视频输入文件根」；亦可用相对路径 + `-w 子目录` 分层 |
| 脚本产物（中转侧） | `work/asr/<stem>.{srt,txt,meta.json}` | **五分结构约定：转写时显式带 `--output-dir work/asr`**。脚本默认会写 `<视频目录>/output/`（即 `input/Video/output/`，落回输入侧），不带 `--output-dir` 会破坏输入/中转分离 |
| 文字稿收件箱（输入侧） | `input/Text/`（或自建） | `ENTRY → transcript` 的源稿放这里 |
| **博文定稿（输出侧）** | `output/Posts/<YYYY>/` | Step 8 落盘；PASS 与 `DRAFT-` 前缀都进此处 |
| **质检报告（输出侧）** | `output/Reviews/` | Step 7 评分 + Re-Brief 留底 |
| 风格指纹库 | `memory/HISTORY.md` | 最近 10 条，供 Step 7 比对 |

**严格区分输入侧 / 输出侧**：`input/Text/` 是用户喂进来的源稿；`output/Posts/` 是 Agent 写出去的成品。两者不互串。

## 本地转录（Step 1–2）

- **ASR 引擎**：`--engine auto|mlx|whisper-cpp|external`；环境变量 `VIDEO2BLOG_ENGINE` 可设默认值
- **fallback 策略**：`--fallback-policy ask|auto|stop`；默认 `ask`，即 MLX 不可用时询问用户，不静默降级；环境变量 `VIDEO2BLOG_FALLBACK_POLICY` 可设默认值
- **普通 Terminal 执行**：`--run-in-terminal` 会打开 macOS Terminal 重新执行 `--engine mlx --fallback-policy stop`，用于绕开 Codex 沙箱 Metal 限制
- **MLX Whisper 模型**（HF repo）：环境变量 `VIDEO2BLOG_WHISPER_MODEL`，默认见 `video2blog.py`
- **whisper.cpp 模型**（ggml `.bin`）：环境变量 `VIDEO2BLOG_WHISPER_CPP_MODEL`，或命令行 `--whisper-cpp-model`
- **whisper.cpp 命令路径**：默认自动查找 `whisper-cli` / `whisper-cpp` / `main`，也可用 `VIDEO2BLOG_WHISPER_CPP_BIN` 或 `--whisper-cpp-bin` 覆盖
- **外部文字稿**：`--engine external --source <.srt|.vtt|.txt|.md>` 会规整成统一 `.txt` / `.srt` / `.meta.json`
- **审计元数据**：每次成功转录都会写 `<stem>.meta.json`，记录 engine、模型、来源置信度；`external` 会标记 `requires_review=true`
- **支持视频扩展名**：`.mp4`、`.mov`、`.mkv`

## Agent 链（Step 3–8）

- **技能根路径**：`.cursor/skills/video2blog/<step>/SKILL.md`
- **知识库**：`knowledge/`

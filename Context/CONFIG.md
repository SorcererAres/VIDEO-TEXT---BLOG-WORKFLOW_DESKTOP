# 管线配置（可随时改）

## 输入文件根与单次输入文件

### 视频（`ENTRY → video`，由 `video2blog.py` 处理）

- **视频输入文件根**：本机放待转写视频的「收件根目录」。推荐与 shell 环境变量 **`VIDEO2BLOG_INPUT_ROOT`**（或每次命令行 **`--input-root DIR`**）保持一致，例如 `~/Movies/inbox`。
  - 在此根之下，若你使用**相对路径**指定「单次输入文件」或「监听子目录」，脚本会先 `根 + 相对路径` 再解析。
  - 若路径已是**绝对路径**，则不再拼根。
- **单次输入文件**：指**某一个**具体视频文件（`.mp4` / `.mov` / `.mkv`），对应命令行位置参数 `VIDEO`。

### 文字稿（`ENTRY → transcript`，不经 `video2blog.py`）

- **文字稿输入文件根**（建议约定）：例如本仓库的 **`drafts/`**，或你自建的 `~/Notes/transcript-inbox`。Agent 指令里 `SOURCE → path` 推荐写成相对仓库根或绝对路径，避免歧义。

## 路径（与上表配合）

- **视频收件箱（人类语义）**：通常即「视频输入文件根」；若你喜欢根下再分子文件夹，可用相对根的 `VIDEO` 或 `-w 子目录`。
- **脚本产物目录**：默认 **`<视频文件所在目录>/output/`**；亦可用 **`--output-dir`** 强行指定。
- **文字稿备用目录**：见上「文字稿输入文件根」。

## 本地转录（Step 1–2）

- **Whisper 模型**（HF repo）：环境变量 `VIDEO2BLOG_WHISPER_MODEL`，默认见 `video2blog.py`
- **支持视频扩展名**：`.mp4`、`.mov`、`.mkv`

## Agent 链（Step 3–8）

- **技能根路径**：`.cursor/skills/video2blog/<step>/SKILL.md`
- **知识库**：`Knowledge/`

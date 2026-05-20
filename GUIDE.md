# GUIDE.md

## 项目结构

```text
input/       用户输入：Video/ 放视频，Text/ 放文字稿
work/        中转：每个素材一个目录 work/<stem>/
knowledge/   写作知识：STYLE_GUIDE.md + Examples/
memory/      偏好、配置、历史索引、机器指纹
output/      Posts/ 定稿，Reviews/ 质检报告
Archive/     旧规则、旧知识库、设计背景
```

`input/` 是原料，`work/` 是过程，`output/` 是成品，三者不要混用。

## 安装

```bash
brew install ffmpeg
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

本地 ASR 默认使用 `mlx-whisper`，也支持 `whisper.cpp` 和外部字幕/文字稿。
默认开发环境使用 `.venv`；历史 `.venv-codex` 只作兼容，不再作为新任务的首选环境。

## 视频入口

```bash
python3 video2blog.py /path/to/video.mp4
```

默认输出：

```text
work/<stem>/raw.txt
work/<stem>/raw.srt
work/<stem>/raw.log
work/<stem>/meta.json
```

可选：

```bash
export VIDEO2BLOG_INPUT_ROOT=~/Movies/inbox
python3 video2blog.py foo.mp4
python3 video2blog.py -w --fallback-policy auto
python3 video2blog.py --engine external --source transcript.srt placeholder.mp4
```

### 在 Cursor / Codex / Claude Code 里跑

这些 IDE/Agent 的内置终端是沙箱，通常拿不到 Metal，MLX 跑不动。脚本会**自动检测沙箱、用 osascript 开一个普通 macOS Terminal 重跑 mlx-whisper**——你不需要手动加 `--run-in-terminal`，产物照样落 `work/<stem>/`。

禁用自动转：`--no-auto-terminal`，或 `export VIDEO2BLOG_NO_AUTO_TERMINAL=1`。

## Agent 写作

正式长文：

```text
ENTRY → video
MODE → full
ROUTING → /lecture
SOURCE → work/<stem>/raw.txt
```

日常短稿或已有清晰文字稿：

```text
ENTRY → transcript
MODE → quick
SOURCE → input/Text/example.md
```

`ROUTING` 可选：`/default`、`/lecture`、`/dialogue`、`/screencast`、`/meeting`。

## 个人配置

- `memory/PREFERENCES.md`：语言、人称、禁用表达、长度。
- `memory/CONFIG.md`：路径、ASR 引擎、输出约定。
- `memory/HISTORY.md`：最近 10 篇人类索引。
- `memory/fingerprints.jsonl`：机器生成的风格指纹。

## 校验与指纹

```bash
python3 scripts/validate_workflow.py
python3 scripts/update_fingerprint.py output/Posts/2026/example.md
```

校验脚本只做静态检查，不调用模型。

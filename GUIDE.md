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
make install   # 建 .venv 并 pip install -e .（依赖来源唯一：pyproject.toml）
```

本地 ASR 默认使用 `mlx-whisper`，也支持 `whisper.cpp` 和外部字幕/文字稿。
日常开发请优先使用顶层 `Makefile`，所有 Python 入口都会固定走 `.venv/bin/python`。直接用系统 `python3` 可能缺少 FastAPI、uvicorn 等服务端依赖。

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
make validate
python3 scripts/update_fingerprint.py output/Posts/2026/example.md
```

校验脚本只做静态检查，不调用模型。

## 本地开发入口

```bash
make test
make validate
make regression       # mock LLM 跑金标 fixture，验证引擎确定性环节
make frontend-lint
make frontend-build
make server
```

## 本地服务安全边界

FastAPI 服务默认只接受 `localhost` / `127.0.0.1` 来源的浏览器请求。额外允许来源可用 `VIDEO2BLOG_CORS_ORIGINS` 配置，多个来源用逗号分隔。

任务 source 默认必须在仓库根目录内。确需读取外部绝对路径时，先设置 `VIDEO2BLOG_ALLOW_EXTERNAL_SOURCE=1` 再启动服务。

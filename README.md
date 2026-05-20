# 视频/文字稿 → 博文工作流

把口播视频、访谈、讲座、录屏讲解或现成文字稿，改写成**演讲人第一人称**的可发布 Markdown 博文。

这个仓库负责两件事：

- 本地生成原始转录：`video2blog.py` 把视频转成 `work/<stem>/raw.txt|raw.srt|raw.log|meta.json`。
- Agent 写作工作流：按 `WORKFLOW.md` 做清洗、提炼、结构、改写、质检和归档。

`WORKFLOW.md` 是唯一运行合同；README 只帮助人快速理解和上手。

## 适合什么场景

- 把视频课、播客访谈、分享会、会议复盘整理成博客文章。
- 把已有逐字稿、字幕、会议纪要改写成更像作者本人写的文章。
- 保留每篇文章的质检报告、历史索引和风格指纹，方便之后复查和持续迭代。

不适合直接把素材写成观众读后感。默认输出视角永远是“演讲人本人在写”。

## 快速开始

```bash
brew install ffmpeg
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

默认开发环境使用 `.venv`；`.venv-codex` 仅作为历史兼容环境保留。

视频入口：

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

然后在 Codex / Claude Code / 其他 Agent 中给出：

```text
ENTRY → video
MODE → full
ROUTING → /lecture
SOURCE → work/<stem>/raw.txt
```

已有清晰文字稿时，可跳过转录：

```text
ENTRY → transcript
MODE → quick
SOURCE → input/Text/example.md
```

## 两条入口

| 入口 | 适用素材 | 先做什么 | Agent 从哪里接手 |
|---|---|---|---|
| `ENTRY → video` | `.mp4`、`.mov`、`.mkv` | 运行 `python3 video2blog.py <video>` | `work/<stem>/raw.txt` |
| `ENTRY → transcript` | `.txt`、`.md`、`.srt`、已有文章 | 直接准备 `SOURCE` | `input/Text/*`、`work/*/clean.md` 或其他文本路径 |

`MODE` 可选：

- `full`：完整流程，适合正式长文和重要素材。
- `quick`：轻量流程，适合清晰文字稿或小改写。

`ROUTING` 可选：

- `/lecture`：讲座、课程、单人分享。
- `/dialogue`：访谈、对谈，默认嘉宾是“我”。
- `/screencast`：录屏讲解、产品 walkthrough。
- `/meeting`：会议、复盘、决策纪要。
- `/default`：无法明确分类时使用，主声音方是“我”。

## 项目结构

```text
input/       用户输入：Video/ 放视频，Text/ 放文字稿
work/        中转：每个素材一个目录 work/<stem>/
knowledge/   写作知识：STYLE_GUIDE.md + Examples/
memory/      偏好、配置、历史索引、机器指纹
output/      Posts/ 定稿，Reviews/ 质检报告
Archive/     旧规则、旧知识库、设计背景
```

三条边界很重要：

- `input/` 是原料，不放成品。
- `work/` 是过程，不覆盖原始 ASR。
- `output/` 是成品，PASS 与 DRAFT 都写到这里。

## 输出结果

正式通过的文章：

```text
output/Posts/<YYYY>/<YYYY-MM-DD>-<中文短标题>.md
```

用户明确接受的未通过稿：

```text
output/Posts/<YYYY>/DRAFT-<YYYY-MM-DD>-<中文短标题>.md
```

每篇文章对应一份 Review：

```text
output/Reviews/<YYYY-MM-DD>-<中文短标题>.review.md
```

Step 7 只判定 `PASS` 或 `REVIEW`。`DRAFT` 不是质检判定，而是用户明确接受 `REVIEW` 稿后，Step 8 落盘时使用的文件名前缀。

输出目录继续保持英文；只把文章和 Review 文件名改为“日期 + 中文短标题”。中文短标题取自文章标题，去掉文件系统不安全字符和明显标点；同名冲突追加 `-v2`、`-v3`。

## 常用命令

设置视频输入根，之后可以传相对文件名：

```bash
export VIDEO2BLOG_INPUT_ROOT=~/Movies/inbox
python3 video2blog.py foo.mp4
```

监听输入目录：

```bash
python3 video2blog.py -w --fallback-policy auto
```

使用外部字幕或文字稿作为转录源：

```bash
python3 video2blog.py --engine external --source transcript.srt placeholder.mp4
```

静态校验工作流文档和核心产物：

```bash
python3 scripts/validate_workflow.py
```

为文章生成或更新风格指纹：

```bash
python3 scripts/update_fingerprint.py output/Posts/2026/example.md
```

## 配置与记忆

- `memory/PREFERENCES.md`：语言、人称、禁用表达、长度和写作偏好。
- `memory/CONFIG.md`：路径、ASR 引擎、输出约定。
- `memory/HISTORY.md`：最近 10 篇文章的人类可读索引。
- `memory/fingerprints.jsonl`：机器生成的风格指纹，用于 Step 7 风格一致性参考。

Pre-Flight 会扫描 `memory/` 中的占位符。命中 `____`、`YYYY-MM-DD`、`[填写]`、`[TODO]`、`[占位]` 时，Agent 应停止并报告文件与行号。

## 文档导航

| 文档 | 用途 |
|---|---|
| `WORKFLOW.md` | Agent 运行规则，唯一权威 |
| `GUIDE.md` | 安装、目录、命令、常见任务 |
| `AGENTS.md` / `CLAUDE.md` | 工具适配入口 |
| `.codex/skills/video2blog-workflow/SKILL.md` | Codex skill 适配说明 |
| `.cursor/skills/video2blog/` | Step 3-8 子步骤执行细则 |
| `knowledge/STYLE_GUIDE.md` | 文风硬约束 |
| `knowledge/Examples/` | few-shot 范文 |
| `Archive/` | 旧规则与设计背景，只作历史参考 |

## 运行原则

- 运行规则只改 `WORKFLOW.md`，不要在 README、AGENTS 或 CLAUDE 里复制一份新合同。
- 写作必须引用 `knowledge/STYLE_GUIDE.md` 和至少一篇相近范文。
- 正文禁止观看者、编者、跨视频评论视角。
- 原始 ASR 层只追加和保留，不覆盖；清洗稿写 `work/<stem>/clean.md`。
- PASS、REVIEW、DRAFT 的含义以 `WORKFLOW.md` 为准。

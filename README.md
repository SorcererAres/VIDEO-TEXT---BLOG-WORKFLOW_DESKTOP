# 视频/文字稿 → 博文工作流

把「口播视频」或「现成文字稿」改写成**以演讲人第一人称署名**的可发布 Markdown 博文。

听写在本地完成（`mlx-whisper`，零云转录费、不上传音视频）；写作与质检在 Cursor / Codex / Claude Code 里由 Agent 按 SKILL 链跑，复用编辑器内置模型，**主路径不需要 API Key**。

## 它能做什么

- **两种入口**：`video`（跑脚本听写后改写）｜`transcript`（已有逐字稿/纪要，跳过听写直接改写）
- **按体裁路由**：`/lecture` `/dialogue` `/screencast` `/meeting` `/default` → 自动选叙事结构与文风
- **质检后落盘**：六维评分通过才进 `output/Posts/`，附 `output/Reviews/` 报告
- **多宿主同源**：`.cursor` 与 `.codex` 下 SKILL 执行同一条契约驱动的链路

## 快速开始

```bash
# 1. 环境（仅 ENTRY→video 需要）
brew install ffmpeg
pip install -r requirements.txt

# 2. 听写：视频 → 默认落仓库 work/asr/<stem>.{txt,srt,meta.json}
python video2blog.py /path/to/分享.mp4

# 3. 在 Cursor / Codex / Claude Code 里对 work/asr/xxx.txt 下达起手式：
#    ENTRY → video ／ ROUTING → /lecture ／ SOURCE → work/asr/xxx.txt
#    按 .cursor/skills/video2blog/ 的 Step 3–8 端到端跑
```

> 已有文字稿：放 `input/Text/`，跳过第 2 步，`ENTRY → transcript` 从 Step 3 起。
> 完整命令、引擎/fallback、起手式细则见 [`使用说明.md`](使用说明.md)。

## 目录结构（五分）

```
input/      输入侧   Video/(视频,git-ignored) · Text/(文字稿源稿)
knowledge/  写作配方  工作流契约.md · ROUTER.md · Structures/ Styles/ Prompts/
memory/     读侧记忆  PREFERENCES · CONFIG · HISTORY
work/       中转      asr/(原始ASR) · Transcripts/(规整稿)
output/     写侧成品  Posts/<YYYY>/ · Reviews/
```

输入 / 中转 / 输出三侧严格不互串。完整目录地图与数据流见 [`项目结构.md`](项目结构.md)。

## 文档导航

| 文档 | 读者 | 用途 |
|---|---|---|
| **本文 README** | 你 | 一分钟了解 + 快速开始 |
| [`使用说明.md`](使用说明.md) | 你 | 安装、命令、对 Agent 起手式 |
| [`项目结构.md`](项目结构.md) | 你 + Agent | 五分目录速查与数据流 |
| [`knowledge/工作流契约.md`](knowledge/工作流契约.md) | Agent | **运行权威**：五规则 / 八步链 / 路由 / 差异化 |
| [`AGENTS.md`](AGENTS.md) | Agent | 不变量、Pre-Flight、SKILL 链 |
| [`Archive/`](Archive/) | 你 | 设计背景（已归档，不作运行依据） |

## 工作原理

```
input/ ──(video2blog.py 或已有稿)──► work/ ──(Step 3–8 Agent)──► output/
                              ▲ 每步读 knowledge/(配方) + memory/(偏好)
        清洗 → 提要 → 选结构 → 第一人称改写 → 六维质检 → 定稿落盘
```

- **视角铁律**：博文一律以演讲人本人为「我」，禁观看者/编者视角与跨视频引证。
- **运行单一来源**：Agent/SKILL 依赖的硬条款只认 `knowledge/工作流契约.md` 与 `ROUTER.md`。

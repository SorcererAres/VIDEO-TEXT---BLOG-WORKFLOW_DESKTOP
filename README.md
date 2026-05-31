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
make install   # 建 .venv 并 pip install -e .（依赖来源唯一：pyproject.toml）
```

开发、测试和本地服务统一走 `make`，它固定使用 `.venv/bin/python`，避免系统 Python 缺少 FastAPI/uvicorn 等依赖造成误报。
依赖只在 `pyproject.toml` 维护；`requirements.txt` 仅作镜像，供不便 `pip install -e .` 的场景使用。

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
make validate
```

为文章生成或更新风格指纹：

```bash
python3 scripts/update_fingerprint.py output/Posts/2026/example.md
```

本地工程常用入口：

```bash
make test            # .venv/bin/python -m unittest discover -s tests
make validate        # .venv/bin/python scripts/validate_workflow.py
make regression      # mock LLM 跑 tests/fixtures/regression/ 金标 fixture
make frontend-lint   # npm --prefix frontend run lint
make frontend-build  # npm --prefix frontend run build
make server          # 启动 FastAPI 本地服务
make app             # 桌面 App（Tauri 壳）：起后端 + tauri dev
make app-build       # 构建 .app（暂未打包后端 sidecar，运行仍需独立后端）
```

### 桌面 App（Tauri 壳 · macOS 尊重式）

把现有 React 工作台装进 **Tauri 壳**（系统 WKWebView），获得原生窗口：交通灯、统一标题栏、
vibrancy 毛玻璃侧栏、记住窗口尺寸、跟随系统外观（浅/深/自动）、SF 字体、系统强调色、尊重
「降低透明度 / 减弱动态效果」等无障碍开关。

- **前置**：Rust 工具链（`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`）。首次编译耗时数分钟。
- **运行**：`make app`（先确保后端 8765 在跑，再 `tauri dev`）。仍可 `npm run dev` 在浏览器打开做降级开发。
- **当前不做**：把 Python 后端打包成 sidecar 二进制进独立 `.app`（签名公证），留后续阶段——`make app-build` 出的包运行时仍需独立启动后端。

`make regression` 在隔离临时 repo 里用 mock LLM 跑 `tests/fixtures/regression/<name>/`
预置的金标 fixture，验证状态机、frontmatter、`VIEWER_RE`、HISTORY 与 fingerprints
等"确定性环节"不退化；零成本、可入 CI。新增 fixture 直接放
`tests/fixtures/regression/<name>/{fixture.yaml, source.md, expected/<step>.{md,json}}`
即可，无需改脚本。

## 长稿改写：按节滚动（§9-C）

Step 6 默认一次性整篇生成（`single`）。长稿撞窗时切换 sectioned，有两种姿势：

- **本地服务 + UI**（推荐）：`make server` 起 FastAPI，前端 `npm run dev`；
  新建任务时把"长稿按节滚动改写(§9-C)"勾上即可（仅 `full` 模式显示）。
- **全局默认**：在启动 server 之前 `export VIDEO2BLOG_REWRITE_STRATEGY=sectioned`，
  之后所有 job 默认按节。

引擎会解析 Step 5 的 `outline.md`，按"导语 + 正文 N 节 + 收尾"拆 LLM 调用；
每节缓存键独立、上一节末段 400 字喂回做承上启下。骨架不可识别或进入自修正
循环（v>1）时自动回退一次性整篇，不强求按节。

提交 job 前用 `make regression` 兜底——5 个 fixture 覆盖 single / sectioned /
自修正 / 解析失败 / 退人工 五条路径，全 mock 零花费。

本地服务默认只接受 `localhost` / `127.0.0.1` 浏览器来源；任务 source 默认必须位于仓库根目录内。需要额外来源时配置 `VIDEO2BLOG_CORS_ORIGINS`，需要读取仓库外文件时显式设置 `VIDEO2BLOG_ALLOW_EXTERNAL_SOURCE=1`。

CI 使用同一组入口：`make test`、`make validate`、`make frontend-lint`、`make frontend-build`。这些检查不调用真实 LLM，不需要配置 API Key。

## LLM API 配置档（多配置档 · 系统钥匙串）

LLM 配置是**多配置档管理器**：可存多个服务（DeepSeek / OpenAI / 自定义 OpenAI 兼容），各自独立配 Key/模型/参数，可启用·停用，其中一个设为**默认 ★**。API Key **不明文落盘**、不进浏览器，每档一条存进 **macOS 系统钥匙串**（account = `profile:<id>`）。

- **前端 Settings**（推荐）：左侧配置档列表（增删 / 启用开关 / 设默认），右侧详情（身份 / 连接 / 模型 / 生成参数 / 危险区）。选 Provider 预设自动填 Base URL 与推荐模型；粘 Key 保存即写钥匙串；「测试连接」用一句话 ping 验证。
- **建任务时**可在「配置档」选择器里临时切换用哪档；留「跟随默认」即用默认档。
- **环境变量**（优先级最高，headless / CI）：`export VIDEO2BLOG_API_KEY=sk-xxx`，会覆盖所有档的 Key；可选 `VIDEO2BLOG_API_BASE` / `VIDEO2BLOG_MODEL`。

解析链：`request > 环境变量 VIDEO2BLOG_API_KEY > 该档钥匙串`；用哪档：`request.profile_id > defaultProfileId`。非敏感项（名称/provider/base/model/参数/启用）存 config 文件 `~/.config/video2blog/config.json`（schema v2，**不含 Key**）。

从旧版单配置升级时会**自动迁移**：旧 config + 旧钥匙串 `api_key` → 一个名为「默认」的配置档（首次启动服务时幂等执行）。

后端对 Key 全程脱敏：任务对象 `to_dict`、SSE 日志、错误信息都替换成 `***`；`GET /api/llm-profiles` 只返回末四位与来源（`keychain` / `env`），绝不回传明文。首次写钥匙串时 macOS 可能弹一次授权框，点「始终允许」即可。

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

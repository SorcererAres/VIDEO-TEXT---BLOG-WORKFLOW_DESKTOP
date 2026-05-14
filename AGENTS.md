# 视频博文工作流（本仓库）

本文件供 **Cursor Agent**（及同类工具）在项目内遵循；与编辑器模式切换无关：**只要处理「视频→转录→博文」或「文字稿→博文」任务，就先读上下文与下文不变量**。

## 不变量（与架构版一致）

1. **先读**：`Context/PREFERENCES.md`、`Context/CONFIG.md`；若质检需要风格对比再读 `Context/HISTORY.md`。
2. **声明**：起手写出 `ENTRY → video | transcript`、`ROUTING → /default | /lecture | /dialogue | /screencast | /meeting`；文字稿还须 `SOURCE → path`.
3. **技能链**：按 `视频博文工作流-架构版.md` Step 3–8 顺序加载 `.cursor/skills/video2blog/<step>/SKILL.md`，不得默认跳过 Step 4–7。（用户明确免责并标 `DRAFT` 时例外但仍须写出例外原因。）

## Step 映射（Agent）

| Step | SKILL 路径 |
|---|---|
| 3 | `.cursor/skills/video2blog/clean-transcript/SKILL.md` |
| 4 | `.cursor/skills/video2blog/extract-insights/SKILL.md` |
| 5 | `.cursor/skills/video2blog/structure-narrative/SKILL.md` |
| 6 | `.cursor/skills/video2blog/rewrite-blog/SKILL.md` |
| 7 | `.cursor/skills/video2blog/quality-check/SKILL.md` |
| 8 | `.cursor/skills/video2blog/format-output/SKILL.md` |

## 本地脚本（仅此一步不经 Agent）

```bash
pip install -r requirements.txt   # ffmpeg 仍须 brew 安装

# 单次
python video2blog.py /path/to/video.mp4

# 监听
python video2blog.py --watch ~/Movies/inbox
```

产物：`<视频目录>/output/<stem>.{srt,txt}`。随后在此仓库内用 Agent 跑 Step 3–8。

## 权威文档

- `视频博文工作流-架构版.md` — 九层模型、守卫、路由、自检
- `视频自动化工作流方案.md` — 工程性能、风险、可选 API 方案

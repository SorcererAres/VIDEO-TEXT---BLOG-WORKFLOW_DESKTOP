# 管线配置（可随时改）

## 路径

- **视频收件箱**：`~/Movies/inbox`（按你本机实际修改）
- **脚本产物目录**：`<收件箱>/output/`（与《视频自动化工作流方案》一致）
- **文字稿备用目录**（`ENTRY → transcript`）：`drafts/` 或任意路径；以 Agent 指令里 `SOURCE` 为准

## 本地转录（Step 1–2）

- **Whisper 模型**（HF repo）：环境变量 `VIDEO2BLOG_WHISPER_MODEL`，默认见 `video2blog.py` 内常量
- **支持视频扩展名**：`.mp4`、`.mov`、`.mkv`

## Agent 链（Step 3–8）

- **技能根路径**：`.cursor/skills/video2blog/<step>/SKILL.md`
- **知识库**：`Knowledge/`

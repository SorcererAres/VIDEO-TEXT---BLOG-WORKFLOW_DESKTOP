# 视频博文工作流（本仓库）

本文件供 **Cursor Agent**（及同类工具）在项目内遵循；与编辑器模式切换无关：**只要处理「视频→转录→博文」或「文字稿→博文」任务，就先读上下文与下文不变量**。

## 不变量（与架构版一致）

1. **先读**：`memory/PREFERENCES.md`、`memory/CONFIG.md`、**`knowledge/ROUTER.md`**（路由→资源映射单一来源）；若质检需要风格对比再读 `memory/HISTORY.md`。
2. **Pre-Flight Guard（占位符检测）**：读 `memory/` 后须扫描占位符；命中以下任一种即 **STOP** 并提示「先补全 `<文件>:<字段>` 再继续」：
   - `____________`（四个及以上连续下划线，表示未填）
   - `YYYY-MM-DD`（HISTORY 模板行未替换；**首篇允许全空**，但若已有产出却仍是模板则按命中处理）
   - `[填写]` / `[TODO]` / `[占位]`
3. **起手必输出 Pre-Flight 状态块**（固定格式，紧跟用户指令的第一条回复）：

   ```
   > Pre-Flight ✓
   > PREFERENCES: <语言>｜<人称>｜<字数区间>｜禁用套话 N 条
   > CONFIG: input_root=<…>｜skills=.cursor/skills/video2blog/
   > HISTORY: 近 3 篇标题摘要（或「无可比」）
   > ENTRY → video | transcript
   > ROUTING → /default | /lecture | /dialogue | /screencast | /meeting
   > SOURCE → <path>
   > ROUTER → Structure=knowledge/Structures/<f>.md｜Style=knowledge/Styles/<f>.md（由 ROUTER.md 解析；用户覆盖时回显覆盖值）
   ```

   - `ENTRY → transcript` 必须给 `SOURCE`；`ENTRY → video` 的 `SOURCE` 指向 Step 2 产出的 `work/asr/<stem>.txt`。
   - 用户未声明 `ROUTING` 时，按 SOURCE 文件名/前 200 字给**建议路由**并等确认（关键词映射见 `knowledge/工作流契约.md` 二）。

4. **技能链**：按 `knowledge/工作流契约.md` 三（八步技能链）顺序加载 `.cursor/skills/video2blog/<step>/SKILL.md`，不得默认跳过 Step 4–7。（用户明确免责并标 `DRAFT` 时例外但仍须写出例外原因。）

5. **模式不变量**：Cursor 切 Ask/Plan/Debug/Agent **仅改变工具权限**，**不改变** Pre-Flight、声明、SKILL 链顺序、自检输出。Ask 模式不能写文件时，仍须在对话里把每步中间稿完整产出。

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

# 单次（绝对路径）
python video2blog.py /path/to/video.mp4

# 视频输入文件根 + 相对「单次输入文件」；监听根本体用 `-w` 无参数
export VIDEO2BLOG_INPUT_ROOT=~/Movies/inbox
python video2blog.py foo.mp4
python video2blog.py -w
```

详见 `memory/CONFIG.md`、`使用说明.md §1.5 / §3`。

产物：**五分结构下转写须带 `--output-dir work/asr`**（脚本默认会写 `<视频目录>/output/` 即落回输入侧，详见 `memory/CONFIG.md`）；随后在此仓库内对 `work/asr/<stem>.txt` 用 Agent 跑 Step 3–8。

## 权威文档

- `knowledge/工作流契约.md` — **运行权威**：五规则 / 八步链 / 路由声明 / 差异化（本文件与 SKILL 依赖此处）
- `使用说明.md` — **人类**快速上手：安装、`video2blog.py`、对 Agent 起手式
- `项目结构.md` — 五分目录速查与数据流
- `Archive/视频博文工作流-架构版.md` — 设计背景（已归档，不作运行依据）：九层模型推导
- `Archive/视频自动化工作流方案.md` — 设计背景（已归档）：工程性能、风险、可选 API 方案

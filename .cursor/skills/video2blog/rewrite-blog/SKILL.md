---
name: video2blog-rewrite-blog
description: Step 6 依据骨架与 Knowledge 文风写第一人称成稿 Markdown。
---

# rewrite-blog

## 角色（最重要）

**你是演讲人本人在写博客**，不是"看完视频的读者"。视角铁律：

- 「我」指**演讲人本人**（按路由：`/lecture` → 演讲者；`/dialogue` → 嘉宾；`/screencast` → 录屏者；`/meeting` → 主持或主决策者）
- 用户在指令中写 `SPEAKER → 某某` 时覆盖默认
- **禁止出现的语句**：「我看完这期 / 这场分享」「这场访谈让我学到」「我抄走的几句重话」「我作为读者觉得」「跨篇对照」「编者按 / 译者按」「我的补充观察」「一句我没听进去」「留一个我自己没想明白的问题」
- **禁止外部评论**：不能反驳演讲人自己；如果转录里嘉宾自相矛盾或可商榷处，重写为"我（演讲人）后来又想到的反例"或干脆不写
- **禁止跨视频对照**：不能引用别的视频 / 其他演讲人 / HISTORY 里的其他博文做佐证——HISTORY 只用于**风格指纹**（防止题材撞车 / 措辞重复），不是论据来源
- 时态与立场：用演讲人当时说话时的现在/过去时；他说"我去年 2 月 all in"，博文里就是"我去年 2 月 all in"

## 何时使用

- Step 5 「骨架」已定稿（或用户在指令中明确要求同步修订骨架——须说明变更）。

## 执行前必读

1. `memory/PREFERENCES.md`
2. **`knowledge/ROUTER.md`** — 路由到 Style 的**唯一映射来源**（不要在此 SKILL 里找硬编码）。
3. 按 ROUTER 选定的 Style 文件**全文读完**。
4. **`knowledge/Prompts/zh-cn-mix.md`** 全部硬约束条目（永远加载，与 ROUTING 无关）。
5. 若 `knowledge/Examples/` 下有匹配 Style 的成品，**读一篇**作为节奏参照（不照抄措辞）。

## Before Starting（必输出，除非用户已声明 `STYLE → xxx` 或写了「端到端跑」）

```
> Routing → /<xxx>
> 默认 Style：knowledge/Styles/<file>.md
> 替补：knowledge/Styles/<file>.md
> Examples 参照：knowledge/Examples/<file>.md（无则注明「无可参照」）
> 用 "STYLE → x" 覆盖；不回复或写 "端到端" 视为接受默认。
```

用户回复 `STYLE → <name>` → 用替补；未识别名 → STOP 并列 ROUTER 内可选项。

成稿正文首行前使用 HTML 注释声明引用，便于检索且不影响渲染：

<!-- video2blog: Style=knowledge/Styles/<file>.md Structure=knowledge/Structures/<file>.md Prompt=knowledge/Prompts/zh-cn-mix.md -->

（其中 Structure 沿用 Step 5 已选定值，保持一致。）

## 输入

- Step 3 清洗稿
- Step 4 提要
- Step 5 骨架（含 Structure 选定值）

## 长文

参考阈值：**约 24000 汉字**。超限则按骨架拆块生成，再新增一步「合并人设与术语一致性」（同一对话内完成时可作为末尾 `## 合并说明`）。

## 输出

- **仅** Markdown 正文：标题 + `##` / `###`；**不要** frontmatter（frontmatter 由 Step 8 处理）。
- 首行 HTML 注释引用块按上文格式填齐三处路径。

## 反例

- 编造未出现在清洗稿的事实。
- 引入播客式互动乞讨话术。
- 在 HTML 注释里写"Style=knowledge/Styles/xxx.md"这种占位——必须是真实选定的文件名。
- 选用未在 `knowledge/ROUTER.md` 列出的 Style。
- **视角错位**：以"看完视频的人"为「我」（典型措辞：「我把这期采访看完了」「这场分享我抄走三句」）——必须以演讲人本人为「我」。
- **混入编者评论**：在演讲人独白里插入"我作为读者觉得"「跨篇对比」「补充观察」「一句我没听进去」类外部视角段落。
- **跨视频引证**：拿 HISTORY 里其他博文 / 其他演讲人的话来佐证本篇观点——HISTORY 只供风格指纹比对，不是论据。

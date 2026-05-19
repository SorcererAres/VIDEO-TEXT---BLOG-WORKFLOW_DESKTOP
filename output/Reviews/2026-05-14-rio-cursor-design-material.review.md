---
post: Context/Work/Posts/2026/2026-05-14-rio-cursor-design-material.md
source: input/Video/output/BnL5qaBzmR0.txt
entry: video
routing: /dialogue
speaker: Rio（Cursor 设计负责人）
overrides:
  structure: debate
  style: casual-blog
date: 2026-05-14
---

# Review · 2026-05-14-rio-cursor-design-material

## Step 3 清洗摘要

- 原稿来自 `BnL5qaBzmR0.mp4` 的 `mlx-whisper` 转录，整段为无明显换行的一行长文本。
- 已删除主持人广告段、项目现场点评中的低相关细节、口头重复、问答垫话和无意义 filler。
- 已保留 Rio 的核心自述：软件是概念系统、Figma 不是真实材料、设计师应进入代码和 agent 工作流、taste 是对系统细节的体感、设计应被看作 living life form。
- 不确定项：`Famer` 可能是 `Framer`；`Baby Cursor` / `Real OS` 按音译保留语义，不作为标题核心。

## Step 4 提要

## 核心观点（/dialogue）

1. 设计不是搓像素，而是进化软件里的概念、关系和结构。
2. Figma 适合静态状态，但不是真正跑起来的材料；代码才是可被 agent 操作的真实材料。
3. AI 让设计师能绕过部分工程门槛，但不能绕过 taste、判断力和对系统的理解。
4. 未来角色边界会松动，设计师、PM、工程师会在同一个 codebase 和同一组 agent/context 里协作。

## 原话金句

- 「你不是在搓像素，而是在进化这些概念。」
- 「Figma 做这些东西很浅，它不是代码，它不是跑出来的东西，它不真。」
- 「软件在我眼里是一坨概念，概念和概念之间的关系。」
- 「很多 app 一开始就卡在了他们当初最开始设的这些概念上。」
- 「你可以先做东西，再去理解这些事实。」
- 「AI 会让更多人做出东西，但不会自动给你判断力。」
- 「把它当成一个 living life form。」

## 案例与故事

- Rio 的背景：Cursor 设计负责人；曾在 Notion、Stripe、Asana 等公司做设计。
- Notion 办公室和经典家具例子，用来说明好设计接近本质、经得起时间。
- Aqua、Windows XP、扁平化和 Liquid Glass 讨论，用来说明视觉风格背后是概念如何被引入和剥离。
- baby Cursor prototype 例子：用 Electron app + Cursor state/view + CLI 做真实可运行原型，两周完成，传统 Figma 可能要两三个月。
- Dice 点数相加为 7 的例子，用来说明 taste 是能看见细节并产生身体反应。

## 交锋点

- 主持人问题：设计师是否会从像素稿转向可工作系统，最终和 PM/工程师融合成 builder？
- Rio 立场：不一定每个人都变成同一个角色，但职能边界会松动；大家会在同一个 codebase、同一个 agent 和同一份 context 中从不同层进入。

## 待确认项

- [?] `Famer` 可能为 `Framer`，正文未重点使用。
- [?] `Real OS`、`Baby Cursor` 是访谈中提到的具体项目名，未外延解释。

## Step 5 叙事模板

- 沿用 `Knowledge/Structures/debate.md` 的「议程 → 正方理据 → 反方理据 → 我的立场」。
- 引用原文：「我的立场：第一人称收口——同意什么、保留什么疑虑、尚需什么验证。」
- 本文将访谈问答压缩为 Rio 第一人称立场：从 Figma 的局限进入，再讲软件概念系统、agent 工作流、taste 和设计师建议。

## 评分

| 维度 | 分 | 依据 |
|---|---|---|
| 忠实度 | 8/10 | 核心主张、案例和术语均来自转录稿；删除了主持人口播广告和项目点评细枝末节；对 `Framer/Baby Cursor` 等存疑词做了保守处理 |
| 可读性 | 9/10 | 从 Figma 局限、软件概念、AI 工作流、taste、行动建议逐层推进；段落短，适合 Obsidian 和移动端阅读 |
| 观点密度 | 9/10 | 保留了“代码是真材料”“软件是一坨概念”“设计是 living life form”等高密度观点，没有做访谈流水账 |
| 风格一致 | 8/10 | 符合 casual-blog 短句和自然第一人称；技术词保留英文并加空格；比原口播更凝练 |
| 完整性 | 8/10 | Step 4 四个核心观点均已承载；项目点评段只作为设计细节论据处理，没有展开成案例集 |
| 视角忠实度 | 9/10 | 全文「我」= Rio；没有观看者视角、编者按、跨视频引证；少量“如果我只能给设计师一个建议”是 Rio 对听众建议，合规 |
| **合计** | **51/60** | — |

## 判定

PASS

## 修订清单（PASS 下仍可改进）

- 若后续能确认视频标题、嘉宾全名和主持人信息，可补全 `speaker` 字段。
- 若想做更强观点标题，可改为「代码才是设计的新材料」，但当前标题更贴内容。
- 若目标读者是纯设计师，可增加一个「如何开始用 Cursor」的小节；本版为 PM / 独立开发者 / AI 工作流读者做了压缩。

## Re-Brief（必填，引用 AGENTS.md §不变量）

> 1. Context/ 已读：PREFERENCES ✓ / CONFIG ✓ / HISTORY ✓
> 2. ENTRY → `video`、ROUTING → `/dialogue`、SOURCE → `input/Video/output/BnL5qaBzmR0.txt` 已声明 ✓
> 3. clean-transcript 已完成：删除口头重复、主持人广告段、低相关项目点评细节，保留 Rio 主声音 ✓
> 4. Step 5 引用 `Knowledge/Structures/debate.md`；Step 6 引用 `Knowledge/Styles/casual-blog.md` + `Knowledge/Prompts/zh-cn-mix.md` ✓
> 5. 评分判定：PASS；占位符检测：通过 ✓

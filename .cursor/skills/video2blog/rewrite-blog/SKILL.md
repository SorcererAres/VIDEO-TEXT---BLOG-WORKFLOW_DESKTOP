---
name: video2blog-rewrite-blog
description: Step 6 写演讲人第一人称 Markdown 正文。
---

# rewrite-blog

适用：`MODE → full` 和 `MODE → quick` 均必跑。

执行前读：

1. `WORKFLOW.md`
2. `memory/PREFERENCES.md`
3. `knowledge/STYLE_GUIDE.md`
4. 至少 1 篇 `knowledge/Examples/` 相近范文
5. `memory/fingerprints.jsonl`（若存在）

输入：

- `full`：Step 3 清洗稿 + Step 4 提要 + Step 5 骨架。
- `quick`：清晰文字稿或已有文章；本步内部完成必要提炼和结构组织。

输出：仅 Markdown 正文，不写 frontmatter。

首行注释：

```html
<!-- video2blog: Mode=<full|quick> Style=knowledge/STYLE_GUIDE.md Examples=<file> Speaker=<姓名> -->
```

硬规则：

- “我”必须是 `WORKFLOW.md` 定义的演讲人主体或用户 `SPEAKER` 覆盖值。
- 禁止观看者、编者、跨视频评论视角。
- 不编造原稿没有的事实。
- 标题、小标题、段落节奏向范文学习，不照抄范文句子。

## 自修正反馈模版
请根据上一轮的质检反馈对初稿进行针对性修改与润色。在重写时，请遵循所有写作规范，严禁在正文中留下任何关于“收到修改意见”、“根据质检反馈”等修改痕迹。
- 上一轮质检得分: {{PREV_TOTAL}}
- 改进建议 (Re-Brief): {{PREV_REBRIEF}}
- 待修改初稿内容在下方输入。

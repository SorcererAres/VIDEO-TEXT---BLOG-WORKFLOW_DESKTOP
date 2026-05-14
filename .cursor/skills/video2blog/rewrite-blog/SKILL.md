---
name: video2blog-rewrite-blog
description: Step 6 依据骨架与 Knowledge 文风写第一人称成稿 Markdown。
---

# rewrite-blog

## 何时使用

- Step 5 「骨架」已定稿（或用户在指令中明确要求同步修订骨架——须说明变更）。

## 执行前必读

1. `Context/PREFERENCES.md`
2. 按路由择一 **`Knowledge/Styles/`**：
   - `/default` → `casual-blog.md`
   - `/lecture` → `deep-dive.md`
   - `/dialogue` → `casual-blog.md`（可自行改规则；默认偏随笔反思）
   - `/screencast` → `tutorial.md`
   - `/meeting` → `decision-log.md`
3. **`Knowledge/Prompts/zh-cn-mix.md`** 全部硬约束条目。

成稿正文首行前使用 HTML 注释声明引用，便于检索且不影响渲染：

<!-- video2blog: Style=Knowledge/Styles/xxx.md Prompt=Knowledge/Prompts/zh-cn-mix.md -->

## 输入

- Step 3 清洗稿
- Step 4 提要
- Step 5 骨架

## 长文

原方案参考：**约 24000 汉字**超限则按骨架拆块生成，再新增一步「合并人设与术语一致性」（同一对话内完成时可作为本子技能末尾小节 `## 合并说明`）。

## 输出

- **仅**Markdown 正文：标题 + `##` / `###`；不要 frontmatter。

## 反例

- 编造未出现在清洗稿的事实。
- 引入播客式互动乞讨话术。

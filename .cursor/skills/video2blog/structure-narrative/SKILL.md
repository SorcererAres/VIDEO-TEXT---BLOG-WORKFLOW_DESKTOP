---
name: video2blog-structure-narrative
description: Step 5 选定叙事骨架并生成文章提纲（不写正文）。
---

# structure-narrative

## 何时使用

- Step 4 输出已就绪。
- 用户已声明 **`ROUTING → /xxx`**。

## 执行前必读

1. `视频博文工作流-架构版.md` — §4.3 与工作流映射
2. 从以下文件**显性引用一节**到你的输出（路径写进括号）：
   - `/default`：`Knowledge/Structures/pyramid.md`
   - `/lecture`：`Knowledge/Structures/pyramid.md`
   - `/dialogue`：`Knowledge/Structures/debate.md`
   - `/screencast`：`Knowledge/Structures/tutorial-flow.md`
   - `/meeting`：`Knowledge/Structures/scqa.md`

## 输入

- Step 4 全文

## 输出格式

```markdown
## 叙事模板（写明引用）

- （例如：沿用 `Knowledge/Structures/pyramid.md` 的结论先行小节）

## 标题候选（3）

1. …
## 骨架

### 导语

2–3句：钩子 + 本篇交付

### 正文

- `##` 小节1 — 绑定 Step4 条目 …
…

### 收尾

可执行结论 / 待定问题
```

## 反例

- 在此步写成完整段落正文（跳过 Step 6）。

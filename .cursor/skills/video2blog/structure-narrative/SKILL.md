---
name: video2blog-structure-narrative
description: Step 5 选定叙事骨架并生成文章提纲（不写正文）。
---

# structure-narrative

## 何时使用

- Step 4 输出已就绪。
- 用户已声明 **`ROUTING → /xxx`**（可选叠加 `STRUCTURE → xxx`）。

## 执行前必读

1. **`knowledge/ROUTER.md`** — 路由到 Structure 的**唯一映射来源**（不要再去 SKILL 里找硬编码）。
2. `视频博文工作流-架构版.md` — §4.3 工作流差异化要点。
3. 按 ROUTER 选定的 Structure 文件**全文读完**并显性引用。

## 输入

- Step 4 全文

## Before Starting（必输出，除非用户已声明 `STRUCTURE → xxx` 或写了「端到端跑」）

```
> Routing → /<xxx>
> 默认 Structure：knowledge/Structures/<file>.md
> 替补：knowledge/Structures/<file>.md
> 用 "STRUCTURE → x" 覆盖；不回复或写 "端到端" 视为接受默认。
```

用户回复 `STRUCTURE → <name>` → 用替补；写 `端到端` 或不回复 → 用默认；写未识别名 → STOP 并列 ROUTER 内可选项。

## 输出格式

```markdown
## 叙事模板（写明引用）

- 沿用 `knowledge/Structures/<选定文件>.md` 的 <小节名> 小节
- （引用一句该文件原文以证明确实读了）

## 标题候选（3）

1. …

## 骨架

### 导语

2–3 句：钩子 + 本篇交付

### 正文

- `##` 小节 1 — 绑定 Step4 条目 …
…

### 收尾

可执行结论 / 待定问题
```

## 反例

- 在此步写成完整段落正文（跳过 Step 6）。
- 跳过 Before Starting 块直接给骨架——除非用户已显式覆盖或声明端到端。
- 选用未在 `knowledge/ROUTER.md` 列出的文件。

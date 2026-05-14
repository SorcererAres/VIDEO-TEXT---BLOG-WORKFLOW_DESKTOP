---
name: video2blog-format-output
description: Step 8 文件名、可选 frontmatter、落盘说明与 HISTORY 登记表增量。
---

# format-output

## 何时使用

- Step 7 已 `PASS`，或用户接受 `DRAFT` 明示。

## 执行前必读

- `Context/CONFIG.md` 约定目录（与用户最终落盘协商一致）。

## 输出

1. **定稿文件名建议**：`YYYY-MM-DD-主题slug.md` 或沿用视频 stem。
2. **可选 YAML frontmatter**（若 `PREFERENCES` 不允许则跳过）示例：

```yaml
---
title:
date:
ROUTING:
ENTRY:
SOURCE:
PASS_SCORE:
---
```

3. **`Context/HISTORY.md` 增补行草稿**（表格一行 Markdown）。

## 步骤

1. 与用户对齐真实保存路径（本技能不强制执行写盘，除非运行在 Agent mode 且被授权）。
2. 对齐 Obsidian wiki link、静态资源引用规则。

## 反例

- 在未经允许时擅自覆盖已定稿的历史文件。

---
name: video2blog-quality-check
description: Step 7 五维打分，决定去留或标 DRAFT。
---

# quality-check

## 何时使用

- Step 6 已给出完整 Markdown 成稿。
- （推荐）仍可访问 Step 3 清洗稿用于「忠实度」对照。

## 执行前可读

- `Context/HISTORY.md` —— 检视风格是否与近作过于发散（若不适用则说明「无历史可比」）。

## 评分维度（各 1–10，求和）

1. **忠实度**：是否有无依据推断 / 捏造？
2. **可读性**：句长、段落、衔接。
3. **观点密度**：是否浪费读者时间？
4. **风格一致性**：与人设、`PREFERENCES`、所选 Style 的一致性。
5. **完整性**：Step 4 核心观点是否在正文得到承载？

判定：**总分 ≥35/50 → PASS**；否则 **REVIEW**（列出可修项）。  
用户允许低质先行可标 **`DRAFT-`** 前缀，但须在输出声明「未 PASS」。

## 输出格式

```markdown
## 评分

…
## 判定

PASS | REVIEW
## 修订清单（若 REVIEW）

- …
```

## 反例

- 「一律给高分」糊弄过去。

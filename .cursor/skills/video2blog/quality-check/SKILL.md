---
name: video2blog-quality-check
description: Step 7 五维打分，决定去留或标 DRAFT。
---

# quality-check

## 何时使用

- Step 6 已给出完整 Markdown 成稿。
- （推荐）仍可访问 Step 3 清洗稿用于「忠实度」对照。

## 执行前可读

- `memory/HISTORY.md` —— 检视风格是否与近作过于发散（若不适用则说明「无历史可比」）。

## 评分维度（各 1–10，求和）

1. **忠实度**：是否有无依据推断 / 捏造？
2. **可读性**：句长、段落、衔接。
3. **观点密度**：是否浪费读者时间？
4. **风格一致性**：与人设、`PREFERENCES`、所选 Style 的一致性。
5. **完整性**：Step 4 核心观点是否在正文得到承载？
6. **视角忠实度**（一票否决项）：是否严格以**演讲人本人**为「我」执笔？命中任意一条即扣 5 分以上并直接 REVIEW：
   - 出现「我看完了」「这场分享让我」「我抄走的几句」「我作为读者」类观看者视角措辞
   - 插入「编者按 / 译者按 / 补充观察 / 一句我没听进去」类外部评论段落
   - 跨视频对照（引用别的演讲人 / HISTORY 里其他博文作为论据）

判定：**总分 ≥42/60 → PASS**（含视角忠实度）；视角忠实度 ≤5/10 → 一票 REVIEW，不论其他维度多高。  
用户允许低质先行可标 **`DRAFT-`** 前缀，但须在输出声明「未 PASS」。

## 输出格式

```markdown
## 评分

| 维度 | 分 | 依据 |
|---|---|---|
| 忠实度 | x/10 | … |
| 可读性 | x/10 | … |
| 观点密度 | x/10 | … |
| 风格一致 | x/10 | … |
| 完整性 | x/10 | … |
| 视角忠实度 | x/10 | 是否严格以演讲人本人为「我」/有无观看者措辞 / 有无外部评论段 / 有无跨视频引证 |
| **合计** | **xx/60** | — |

## 判定

PASS | REVIEW

## 修订清单（若 REVIEW）

- …

## Re-Brief（必填，引用 AGENTS.md §不变量）

> 1. memory/ 已读：PREFERENCES ✓ / CONFIG ✓ / HISTORY ✓|无可比
> 2. ENTRY → <video|transcript>、ROUTING → /<xxx>、SOURCE → <path> 已声明 ✓
> 3. clean-transcript 已完成（或豁免原因：<…>）✓
> 4. Step 5 引用 knowledge/Structures/<file>.md；Step 6 引用 knowledge/Styles/<file>.md + Prompts/zh-cn-mix.md ✓
> 5. 评分判定：PASS|REVIEW；占位符检测：通过|命中<文件:字段>
```

## 与 Step 8 的衔接

本 Step 的**完整输出**（评分表 + 判定 + 修订清单 + Re-Brief）将被 Step 8 `format-output` 复制到 `output/Reviews/<YYYY-MM-DD>-<slug>.review.md`。因此：

- 不要"口头说一下评分"，必须按上节模板**写全**。
- 评分依据列要言之有物，事后翻 Review 文件时还能看懂。

## 反例

- 「一律给高分」糊弄过去。
- 跳过 Re-Brief 直接交稿——即使 PASS 也须输出该块以便事后审计。
- 评分"依据"列写 `OK` / `合格` 这种无信息词。

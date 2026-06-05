---
name: video2blog-quality-check
description: Step 7 质量检查，决定 PASS 或 REVIEW。
---

# quality-check

适用：`MODE → full` 和 `MODE → quick` 均必跑。

执行前读 `WORKFLOW.md`、`knowledge/STYLE_GUIDE.md`、`memory/HISTORY.md`，并读取 `memory/fingerprints.jsonl`（若存在）。

评分维度各 1-10：

1. 忠实度
2. 可读性
3. 观点密度
4. 风格一致性
5. 完整性
6. 视角忠实度

视角忠实度命中观看者/编者/跨视频视角，直接 `REVIEW`。

输出：

```markdown
## 评分
| 维度 | 分 | 依据 |
|---|---|---|
...
| **合计** | **xx/60** | — |

## 判定
PASS | REVIEW

## 修订清单
- ...

## Re-Brief
> ENTRY / MODE / ROUTING / SOURCE 已声明
> STYLE_GUIDE 和 Examples 已引用
> 指纹比对：已使用|无可比
```

判定：总分 >=42 且视角忠实度 >5 为 PASS，否则为 REVIEW。DRAFT 不是 Step 7 判定；只有用户明确接受 REVIEW 稿时，Step 8 才以 `DRAFT-` 前缀落盘。

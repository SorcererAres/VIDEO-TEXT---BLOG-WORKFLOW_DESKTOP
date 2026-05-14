---
name: video2blog-clean-transcript
description: Step 3 清洗转录/文字稿——去口头禅、合并碎片句、标注不确定段，不改动事实。
---

# clean-transcript

## 何时使用

- `ENTRY → video`：Step 2 已产出 `.txt`；或用户指定 `SOURCE` 为 ASR 文本。
- `ENTRY → transcript`：用户未声明 `SKIP clean` / `light-clean` 时执行完整清洗；若声明 `light-clean` 仅做中英文空格、换行与明显排版修复，并输出「豁免说明」供自检引用。

## 执行前必读

1. 仓库根目录 `Context/PREFERENCES.md`
2. `视频博文工作流-架构版.md` — 控制层规则 3

## 输入

- 原始文本（可内联或文件路径，由用户给出）

## 输出格式

1. `## 清洗稿` — 可读正文，语义忠于原稿。
2. `## 不确定清单` — 逐项 `[?]` 及原因。
3. 若 `light-clean`：附加 `## Step3 豁免` 简述原因与用户原话指令摘要。

## 步骤

1. 删除口头禅与无意义 filler（除非具有语气功能且 `PREFERENCES` 允许）。
2. 合并过短fragment到相邻完整句；保留段落间距。
3. 数字、单位与英文术语：`PREFERENCES` 要求的中英空格。
4. 听辨存疑句：不改编，标注 `[?...]`。
5. **禁止**增补事实、补全未说完整的故事。

## 反例

- 把口述猜测改成确定事实。
- 「润色成一篇漂亮文章」（本步不负责文采，文采留给 Step 6）。

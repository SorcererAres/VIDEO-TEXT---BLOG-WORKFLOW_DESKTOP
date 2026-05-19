# Knowledge Router（路由 → 资源映射，单一来源）

> 本文件是 `ROUTING` 与 `knowledge/Structures/`、`knowledge/Styles/` 之间映射的**唯一来源**。
> SKILL.md 不得再硬编码具体文件名——一律通过本表解析。
> 修改本表后**无需**改任何 SKILL；新增 Structure/Style 只在表里加一行即可。

## 一、默认映射

| ROUTING | 默认 Structure | 默认 Style | 替补 Structure | 替补 Style | 适用信号 |
|---|---|---|---|---|---|
| `/default` | `Structures/pyramid.md` | `Styles/casual-blog.md` | `scqa` | `deep-dive` | 无强信号 |
| `/lecture` | `Structures/pyramid.md` | `Styles/deep-dive.md` | `scqa` | `casual-blog` | 讲座 / 分享 / talk / keynote |
| `/dialogue` | `Structures/debate.md` | `Styles/casual-blog.md` | `pyramid` | `deep-dive` | 访谈 / 对谈 / dialogue / interview |
| `/screencast` | `Structures/tutorial-flow.md` | `Styles/tutorial.md` | `pyramid` | — | demo / 录屏 / screencast / 教学 |
| `/meeting` | `Structures/scqa.md` | `Styles/decision-log.md` | `pyramid` | `casual-blog` | 会议 / 复盘 / 纪要 / standup |

所有路径相对仓库根。

## 二、共用约束（与 ROUTING 无关）

- **Prompt 硬约束**（永远加载）：`knowledge/Prompts/zh-cn-mix.md`
- **风格指纹比对**（Step 7）：`memory/HISTORY.md` 近 10 条
- **视角铁律**：博文一律以「演讲人本人」为「我」，HISTORY **不得**作为论据来源（详见 `memory/PREFERENCES.md`「人称与语气」与本表第二点之二「演讲人主体」）

## 二之二、演讲人主体（Step 5–6 起手必声明）

| ROUTING | 默认「我」= | 备注 |
|---|---|---|
| `/lecture` | 演讲者 | 单方独白型，直接是主讲人 |
| `/dialogue` | **嘉宾**（不是主持人） | 访谈嘉宾是干货输出方；主持人台词进 Step 3 时降权或合并为「我（嘉宾）回应」 |
| `/screencast` | 录屏者 | 录屏时谁在说话谁是「我」 |
| `/meeting` | 主持人或主决策者 | 多方时取「最终拍板」一方 |
| `/default` | 转录稿主声音方 | Agent 须先在 Step 4 提要里标注「主声音 = 某某」 |

**用户覆盖语法**：

```
SPEAKER → 季逍                # 强制本篇以「季逍」作为「我」
SPEAKER → 嘉宾 / 主持人        # 若有歧义可以这样模糊指定
```

Agent 在 Step 6 起手块里**必须回显**最终选定的 SPEAKER。

## 三、用户覆盖语法（SKILL 必须支持）

用户可在起手指令里写以下任一条来覆盖默认：

```
STRUCTURE → scqa            # 等价于 knowledge/Structures/scqa.md
STYLE → deep-dive           # 等价于 knowledge/Styles/deep-dive.md
STRUCTURE → knowledge/Structures/pyramid.md   # 也接受全路径
SPEAKER → 某某              # 覆盖二之二节默认的「演讲人主体」
```

**优先级**：用户指令 > 本表默认。
**未识别值**：SKILL 须 STOP 并列出本表内的可选项，不要"猜一个最近的"。

## 四、Before Starting（Step 5 / Step 6 起手必输出）

在执行前，SKILL 必须输出一段「候选块」给用户确认：

```
> Routing → /lecture
> Default：Structures/pyramid.md + Styles/deep-dive.md
> 替补：Structures/scqa.md / Styles/casual-blog.md
> 用 "STRUCTURE → x" 或 "STYLE → y" 覆盖；不回复视为接受默认，直接端到端。
```

- 用户在指令里已声明 `STRUCTURE/STYLE` → **跳过**该候选块，但仍须**回显**最终选用的两份路径。
- 用户写 `端到端跑` 或 `跳过确认` → 跳过候选块，按默认执行。

## 五、新增条目流程

1. 在 `knowledge/Structures/` 或 `knowledge/Styles/` 加 `<name>.md`
2. 在本表「一、默认映射」加一行或在替补列追加
3. （可选）在 `knowledge/工作流契约.md` 四（工作流差异化）补一句差异化描述

不需要改 `AGENTS.md` 或任何 SKILL.md。

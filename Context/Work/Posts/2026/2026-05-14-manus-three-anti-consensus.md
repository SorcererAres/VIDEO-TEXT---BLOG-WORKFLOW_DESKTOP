---
title: 不训模型、不抢入口、不卷垂直：我们做 Manus 这一年的三个反共识决定
date: 2026-05-14
entry: video
routing: /dialogue
speaker: 季逍（Peak / Yichao Ji）
structure: Knowledge/Structures/pyramid.md
style: Knowledge/Styles/deep-dive.md
source: input/Video/output/Manus Final Interview Before the Acquisition Oh, the Surreal Odyssey of 2025….txt
pass_score: 50/60
---

<!-- video2blog: Style=Knowledge/Styles/deep-dive.md Structure=Knowledge/Structures/pyramid.md Prompt=Knowledge/Prompts/zh-cn-mix.md Speaker=季逍 -->

# 不训模型、不抢入口、不卷垂直：我们做 Manus 这一年的三个反共识决定

我是季逍（Peak / Yichao Ji），Manus 的联合创始人兼首席科学家。过去一年我做了三个反共识的决定，今天把它们摊开讲一下：**不训模型、不抢入口、不卷垂直**。三个决定各反一类主流共识，但放到一起其实是同一个底层信念——**承认自己最不擅长什么**，比承认擅长什么难一万倍。

## 不训模型，反而让所有模型厂帮我们训

我上一段创业是 Magi，做 NLP 知识图谱，全垂直整合——模型自己训、infra 自己写、产品自己做。那五年里我每天醒来都感觉海水在上涨，但你不知道会涨到什么程度——也许第二天醒来已经到鼻子。2019 年我拿到 GPT-3 early access 的那一刻，「天要塌了」——一个 prompt 就跟我训了五年的端到端模型五五开。那次创伤决定了我这一次不再做垂直整合。

「不训模型」是个负面表述，我真正在做的是**正向利用「不训」带来的杠杆**：

- 我们在 Google、Anthropic、OpenAI 每家的 token 消耗量都进入 **Top 2–5**。Agent 工况下 input / output 比是 100:1 到 1000:1，跟 ChatBot 的 3:1 完全不是一个量级——所以我们的 token 账单天然比同 ARR 的对话产品大十倍以上。
- 这个量级带来的副产品是「影响力」。Gemini 上线的那个可控 parallel function calling，proposal 和 schema 是我写的。
- 更进一步——我让用户使用了一个很好的产品，用户付了我的钱，我为用户创造了价值，同时**我通过这个获得了影响力，来影响别人帮我训练很好的模型**。

把这条飞轮拆开看：

```
用户 → 付费给我们
我们 → 把钱变成 token 消耗
token 消耗 → 给模型厂带来收入
收入 + 详细 evaluation / 需求 → 模型厂按 agent 工况进化
进化后的模型 → 反过来让我们更好用
```

整条链上，**我们自己的研发带宽几乎不进入「训模型」这一节**。我把这块固定成本转嫁给了所有模型厂的预训练团队，自己把节省下来的 research bandwidth 拿去做非共识——context engineering、compaction awareness、sandbox 虚拟化。

我经常说一句更狠的：**所有 AI 公司唯一的护城河，是你内部 evaluation 的 taste**。模型厂都能复刻，参数都能 scale，但「在 Gemini 之上挑哪个 benchmark 优化」是不能复刻的——那是你公司的「品味」。

## 不抢入口，靠正向现金流给「第二曲线」造空间

外面讨论 AI 创业总在问「谁是下一个入口」。我们这一年的答卷是：**我们不抢入口**。

为什么敢不抢？

**第一，Monica（Chrome 插件）是我们这家公司的 cash cow**。2024 年我加入蝴蝶（Butterfly，Manus 的母公司）的时候，Monica 已经做到大约 1200 万美金 ARR，正向现金流。**对一个团队，如果有一个正向现金流的产品，你在做第二曲线的决策时会变得非常理智——既大胆又理智**。

**第二，插件的天花板让团队没法躺**。Adblock、Grammarly 这类头部插件 5000 万月活就到顶，相对 Chrome 自己 20 亿日活只占不到 1%。所以 2024 年 4–9 月我们豪赌过一次"AI native 浏览器"——项目代号 Airbnb，browser in browser in the air，15 个人左右，5 个月做出可用版本。

**第三，做完那一刻我意识到不对**。看到 The Browser Company 创始人 Josh Miller 公开宣布 Discontinue Arc 的推文——「我做 Arc 这么久，甚至无法说服我亲戚朋友从 Chrome 换成 Arc」——我们心里那根钉子被钉死了。一句话总结这次自我止损：**一个产品做完你觉得不太酷，就别发**。我们没发。

**第四，也不做 Agent OS**。OS 是圣杯，我不配。OS 严格来说是一个中间层，用户的文件、用户的软件其实不在你这——这是一个客观现象，所以在你没获得这些东西之前，你不要称自己为 OS。

把这四步连起来——正向现金流让我们有底气放弃几乎做完的浏览器，放弃浏览器又让我们抗住了"做 OS 抢入口"的诱惑。最后我们把自己推到了一个更窄但更可控的位置：**做"通用 agent"，但只服务最有支付能力的 prosumer 用户**。

不抢入口的代价是放弃了"广撒网换 DAU"的故事；收益是把每一个用户都当 high-value customer 来服务——**我们追求的不是 DAU，是 agentic hours**。一个高价值用户的用量是普通用户的 1000 倍，这件事每天都在我们后台发生。

## 不卷垂直，押注「通用 agent + 单一架构」的网络效应

「为什么要做通用 agent，不在 niche market 切一刀？」——这是我这一年被反复问的问题。我有三层答案。

**第一层是技术供给**。Manus 的底层就两件事——一个通用 LLM 加一个图灵完备的虚拟机沙盒。**走垂直其实是在上面加约束**，反过来不成立。你做垂直 agent，背后还是要用通用 LLM——那为什么不直接做通用？

**第二层是组合复用**（compositional reuse）。我们每加一个原子能力，都要测它能否跟其他能力组合：

- 加了「看图」能力 → 不只是看自己生成的图，**agent 还学会了自己检查做出来的网页能不能玩**
- 加了「sandbox 调度」能力 → 长出 Wide Research：让 100 个并行 sandbox 同时去找 YC 这一批所有 AI 营销公司 CEO 的 email
- 加了「统一上下文」能力 → 同一 session 里能先 deep research，再做网页，再分析这个网页的流量，再做 PPT，最后发邮件

垂直 agent 永远只能解决「一类问题」，**通用 agent 永远能比垂直 agent 多做一步**。最让我自豪的一个例子是一个分子生物学家——他上传了一个实验仪器导出的小众数据格式，所有别家 AI 都识别失败，但 Manus 自己说"这是个奇怪格式我先去研究一下"，去 GitHub 下了一个开源解析器，然后继续分析。垂直 agent 不会"自己出门找解析器"。

**第三层是「单一架构」原则**。市面上很多自称"通用"的 agent，其实只是把多个垂直产品塞进同一个域名。我们坚持的是 unified agent framework——**一个用户的上下文和记忆，在不同任务之间可以自由流转**。这是技术决策，也是产品决策。

代价当然存在：通用 agent 把"输入责任"还给用户（用户得自己描述任务），垂直 agent 替用户把输入埋好。所以我反复强调一句话——

> Manus 是给非设计师但有设计需求的人用的（不是给设计师用的），所以它跟 Lovart 不是竞争。

翻成 PM 语言是：**我做的是 "enhancement" 型 agent，不做 "replacement" 型 agent**。前者用户不会因为某一环失败就给零分，后者会。

而我心里最重要的一句反主流原则是：

> 不要把人因为「生而为人」的限制赋给 agent。**你应该站在模型的角度去思考问题。**

把 agent 设计成 "设计师 + 程序员 + 经理"这种 multi-agent 分工，是把人类组织的低效（信息损失、协作摩擦）强加给一个本来就比人全能的模型。这是我所说的「人的自恋」。

## 我自己还在反复审的两件事

第一件，**这套飞轮和市场结构高度耦合**。「不训模型 → 给模型厂当锚客 → 让模型厂帮我们训」成立的前提是用户愿意为 token 真金白银付月费 40–200 美金——也就是 prosumer 市场。这也是为什么我们 Manus 选择在 Singapore 注册，上线时只做海外。补贴文化下 agent 公司熬不过模型公司的资本耐力，这套打法跟我选的市场结构是绑死的。

第二件，**compaction awareness 才是下一个真正的瓶颈**：

> 200k 以上的 context 其实就不重要了。比起更长的 context，更重要的是让模型具备 **compaction awareness**——对压缩这件事的意识。

人脑工作记忆很差，但你知道一段信息可以整理到 Notion 里、下次再从那里调回来。这就是 compaction awareness——意识到我现在 context 长了、有些东西可以 offload 到文件系统、有些东西可以压缩成摘要、压缩后不是消失了而是可检索。

为 ChatBot 训练的模型没有为这件事专门训过，结果是 agent 跑长任务时**会感受到一种 context pressure**——EOS token 概率被无形抬高，模型开始疯狂用 bullet point 强行收尾、在内心赶时间。

我赌的是：未来 6–12 个月，谁先把"压缩意识"训进基座模型，谁就能解锁真正"长 horizon"的 agent 工作流。我们现在用 prompt 和 context engineering 在产品层手工实现这件事——这件事一旦下沉到模型层，今天靠 prompt 当壁垒的 agent 公司护城河会立刻被填平。这是我每天醒来要重新审一遍的事。

## 收尾

回到开头那句话。**2025 年的 AI 创业不再是技术比赛、不是融资比赛，而是「谁敢承认自己最不擅长什么」的比赛**。我交的答卷是：我们不会训模型、不擅长抢入口、不打算卷垂直。至少这一年，我用这三个"不擅长"，把这家公司跑到了一亿美金 ARR。

剩下的事就是继续删——每天问自己「今天要删什么」而不是「今天要加什么」。GitHub 那句 `Everything added dilutes everything else`，比"做加法"难一万倍。

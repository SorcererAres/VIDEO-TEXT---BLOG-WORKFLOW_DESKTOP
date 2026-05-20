## 清洗稿

### 开场

AI 让你更像你——我觉得它是个极端放大器。是我认为未来这三年人类历史上最重要的事情。

### Bill 自我介绍

我叫 Bill，中文名孙清云。以前算跟着苗红的 AI researcher，过去七八年也在做投资跟交易。最早我是北大数学本科，之后在 Stanford all in deep learning research。2016 年在 Google Brain 算最早参与发现 Transformer 的一批 researcher，也是世界上第一个把 Transformer architecture 在 Wikipedia 问答 task 上做 work 的——这应该是 Transformer 出现之后做的第二个 task，第一个是英语翻译法语，第二个就是 Wikipedia 问答。当时我的 insight 是你可以用同一个做机器翻译的模型，一行代码不改来做 Question Answering，这可能也是后来 unlock 出 GPT-1 等模型的 insight。

过去这些年也在做一件事：理解怎么用 AI 来做投资跟交易。最早是古典 reinforcement learning，GPT-3 时代的古典 RL——用一个大的 neural network 来 predict 未来的 return。我在千禧年（Millennium）管一个大概 10 亿美金的股票策略，也是做很像 Two Sigma 的量化。两个导师：一个是文艺复兴（Renaissance Technologies）历史上最著名的 Hedge Fund 的 partner，另一个是 BlackRock 的 AI Lab 的 founder 跟现在的 Head。

### 从 GPT-3.5 的震惊到创业

2022 年底看到 GPT-3.5 的时候非常震惊，第一次觉得需要 serious think about life and how the world goes。当时我从零开始花了三年 build 了一个团队，招了 20 个人。2020 到 2023 年在千禧年做 PM，算是他们历史上少数几个从 PhD 直接来的 portfolio manager。

在千禧年做 PM 的时候，日常就是跟 researcher 在 slack 上交流——我 app 他，说研究一下这个数据集，试一下这五个方法，给我一个 report。看到 GPT-3.5 基本上已经能干很多事了，我觉得按照这个进步速度，20 个人都可以换成 AI。现在确实已经换掉了——我的 slack literally 现在 add 一个 AI，说我有这个 idea 你给我回测一下，然后他就全部做完。AI agent 自己来找历史数据、做统计检验、跑回归、做事件研究、回测，然后给一个能够真正做检查的自检报告。

### 量化交易的商品化与主观投资的不可替代性

2023 年我就有了第一次登科的反省：可能 quant hedge fund 的 business 以后会 heavily commoditized——everyone who has the same title model probably do similar things。当时就觉得应该出来创业。

创业做什么？要做一个 AI 现在还理解不了、而且是一条能够走向真正 AGI 的道路。造一个 AI 版的巴菲特、索罗斯——能够做 high conviction trade、option trade，把一部分钱压在一个 compelling 的大 idea 上，赌这个 idea 帮他赚 5 到 10 倍的钱，而不是像做 quant 每天交易几千只股票不断浪烁。真正好的人类投资者是深刻理解一些事情，然后抓到时代的潮流。这件事情现在的 AI 显然做不了。

### 让 AI 研究 AI 是最重要的事

我认为未来这三年人类历史上最重要的事情就是让 AI 自己研究 AI。从 OpenAI、Anthropic、SSI 这些顶级 researcher 的采访可以看到，他们认为最重要的事情就是教 AI 怎么自己研究 AI。等 AI 自己可以 closed loop 研究 AI，不 require 不断 hire 聪明的研究员，只需要加钱加卡加数据，把人类研究员都变成洗数据的 pipes——那基本上就离 AGI 很近了。

和这件事很类似但没有人觉得可行或关心的事，就是造出一个顶级的人类投资者——不是量化交易员，而是真正的好的投资者。这件事 require 很相似的思维过程：深刻认识世界，问出非常精致的好问题，对金融事件模型有深刻理解——geopolitical world 怎么 work，每个公司怎么运转，组织怎么构架。理解这些事情相当于深刻理解人类社会。而且很多数据是 inference time 的 offline data——不在互联网上，也不在 Bloomberg、Refinitiv、FactSet 这些付费公开数据世界里，需要你出去跟人喝咖啡、不断访谈开会。这些 offline 信息怎么 piece together、怎么喂给 AI 成为 AI 的 context——这和 frontier lab 怎么构造来自人类社会的训练数据其实很类似。

### 从 Deep Research 到 SWE 到 ML Scientist 的阶梯

Automate junior 研究员，你就能造出一个 Deep Research。我 2023 年就在造 Deep Research，可能比 OpenAI 早一年。也在很早做 SWE——因为量化需要很多 Rust coding、C++ coding，现在这件事变得不重要了，大家都有了。下一步是造出好的 quant researcher 或者说 ML Engineer——at some point 这件事又会变得不重要。然后你要造出 ML Scientist 和能问出好问题的投资者。你要一步一步 level up the ladder，直到你造了所有 knowledge worker 的能力都 plateau——所有人都拥有了。这时候你问谁能赚钱？你需要造一些不是 Worker 的东西——因为 Worker 本质上是有任务然后完成任务，但需要创造性的工作本质上都不是 Worker，没有可验证标准答案。

什么叫做一个有品位的好问题？什么叫做好的数学家？他关心什么问题。数学千千万万，大家可以不同。人类社会也许能演化出很多不同的数学——虽然数学某种意义上是个真，但可能有的社会特别关注几何体，有的特别关注无限维空间分析体。这是一个品位选择的问题，这种系统不那么容易 converge。所以并不是说一个 frontier lab release 一个 version 就可以干所有的事情。

### Pretrain 是文科教育，RL 是刷题

Pretrain 本质上类似于中国古代的文科教育——你从小就背书，你都根本不理解什么是论语的时候你就先背论语，这不就是 predict next token 吗？本质上就是死记硬背。书读百遍奇异自现。而现在的 RL 基本上就是刷题——o1 刷的是 IOI、IMO 题，跟我们小时候搞竞赛一样；后来 Anthropic 发现不能只刷竞赛题，要刷真实世界的题——怎么写前端、后端、DevOps。Anthropic 现在有暴力的 revenue 增长，因为他在刷真题。但刷完真题以后他还是一个上班人——junior SWE 甚至 senior SWE without 非常强的 business sense。你让他干啥他都能干，但他不会告诉你对于这个 business 你干的事可能不对，他不能说"老板别做了"。

### AI 时代的极端放大器

AI 是个极端放大器，不是让任何人都有平等的工具。AI 让你更像你。

几类人会变得特别强：

1. **痴迷于行业且有顶级洞见的人**：以前是 10X engineer，现在从 10X 变成 100 倍甚至 1000 倍。比如 Andrej Karpathy——一个顶级 researcher 外加教育家，用 AI 不断放大自己的想法，一个人跟 AI 就可以做出很多炫酷的 Auto Research。

2. **能开高线程的老板**：你可以开着 slack 指挥 50 个 AI 干不同的事——你可以把自己的线程开得很高，成为 agent 大型工作团队的人。像 Jason Huang 可以管 100 个 developer report，Elon Musk 可以管更多。

3. **门外汉**：以前完全不懂的 dimension，AI 突然让他懂了。你本来不能写前端、需要招前端工程师，然后发现设计太丑要招设计师，然后设计跟前端不能沟通要招 PM……现在这些东西全部被 collapse——你只要描述想要什么，花时间打磨，它逐渐就能满足你的想法。我从 2023 年开始创业，想找一个人全干，发现找不到这样的人。现在 AI 就变成从头到尾都不需要了。

### ADHD 型和 Asperger 型创始人

Founders 很多很像两种人：一种是 ADHD 型——attention span 很短，sprint 然后不断产生 idea；还有一种是能耐得住寂寞就做一件事——连续 20 年只做一件事，有点像 Asperger 的这种人。AI 始终还是 worker，哪怕 AI automate 掉了某个行业，有顶级品位的构架师做出来的东西绝对不是有 AI 味的那种东西——这种人还是会得 AI 极度的放大。哪怕数学证明被 AI 干完了，有顶级品位的数学家实际上是更有价值的。

### 一人公司的引力

一人公司显然是应该出现的。以 VC、二级市场主观投资为例，这些行业很早本质上就是一人公司——美国有 Ela Q，就是一个人 VC，非常 profitable。很多主观基金乍一看 100 个人，实际上那 100 个人主要功能都是帮老板融资、handle 分析，最终所有决策就是老板一个人拍板。

Research professor 也是——爱因斯坦这些人手下的助理大多数都可以随便 swap，没有在历史上留下重要轨迹。就是那个人最牛逼的思考，放大成了改变人类的科研。

一人公司在这个时代更容易出现，因为很多 finish task 的工作以前需要大规模人类组织才能干，现在 AI 帮着干。而且搭建一个能够脱离地体引力的组织难度越来越高——公司很容易做成一人公司，你要让它 meaningfully 不是一人公司，需要产生非常牛逼的化学效应，至少三到五个很厉害的人一起玩一个东西互相有启发。因为每个人都可以是一人公司，大家蹲在一起不走、为了同一个 mission 做一件事的 bar 变得很高。

### 组织扁平化与信息杠杆

组织的存在是为了有效传达信息。AI agent 之间的信息沟通效率比人传达快多了——他对信息的理解和抓取、通讯效率很高。AI 在组织里承担了信息中介器的作用，然后变成组织信息路由的核心，由它分派任务给前端 AI 或人类。组织变得更扁平。以前压榨人力杠杆把编制变大，现在压榨不了——AI 很高效地做了中间层的信息传递和路由决策，人力堆积杠杆消失了，变成 AI 产生的智力杠杆。

### U 型坍塌：投资的两极化

一人公司有引力——人的能力变强了，AI 把很多工作自动化完成了，总倾向于向一人公司坍塌。但有一个坎：三五个人合在一块才能够把价值放大——他们的智力加起来有被杠杆放大效应的业务，才有可能有投的意义。否则大部分都坍塌回一个人做了。

所以 VC 投资现在很难做。做一个好的 research lab——无论是文艺复兴这种古典的，还是 OpenAI——都产生了组织化学效应，使得每个聪明人进去可以快速继承前人的 institutional knowledge 然后快速开拆。这种复杂度 require 一群很聪明的人为了一个 mission 在一起。但搭这个架子的人 requirement 非常高——需要非常强的心力、融资能力，因为 compute 很贵。

结论：YC 投的团队很惨，因为都是会坍塌回一人公司状态的项目。投资变成了要不融资就 5000 万美金、一个亿、两个亿以上，A 轮就下去，一群最聪明的人聚合起来做很伟大的事情；要不就几十万美金启动，慢慢做，团队就一两三个人。中部公司没有了——软件公司中部的坍塌最厉害。

### 物理世界的 AI 与机器人

物理 AI 包括机器人都还没有跨越 GPT-3 moment——没有看到某条路可以不断加钱走到非常牛逼的地方，也没有看到一条 converge 的 technical path。做 physical AI 创业的融资体感很像 2015 年做自动驾驶——感觉 it's so close，结果 takes 10 years for Waymo to actually work。

机器人一定会加速，因为 AI 可以研究 AI，也可以研究 physical AI 的 soft side problem。但那个口还没打开——需要先把顶盖顶开，能够紧喷以后 AI 才能开始被放大。有一些 concept 的事情我们知道加钱就能搞对的——比如把整个 YouTube 数据搞了，以及比 YouTube 还大一个量级的真实世界有 action 的 video 数据，猛干一个 world model 或 VLA。但从数据的角度并没有一个清晰的 path 能从现实世界踩到这个量级。

要么学出一个 learning efficiency 更接近人的 AI——生下来就有很好的视觉、触觉、控制能力，用很小的数据就能不断习得新技能、习得新动词。我的估计是未来一到两年应该能够做出一个大的 breakthrough，让大家知道这条路是啥。

### 硅基自我复制与无限富足

真正 solve 的标志应该是 physical AI that can manufacture physical AI——你可以发射源头工厂型的 AI，飞到太阳系外面，占一个星系，自己开建工厂，把其他类型的机器人都造出来，用机器人殖民这个星球。现在看起来世界上有两个组织有潜力做这个：中国和 Elon Musk 旗下的公司 cluster。中国作为民用时代的 producer 基本占领了世界所有中低端制造的闭环能力，美国还保有高端制造能力。

如果真的能够让硅机自己开始制造自己，从芯片开始，我们就跨过这个坎，进入一个无限富足的时代。

### 信任无法委托给机器

机器还是无法 delegate trust。我做交易一年 up 14X，LP 这种 trust 只能 delegate 给人。即使一个量化算法 return 1400%，fundamentally 还得跟量化算法的老板交流一下确定这人不是骗子。钱本质上是 hardware——有限 resource 的东西，它的 allocation 很多时候都是人 delegate trust 给另外一个人，或者由人组成的指挥机器的组织。没办法直接 delegate 给机器，因为机器的一件都是同构的——你只要一成本造出一个巨聪明的 AI，可以无限复制，你就没办法选择相信谁。

我不能先创造一个 AI 然后赋予 AI 这个性格，而是说我先本身做一个人，然后用 AI 增强我自己。

### 人类连接与 Attention 的价值

做任何事情都像做媒体——生产软件成本极低，软件都是日抛型的。媒体需要的是 Attention——如何获得其他人类的关注。AI 的 Attention 没什么意义，你需要获得人类的关注。人类关注才有人消费，AI 不会消费我们要用的东西，它只要耗电就好了。

所以人类连接和社群的价值会更加强壮。社交网络价值会更大，把人连接起来的价值会组成不同的异构网络。当 AI 很发达的时候，人类邪教就会繁荣——人需要找更多归属感。到处都是 AI 生成的画面、游戏，如果真的有一个活人出现，不得了。

### Agent 代理网络

不存在 agent 和 agent 之间的社交网络——纯 agent to agent 是极致的效率发现工具，不需要另一个 agent 给他推荐。但会有一种 agent delegate 网络——我们两个都有 agent，它代表我，知道我的品位、喜好、阅读 taste、思考 taste。两个 agent 会互动交换信息，但背后还是人。Agent 高效地把信息互换之后，两个人的交通就变快了。当然有时候还是想看看人——情感留的还是在的。

### GitHub 是新一代社交网络

在以 coding 为核心的 agent 架构里，程序员的喜好和 attention 的权重被大幅放大。以前资本家的喜好比较重要，程序员不重要；现在由于很多东西要通过程序员在 GitHub 上粉你来 distribute，程序员的喜好 largely 决定了这个东西能不能被 distribute、能不能被下一代的机器学到。GitHub 就是一个新一代的人机混合社交网络——AI 大量在用代码做训练写代码，人类在提交代码打星评分。

### Pretrain 是天性，RL 是后天教育

预训练打造了 AI 的天性——天资聪不聪明；强化训练就是后天的大学教育、高中教育，把你训练成一个职业人。预训练好像就决定了上限——你再怎么强化训练，改不了预训练的天性。写笑话或写 rap 的能力从 GPT-3.5 到 4 有点提高，从 4 到现在应该没有任何变化没有提高。

### 25 号宇宙的警示

有两种可能性：一种每个人生下来都跟过去生下来有一个 billion dollar 的人过着一样幸福的生活；另一种世界上 0.1% 的人过着这样幸福的生活，剩下 99.9% 每天刷抖音——只要不造反就 OK。我们现在的加速形态其实更像往第二个形态加速。

99% 的人 ball into 这个 trap——跟现在大家每天看 YouTube、刷抖音、玩游戏很类似。还有 1% 的人往前推进。问题是有什么方法可以让这 1% 变成 50%——让每个有天赋的人即使父母不是那 1%，也能获得成为 1% 的 approach。人类天赋是 evenly distributed over all population，如果只让上一代 lucky 的人的小孩 lucky，很快就衰了。你需要让所有人都获得好的机会和好的教育。

## 不确定清单

- [?] "底门" → 应为"维度"（dimension），ASR 误听
- [?] "诸读百变奇异自现" → 应为"书读百遍其义自见"
- [?] "Andra Capacity" → 应为 Andrej Karpathy
- [?] "Ella Q" → 可能是 Ela Q 或其他拼写，待确认
- [?] "Gross and Dick" → 应为 Grothendieck（格罗滕迪克），著名代数几何学家
- [?] "John Convair" → 可能是 John Conway 或其他投资人名，待确认
- [?] "Andra Capacity" → Andrej Karpathy
- [?] "Elyia" → 应为 Ilya Sutskever（SSI 创始人）
- [?] "Gaia" → 电影中的 AI 电脑名，待确认具体出处
- [?] "27 号宇宙" → 应为"25 号宇宙"（Universe 25，John Calhoun 的老鼠实验）
- [?] "offsize" → 应为 alpha-size 或其他金融术语，待确认
- [?] "Walk forward" → 金融回测术语 walk-forward，确认
- [?] "Gen1" → Physical Intelligence 公司的模型名，确认
- [?] "multibook" → 应为 MultiOn 或其他 agent 产品名，待确认
- [?] "Optima" → 可能指 Optimus（Tesla 机器人），待确认

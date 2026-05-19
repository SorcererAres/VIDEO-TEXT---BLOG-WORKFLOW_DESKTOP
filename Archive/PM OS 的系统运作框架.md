PM OS 的系统运作框架

> 【已归档 · 设计背景】借鉴的分层治理范本，不作运行依据；当前运行约定见 `knowledge/工作流契约.md` 与 `项目结构.md`。

这个系统的核心设计哲学是：用约束代替代码，用 prompt 编排代替程序逻辑。 整个系统没有一行运行时代码，全靠 markdown 结构 + LLM 的 prompt following 能力来驱动。

一、控制层：5 条不可违反的规则
这是整个系统的"宪法"，所有行为都必须在这 5 条规则内运行：

#	规则	设计意图
1
每次响应前读 memory/ 文件
防止 LLM 丢失用户上下文——长对话中模型会"忘记"你是谁、产品是什么
2
PM 请求必须路由到工作流
防止 LLM 直接给泛泛建议——强制走结构化流程，确保建议有框架支撑
3
没有明确许可不产出交付物
防止 LLM 过度主动——PM 最常见的坑是 AI 替你写了你不想要的东西
4
只问一个问题，不替你回答
"记者/间谍法则"——PM 的价值在于自己想清楚，AI 的价值在于问对问题
5
给观点前必须引用 knowledge/ 框架
防止 LLM 给泛泛 PM 建议——你有 300+ 精选框架，不用它们就是浪费
为什么是这 5 条？ 因为这 5 条对抗的是 LLM 做 PM 助手时最常犯的 5 个错：忘上下文、跳流程、过度输出、替用户想、给泛泛建议。

二、守卫层：Context Guard
每次消息 → 读 COMPANY.md + PRODUCTS.md
  │
  ├─ 含占位符 [Company name] / [Product Name]？
  │   └─ STOP → "请先运行 /start"
  │
  └─ 已填写？
      └─ 放行，不再提及 guard
设计意图：防止系统在用户还没设置上下文时就给建议。一个不知道你是谁、做什么产品的 AI 给的 PM 建议比没有更危险。

例外：/feedback 和 /testimonial 不受 Context Guard 限制——因为它们不需要产品上下文。

三、路由层：关键词 → 工作流映射
用户消息
  │
  ├─ 含 "策略/竞争分析/价值链"    → /strategy
  ├─ 含 "机会/OST/机会选择"       → /opportunity
  ├─ 含 "假设/验证/风险"          → /assumptions
  ├─ 含 "访谈/JTBD/实验"          → /research
  ├─ 含 "决策/权衡/可逆性"        → /decisions
  ├─ 含 "利益相关者/权力/沟通"    → /stakeholder
  ├─ 含 "会议/议程/影响力"        → /meeting
  ├─ 含 "文档审阅/多视角"         → /review
  ├─ 含 "教练/复盘/盲点"          → /coaching
  └─ 其他                         → 直接响应（仍受 5 规则约束）
路由后必须：

声明 ROUTING → [工作流名]
读 agents/pm-workflows.md
读并执行对应的 workflow command
只问一个问题，然后等用户回答
四、编排层：工作流 = 技能链
每个工作流是一个有向无环图——技能按顺序执行，上一步输出是下一步输入：

以 /decisions 为例：
Step 1: analyze-root-causes        → 根因图 + 后果树
Step 2: classify-reversibility     → 可逆性分类 + 推荐流程
Step 3: create-decision-journal    → 决策日志草稿
Step 4: mece-analysis              → MECE 选项树
Step 5: structure-recommendation   → 金字塔原理结构化建议
Step 6: define-davci               → DAVCI 决策权矩阵 + 沟通计划
步间控制：默认每步之间确认是否继续；用户说"端到端跑"则跳过确认。

Before starting：每个工作流开头会扫描 knowledge/ 目录，找到 3-5 个相关框架，让用户选择用哪些——这保证了框架不是硬编码的，而是根据具体问题动态匹配。

五、执行层：Skill = 结构化 Prompt
每个 skill 是一个 SKILL.md 文件，本质是一个精心设计的 prompt：

.cursor/skills/analyze-root-causes-and-consequences-from-a-questi/
  └── SKILL.md    ← 包含：角色定义、输入格式、输出格式、思考步骤、示例
205 个 skill 按类别分布：

类别	数量	示例
产品策略
~40
战略内核提取、价值链映射、竞争分析
决策
~15
可逆性分类、MECE、决策日志
用户研究
~30
JTBD、访谈整理、假设验证
利益相关者
~25
权力地图、DAVCI、沟通计划
设计
~15
原型、线框、UX 边界
商业分析
~25
指标诊断、PRD、用户故事
沟通/演示
~15
演示叙事、危机沟通
个人发展
~20
技能掌握、动机日志
项目管理
~10
项目计划、范围防御
求职
~5
STAR 故事、面试掌握
系统
~5
技能浏览器、迁移
六、知识层：knowledge/ = 静态知识库
knowledge/ 不参与执行，但被两个地方引用：

工作流 Before starting → 扫描 knowledge/ 找相关框架，让用户选择
规则 5 → 给观点前必须引用 knowledge/ 里的框架
knowledge/
├── Frameworks/        118个   ← 被 /strategy, /opportunity, /assumptions 引用
├── Prioritization/    50个    ← 被 /decisions, /opportunity 引用
├── Interview-Questions/ 6类   ← 被 /research 引用
├── Writing-Styles/    4个     ← 被 PRD 起草引用
├── Metrics/           41个    ← 被北极星/OKR 相关工作流引用
├── PM Tasks/          25个    ← 会话结束时推荐练习
└── Resources/         260+   ← Lenny 文章索引 + AI 工具指南
七、个性化层：memory/ = 用户记忆
memory/（读）
  ├── COMPANY.md      → 公司名、行业、竞品、融资阶段
  ├── PRODUCTS.md     → 产品名、阶段、核心价值、挑战
  ├── GOALS.md        → 90天目标、赢的定义
  ├── TEAM.md         → PM 级别、团队规模、核心摩擦
  ├── CONSTRAINTS.md  → 资源、技术、时间约束
  └── STAKEHOLDERS.md → 利益相关者画像（可选）
output/（写）
  ├── Decisions/      ← /decisions 输出
  ├── PRDs/           ← PRD 起草输出
  ├── Research/       ← /opportunity, /assumptions 输出
  ├── Reviews/        ← /review 输出
  ├── Strategy/       ← /strategy 输出
  └── Drills/         ← 练习记录
设计意图：每次响应前读 memory/，相当于给 LLM 一个"工作记忆"——它始终知道你是谁、做什么、目标是什么、约束是什么。这比 system prompt 里的静态描述强得多，因为用户可以随时修改。

八、模式不变量：Mode Invariance
Cursor 模式切换（Ask / Plan / Debug / Agent）
  │
  ├─ 改变的：工具权限（Ask 不能写文件，Debug 不能写代码）
  │
  └─ 不变的：5 条规则 + Pre-Flight + 路由 + memory/ 读取
为什么？ 因为 Cursor 的模式 system prompt 会说 "this supersedes any other instructions"——如果不在 AGENTS.md 里硬编码模式不变量，LLM 就会认为切换到 Ask 模式后可以跳过 pre-flight block。

九、自检机制：Self-Rebrief
在两种情况下触发自检：

响应 PM 请求前 — 重新检查 5 条规则
完成大型任务后 — 输出 500+ 词后重新检查
> Re-checking rules after large task:
> 0. Context Guard checked ✓
> 1. Read memory/ files before every response ✓
> 2. Route PM requests through pm-workflows ✓
> 3. No deliverables without explicit permission ✓
> 4. Ask one question — never give the answer ✓
> 5. Cite knowledge/ before any PM opinion ✓
设计意图：长对话中 LLM 会"规则漂移"——越聊越放松约束。自检是在高风险节点（路由前、大输出后）强制拉回来。

总结：系统运作模型
                    ┌─────────────────────┐
                    │   AGENTS.md (宪法)    │
                    │   5 条不可违反规则     │
                    └──────────┬──────────┘
                               │ 约束
                    ┌──────────▼──────────┐
                    │  Context Guard (门卫) │
                    │  上下文未设？→ /start  │
                    └──────────┬──────────┘
                               │ 放行
                    ┌──────────▼──────────┐
                    │  Pre-Flight (安检)    │
                    │  读 memory/ 读侧文件   │
                    │  输出状态块            │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐  ┌─────▼──────┐  ┌──────▼───────┐
     │  PM 请求路由    │  │  核心命令   │  │  直接响应     │
     │  /decisions 等  │  │  /help 等   │  │  (仍受5规则)  │
     └────────┬──────┘  └────────────┘  └──────────────┘
              │
     ┌────────▼──────────────────────────────┐
     │  Workflow 编排 (技能链)                 │
     │  Step1 → Step2 → ... → StepN          │
     │  每步: 读 SKILL.md → 执行 → 传给下一步   │
     │  可选: 引用 knowledge/ 框架增强          │
     └────────┬──────────────────────────────┘
              │
     ┌────────▼──────┐
     │  输出到 output/ │
     │  Decisions/    │
     │  PRDs/         │
     │  Research/     │
     └───────────────┘
一句话总结：PM OS 是一个用 markdown 规则约束 LLM 行为、用 workflow 编排技能链、用 Context 个性化输出、用 Knowledge 增强建议质量的 prompt 工程系统。 它不靠代码运行，靠的是让 LLM 严格遵守一套行为契约。
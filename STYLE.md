# STYLE.md — Video2Blog 桌面应用设计契约

> 这是**本应用自己的**设计决策表(single source of truth)。
> `DESIGN.md` 是 Ollama 网站设计系统**参考**;两者不同,以本文件为准。
> 任何新 UI / 改动必须对齐下面的表。改动前先 grep 违规值,别"看到不一样改一处"。

**基调:macOS Tahoe · Liquid Glass · 全面中性**(2026-06 起;此前的"暖纸 matte + 珊瑚"路线已废弃)。
实现路径:**先 B 后 A** —— 先用 `window-vibrancy`(NSVisualEffectView)把玻璃跑通,满意后再上原生 `NSGlassEffectView`(macOS 26)。

状态:**v2 草案,落地中**。

---

## 表 0 · 材质与 elevation(Tahoe 核心,替代阴影体系)

Tahoe 用**半透明玻璃材质 + 模糊折射**表达层次,**不靠投影**。层级越高 = 玻璃越"实"(模糊半径越小、底色不透明度略高)。

| 层 | 处理 | 用于 |
|---|---|---|
| **L0 桌面透出** | 原生 vibrancy(整窗 NSVisualEffectView)透出桌面 | 窗口主体背景 |
| **L1 玻璃面板** | 半透明 + `backdrop-blur` 叠在 L0 上 | sidebar、toolbar、浮层卡片 |
| **L2 实玻璃控件** | 更不透明的玻璃 pill + 细 hairline 描边 | 按钮、chip、输入、徽章 |
| 降级 | `prefers-reduced-transparency` → 退回中性实底 `--background` | 无障碍 |

**禁用**:`shadow-lg/xl/2xl` 等投影做 elevation(Tahoe 不用投影分层)。仅允许极轻 `shadow-sm` 给玻璃控件描边补一点物理感。

---

## 表 1 · 圆角(对齐 Tahoe + 同心圆角)

| 档 | 值 | Tailwind | 用于 |
|---|---|---|---|
| **pill** | 9999 | `rounded-full` | 小型交互:按钮 / chip / 搜索框 / 单行 input / 徽章 / 顶层导航项 |
| **window/panel** | 12px | `rounded-xl`(=0.75rem) | 窗口级面板、sidebar 玻璃卡片、对话框 |
| **card/control** | 10px | `rounded-lg` | 内层卡片、列表行、代码块、多行 textarea |
| 过渡 | ~8px | `rounded-md` | icon-button hover 块、tooltip、popover |

**同心圆角原则**:内层元素圆角 ≈ 外层圆角 − 内边距。别让 12px 容器里塞 18px 圆角的子元素。
**砍掉**:`rounded-2xl` `rounded-3xl` `rounded-sm`(除 inline code)`rounded-[2px]` `rounded-[3px]` `rounded-[18px]`。

---

## 表 2 · 选中态(全局唯一 = 玻璃高亮)

> Tahoe 选中态走**半透明玻璃高亮**,而非实底色块。中性、克制。

```
选中:  bg-foreground/8（玻璃高亮）  text-foreground  font-medium
未选:  text-foreground/80  hover:bg-foreground/5
icon:  选中/未选都 text-foreground 系（不再 text-primary 珊瑚）
```

**适用**:侧栏导航、设置左 nav、过滤 chip 选中、Segmented、列表选中行——全部同一套。
系统 accent 只用于:focus ring、真正需要吸引点击的主 CTA。

---

## 表 3 · 颜色(中性 + 系统 accent + 语义 token)

**废弃**暖纸珊瑚 `--primary` oklch 暖色。改:

- **中性灰阶**:`--background` / `--card` / `--foreground` / `--muted` 走 macOS 系统中性灰(冷中性,非暖)。玻璃面板用半透明白/黑。
- **强调色 = 系统 accent**:`accent-color: AccentColor`(跟随用户 macOS 强调色)。`--primary` 重定义为系统 accent 蓝(或保留可被系统覆盖)。
- **语义 token**(配 `/15` 浅底给 badge,替换散落裸值):

| token | 含义 | 收敛自 |
|---|---|---|
| `--success` | 已完成 / 在线 / 通过 | emerald-500/400/600(~30 处) |
| `--warning` | 进行中 / 待审批 | amber-500/400/...(~60 处) |
| `--danger` | 失败 / 离线 / 销毁 | = `--destructive` |

**禁用**:`emerald-xxx` `amber-xxx` `blue-xxx` 等裸色值,一律走 token。

---

## 表 4 · 字号(走 DESIGN token,禁任意 px)

| 角色 | token (+ `font-heading` 标题) | px |
|---|---|---|
| 页面大标题 | `text-display-lg font-heading` | 30 |
| 区块标题 | `text-heading-lg / -md / -sm font-heading` | 24/20/18 |
| 正文 | `text-body-md` / `text-body-sm` | 16/14 |
| 辅助 | `text-caption-sm` | 12（最小） |
| 代码/路径 | `text-code-md / -sm font-mono` | 16/14 |
| 按钮 | `text-button-md` | 14 |

**映射**:`text-2xl`→heading-lg、`text-xl`→heading-md、`text-lg`→heading-sm、`text-base`→body-md、`text-sm`→body-sm、`text-xs`→caption-sm。
**禁用** `text-[9/10/11/13px]` 任意值;最小 12px。

> 字体:Tahoe 原生用 SF Pro。标题 `--font-heading`(SF Pro Rounded)、正文 SF Pro Text、代码 SF Mono。

---

## 附录 · macOS 交通灯状态色（系统绘制，留档参考）

窗口左上的红黄绿是 **macOS 系统原生控件**（`NSWindow` standardWindowButton），由系统绘制，我们的代码只用 decorum 调位置（inset 18,28），**不控制颜色**。以下为实测值，仅供其它灰阶取色 / 设计参考：

| 状态 | 红（关闭） | 黄（最小化） | 绿（缩放） |
|---|---|---|---|
| 聚焦 | `#FF5F57` | `#FEBC2E` | `#28C840` |
| 聚焦 + hover | 同上 + `×` | 同上 + `−` | 同上 + `+` / `⤢` |
| **失焦（浅色）** | 填充 `#DADAD9` · 描边 `#D0D0CF`（暖中性灰，三灯同色） | 同 | 同 |

> 注意：CSS 里的 `--color-terminal-red/yellow/green`（`#ff5f56`/`#ffbd2e`/`#27c93f`）是 DESIGN.md「终端 mockup 装饰圆点」色，**不是真窗口控件**，当前未被任何组件使用。

## 落地顺序

1. **STYLE v2**(本文件)✅
2. **Rust vibrancy**:apply_vibrancy + tauri.conf transparent → 玻璃透出桌面
3. **CSS 中性配色**:token 重写(去暖珊瑚)+ 表面半透明 + 语义 token + accent 系统化
4. **收敛批次**:圆角 → 选中态 → 字号,按界面(侧栏→主区→设置→places)grep 替换
5. **后续**:B 满意后探 A(原生 NSGlassEffectView)

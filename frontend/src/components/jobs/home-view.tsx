// Home（问候 + 创作概览 + 启动器 composer）+ 创作概览面板 + 统计单元 + 热力图。
// 从 jobs.tsx 原样搬出，零行为变更。
import { useState, useMemo, useRef } from 'react'
import { Plus, Sparkle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalibrationPanel } from '@/components/places'
import { cn } from '@/lib/utils'
import { type EngineJob } from '@/lib/job-types'

// ═══════════════════ Empty State ═══════════════════
// 离线提示已由顶部全局 OfflineBar 统一承担,这里只保留产品价值文案。
// ═══════════════════ Home（问候 + 创作概览 + 启动器 composer）═══════════════════
// 对齐 Claude 桌面端首页：右侧问候标题 + Overview 卡 + 底部 composer。
// 概览数据全部来自本地 historicalJobs（磁盘成品），真实可算，不造假。

function parseScore(s?: string): number | null {
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*\d+/)
  return m ? parseFloat(m[1]) : null
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// 创作概览（统计 + 热力图）—— IA ③ 后从首页归位到「作品集」。data 全来自本地成品，真实可算。
export function OverviewPanel({ historicalJobs }: { historicalJobs: EngineJob[] }) {
  const stats = useMemo(() => {
    const posts = historicalJobs.filter(j => j.kind === "historical")
    const dates = posts.map(p => p.created_at).filter(Boolean)
    const activeDays = new Set(dates.map(d => d.slice(0, 10))).size
    const now = Date.now()
    const last30 = posts.filter(p => {
      const t = Date.parse(p.created_at)
      return !isNaN(t) && now - t <= 30 * 864e5
    }).length
    const scores = posts.map(p => parseScore(p.pass_score)).filter((n): n is number => n != null)
    const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null
    const drafts = posts.filter(p => p.is_draft).length
    const routingCount = new Map<string, number>()
    posts.forEach(p => routingCount.set(p.request.routing, (routingCount.get(p.request.routing) ?? 0) + 1))
    const topRouting = [...routingCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
    const perDay = new Map<string, number>()
    posts.forEach(p => { const k = p.created_at.slice(0, 10); if (k) perDay.set(k, (perDay.get(k) ?? 0) + 1) })
    return { total: posts.length, activeDays, last30, avgScore, drafts, formal: posts.length - drafts, topRouting, perDay }
  }, [historicalJobs])

  if (stats.total === 0) return null
  return (
    <div className="rounded-xl border bg-card/60 p-5">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        <StatCell label="成品" value={String(stats.total)} />
        <StatCell label="活跃天数" value={String(stats.activeDays)} />
        <StatCell label="近 30 天" value={String(stats.last30)} />
        <StatCell label="平均质检" value={stats.avgScore != null ? `${stats.avgScore.toFixed(0)}/60` : "—"} />
        <StatCell label="常用路由" value={stats.topRouting} mono />
        <StatCell label="正式 / 草稿" value={`${stats.formal} / ${stats.drafts}`} />
      </div>
      <Heatmap perDay={stats.perDay} />
      <p className="text-xs text-muted-foreground/70 mt-3">
        你已写下 <b className="text-foreground">{stats.total}</b> 篇署名博文，覆盖 {stats.activeDays} 个创作日。
      </p>
    </div>
  )
}

export function HomeView({ historicalJobs, onCreate, onOpenLibrary, onOpenSettings, needsKey, healthOffline, composer, onFileDrop }: {
  historicalJobs: EngineJob[]
  onCreate: () => void
  onOpenLibrary: () => void
  onOpenSettings: () => void
  needsKey: boolean
  healthOffline: boolean
  // 底部启动器（inline Launcher）—— 由 App.tsx 注入，HomeView 只负责放在 composer 槽位
  composer: React.ReactNode
  // 整页拖拽落地时回调：HomeView 接管 drop → 把 File 转给 Launcher 走统一 upload 通道
  onFileDrop: (file: File) => void
}) {
  const total = historicalJobs.filter(j => j.kind === "historical").length
  // 首run 引导：没成品且没主动关掉时展示；有成品的老用户自然不出。
  const [guideDismissed, setGuideDismissed] = useState(() => localStorage.getItem("v2b_onboarded") === "1")
  const showGuide = total === 0 && !guideDismissed
  const dismissGuide = () => { localStorage.setItem("v2b_onboarded", "1"); setGuideDismissed(true) }

  // 整页拖拽接管 —— 任意位置拖入文件都走 onFileDrop（→ launcherRef.uploadFile）
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  return (
    <div
      className="app-main flex-1 flex flex-col min-h-0 relative"
      onDragEnter={e => { e.preventDefault(); dragDepth.current += 1; setDragOver(true) }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragOver(false) }}
      onDrop={e => {
        e.preventDefault(); dragDepth.current = 0; setDragOver(false)
        const f = e.dataTransfer.files?.[0]; if (f) onFileDrop(f)
      }}
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-10">
        <div className="max-w-3xl w-full mx-auto flex flex-col gap-6">
          <div>
            {/* Hero 标题用 SF Pro Rounded（font-heading）—— DESIGN.md heading-lg 字号 */}
            <h1 className="flex items-center gap-2.5 text-heading-lg font-semibold tracking-tight font-heading">
              <Sparkle className="size-6 text-primary" />
              {showGuide ? "欢迎 —— 把你讲过的，变成你写的" : "接下来，写点什么？"}
            </h1>
            {total > 0 && (
              <button
                type="button"
                onClick={onOpenLibrary}
                className="mt-3 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                已写下 {total} 篇署名博文 · 去作品集查看 →
              </button>
            )}
          </div>

          {/* 创作概览 + 质检校准（从「作品集」挪到「开始」）—— 有成品才显示 */}
          {total > 0 && <OverviewPanel historicalJobs={historicalJobs} />}
          {total > 0 && <CalibrationPanel historicalJobs={historicalJobs} />}

          {showGuide && (
            <div className="rounded-xl border bg-card/60 p-5 flex flex-col gap-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                把口播视频 / 访谈 / 讲座 / 文字稿，改写成<b className="text-foreground">你本人第一人称署名</b>的可发布博文。和别的工具不一样的地方：
              </p>
              <ul className="text-sm flex flex-col gap-1.5">
                <li className="flex gap-2"><span className="text-primary">·</span>是<b>你的署名长文</b>，不是 AI 的第三人称摘要</li>
                <li className="flex gap-2"><span className="text-primary">·</span>用<b>你的文风</b>（可在「风格」里调）</li>
                <li className="flex gap-2"><span className="text-primary">·</span><b>全程在你机器上</b>，素材不上传、Key 进系统钥匙串</li>
                <li className="flex gap-2"><span className="text-primary">·</span>每步可审、可改、可回退，<b>你说了算</b></li>
              </ul>
              <div className="flex items-center gap-2 flex-wrap">
                {needsKey ? (
                  <>
                    <Button size="sm" onClick={onOpenSettings}>① 先配一个模型</Button>
                    <span className="text-xs text-muted-foreground">填好 API Key，就能开始第一篇</span>
                  </>
                ) : (
                  <Button size="sm" onClick={onCreate} disabled={healthOffline}>
                    <Plus data-icon="inline-start" /> 开始第一篇
                  </Button>
                )}
                <button type="button" onClick={dismissGuide} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto">知道了，不再提示</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部 inline Launcher（启动器） —— 由 App.tsx 注入。
          折叠态长得像 composer 卡片，点击 / 拖入 / ⌘N 触发后原地展开为完整 Launcher。 */}
      <div className="shrink-0 bg-background/80 px-8 py-4">
        <div className="max-w-3xl mx-auto">
          {composer}
          {healthOffline && (
            <p className="text-xs text-destructive/80 mt-2 text-center">后端离线，请先 <code className="text-caption-sm">make server</code> 启动</p>
          )}
        </div>
      </div>

      {/* 整页拖拽落地视觉 */}
      {dragOver && (
        <div className="absolute inset-3 z-20 rounded-xl border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <Plus className="size-5" /> 松手作为本次改写的源
          </div>
        </div>
      )}
    </div>
  )
}

function StatCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5">
      <div className="text-caption-sm uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-heading-sm font-semibold mt-0.5 truncate", mono && "font-mono text-body-md")}>{value}</div>
    </div>
  )
}

// 博文活动热力图 —— 近 10 周每天产出篇数，珊瑚色阶；自绘 CSS grid，不引图表库。
function Heatmap({ perDay }: { perDay: Map<string, number> }) {
  const weeks = 10
  const today = new Date()
  const cells: { key: string; count: number }[] = []
  const start = new Date(today)
  start.setDate(start.getDate() - (weeks * 7 - 1))
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const k = dayKey(d)
    cells.push({ key: k, count: perDay.get(k) ?? 0 })
  }
  // 4 档色阶（参考 GitHub 贡献图）：
  // 空格子用 foreground/[0.08] —— 浅色下 ≈ #ebebeb 比 muted/60 更明显，深色下 ≈ 微亮，两态都看得见。
  // 1/2/3+ 篇按 primary 浓度递增，最深档用满色保持可识别。
  // ring-inset 给单元格细边框，防止相邻空格子在浅色下融成一片。
  const tone = (c: number) =>
    c === 0 ? "bg-foreground/[0.08] ring-1 ring-inset ring-foreground/[0.04]"
    : c === 1 ? "bg-primary/40"
    : c === 2 ? "bg-primary/70"
    : "bg-primary"
  return (
    <div className="mt-4 flex gap-[3px]">
      {Array.from({ length: weeks }).map((_, w) => (
        <div key={w} className="flex flex-col gap-[3px]">
          {cells.slice(w * 7, w * 7 + 7).map(cell => (
            <div
              key={cell.key}
              title={`${cell.key} · ${cell.count} 篇`}
              className={cn("size-2.5 rounded-[3px]", tone(cell.count))}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

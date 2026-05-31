// 顶层"场所"视图：作品集 Library / 风格 Voice。
// ④ 先立骨架（可用但简单），③ 把 Library 做成富作品墙、⑤ 把 Voice 做成文风表单 + 指纹画像。

import { useEffect, useState, type ReactNode } from "react"
import { Award, BookOpen, FileText, Gauge, PenLine, Sparkles } from "lucide-react"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { API_BASE } from "@/lib/api"
import { OverviewPanel } from "@/components/jobs"
import { KnowledgeEditor } from "@/components/settings"
import { formatRelativeOrAbsolute, type EngineJob } from "@/lib/job-types"

// ═══════════════════ 作品集 Library ═══════════════════

function libScore(j: EngineJob): number {
  const m = (j.pass_score || "").match(/(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : -1
}
function libTime(j: EngineJob): number {
  return new Date((j.created_at || "").replace(" ", "T")).getTime() || 0
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-0.5 text-xs rounded-full border transition-colors",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
      )}
    >
      {children}
    </button>
  )
}

// 质检校准：用 P7 处置（直接用/改了/重写）当 ground truth，反查 Step 7 自评分是否过于自信。
// 纯前端 join：dispositions(/api/dispositions) × historicalJobs.pass_score，按处置分桶算质检均值。
const CALIB_ROWS: { key: string; label: string; tone: string }[] = [
  { key: "used", label: "👍 直接用了", tone: "bg-emerald-500" },
  { key: "edited", label: "✍️ 改了改", tone: "bg-amber-500" },
  { key: "rewrote", label: "🔁 重写了", tone: "bg-rose-500" },
]

function CalibrationPanel({ historicalJobs }: { historicalJobs: EngineJob[] }) {
  const [dispo, setDispo] = useState<Record<string, { value?: string } | undefined> | null>(null)
  useEffect(() => {
    let alive = true
    fetch(API_BASE + "/api/dispositions")
      .then(r => (r.ok ? r.json() : {}))
      .then(d => { if (alive) setDispo(d) })
      .catch(() => { if (alive) setDispo({}) })
    return () => { alive = false }
  }, [])

  if (!dispo) return null

  const posts = historicalJobs.filter(j => j.kind === "historical")
  const buckets: Record<string, { n: number; scores: number[] }> = {
    used: { n: 0, scores: [] }, edited: { n: 0, scores: [] }, rewrote: { n: 0, scores: [] },
  }
  for (const job of posts) {
    const v = job.final_post_path ? dispo[job.final_post_path]?.value : undefined
    if (!v || !(v in buckets)) continue
    buckets[v].n += 1
    const s = libScore(job)
    if (s >= 0) buckets[v].scores.push(s)
  }
  const marked = buckets.used.n + buckets.edited.n + buckets.rewrote.n
  const avg = (b: { scores: number[] }) => (b.scores.length ? b.scores.reduce((a, c) => a + c, 0) / b.scores.length : null)
  const u = avg(buckets.used), r = avg(buckets.rewrote)

  let insight: string
  if (u != null && r != null) {
    insight = r >= u - 1
      ? "⚠ 自评分偏乐观：重写稿的质检分并不低于直接采用稿 —— Step 7 可能过度自信，值得收紧阈值或加约束。"
      : "✓ 质检自评分与真实采纳大体一致：越被直接采用的稿子，质检分越高。"
  } else {
    insight = "标记更多篇（尤其『重写了』），这里就能判断质检自评分是否过于自信。"
  }
  if (marked > 0 && marked < 5) insight += "（样本还少，仅供参考）"

  return (
    <div className="rounded-xl border bg-card/60 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="size-4 text-primary" />
        质检校准
        <span className="text-xs font-normal text-muted-foreground">自评分 vs 真实采纳 · 已标记 {marked}/{posts.length}</span>
      </div>
      {marked === 0 ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          在成品页读完标「直接用了 / 改了改 / 重写了」，这里会显示 Step 7 质检自评分在每一类里的均值——
          用你的真实采纳反查质检是否「自我感觉良好」。
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {CALIB_ROWS.map(({ key, label, tone }) => {
              const b = buckets[key]
              const a = avg(b)
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">{label}</span>
                  <span className="w-10 text-xs text-muted-foreground tabular-nums shrink-0">{b.n} 篇</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    {a != null && <div className={cn("h-full rounded-full", tone)} style={{ width: `${(a / 60) * 100}%` }} />}
                  </div>
                  <span className="w-14 text-right text-xs tabular-nums shrink-0">{a != null ? `${a.toFixed(0)}/60` : "—"}</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{insight}</p>
        </>
      )}
    </div>
  )
}

export function LibraryView({
  historicalJobs,
  onOpenJob,
}: {
  historicalJobs: EngineJob[]
  onOpenJob: (id: string) => void
}) {
  const [filter, setFilter] = useState<"all" | "formal" | "draft">("all")
  const [sort, setSort] = useState<"new" | "old" | "score">("new")

  const all = historicalJobs.filter(j => j.kind === "historical")
  const posts = all
    .filter(j => (filter === "all" ? true : filter === "draft" ? j.is_draft : !j.is_draft))
    .sort((a, b) =>
      sort === "new" ? libTime(b) - libTime(a)
      : sort === "old" ? libTime(a) - libTime(b)
      : libScore(b) - libScore(a),
    )

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-8 pt-8 pb-4 shrink-0 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            作品集
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            你攒下的全部成品 · 共 {all.length} 篇。点开任意一篇重读。
          </p>
        </div>

        <OverviewPanel historicalJobs={historicalJobs} />

        {all.length > 0 && <CalibrationPanel historicalJobs={historicalJobs} />}

        {all.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {([["all", "全部"], ["formal", "正式"], ["draft", "草稿"]] as const).map(([k, l]) => (
                <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</FilterChip>
              ))}
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1">
              {([["new", "最新"], ["old", "最早"], ["score", "质检高→低"]] as const).map(([k, l]) => (
                <FilterChip key={k} active={sort === k} onClick={() => setSort(k)}>{l}</FilterChip>
              ))}
            </div>
          </div>
        )}
      </div>

      {all.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
              <EmptyTitle>还没有成品</EmptyTitle>
              <EmptyDescription>开始第一篇改写，这里会长出你的创作轨迹。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          没有符合「{filter === "draft" ? "草稿" : "正式"}」的成品
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 pb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {posts.map(job => (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpenJob(job.id)}
                className="text-left rounded-lg border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-4 flex flex-col gap-2 min-h-[7rem]"
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  {job.is_draft ? (
                    <Badge variant="outline" className="text-[10px] shrink-0">DRAFT</Badge>
                  ) : job.pass_score ? (
                    <span className="text-[10px] text-emerald-600 flex items-center gap-0.5 shrink-0">
                      <Award className="size-3" />{job.pass_score}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm font-medium leading-snug line-clamp-3 flex-1">{job.stem}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span>{formatRelativeOrAbsolute(job.created_at)}</span>
                  {job.request?.routing && <span className="text-muted-foreground/50">· {job.request.routing}</span>}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

// ═══════════════════ 风格 Voice ═══════════════════

interface FingerprintData {
  count: number
  avg_sentence_len: number | null
  avg_paragraph_len: number | null
  per_post: { title: string; avg_sentence_len: number | null; created_at: string }[]
  top_terms: { term: string; posts: number }[]
}

// 文风画像：从 /fingerprints 聚合的「你的写作风格」。自绘走势条 + 词频，不引图表库。
function FingerprintPanel() {
  const [data, setData] = useState<FingerprintData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(API_BASE + "/fingerprints")
      .then(r => r.json())
      .then(d => { if (alive) setData(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  if (failed) return null
  if (!data) return <div className="rounded-xl border bg-card/60 p-4 text-sm text-muted-foreground">载入文风画像…</div>
  if (data.count === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        还没有成品，写完第一篇后这里会长出你的「文风画像」——句长、段落密度、反复在用的词。
      </div>
    )
  }

  const lens = data.per_post.map(p => p.avg_sentence_len ?? 0)
  const maxLen = Math.max(1, ...lens)

  // 词频映射成字号（出现篇数越多越大），纯视觉权重。
  const maxPosts = Math.max(1, ...data.top_terms.map(t => t.posts))

  return (
    <div className="rounded-xl border bg-card/60 p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        你的文风画像
        <span className="text-xs font-normal text-muted-foreground">基于 {data.count} 篇成品</span>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-4 items-end">
        <div className="shrink-0">
          <div className="text-2xl font-semibold tabular-nums">{data.avg_sentence_len ?? "—"}<span className="text-sm font-normal text-muted-foreground ml-1">字</span></div>
          <div className="text-[11px] text-muted-foreground mt-0.5">平均句长</div>
        </div>
        <div className="shrink-0">
          <div className="text-2xl font-semibold tabular-nums">{data.avg_paragraph_len ?? "—"}<span className="text-sm font-normal text-muted-foreground ml-1">字</span></div>
          <div className="text-[11px] text-muted-foreground mt-0.5">平均段长</div>
        </div>

        {/* 句长走势：每篇一根条，按时间正序 */}
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-end gap-[2px] h-10">
            {lens.map((v, i) => (
              <div
                key={i}
                title={`${data.per_post[i].title}：句均 ${v} 字`}
                className="flex-1 min-w-[2px] rounded-t-sm bg-primary/35 hover:bg-primary/70 transition-colors"
                style={{ height: `${Math.max(8, (v / maxLen) * 100)}%` }}
              />
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">句长走势（早 → 近）</div>
        </div>
      </div>

      {data.top_terms.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">你反复在用的词</div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 items-baseline">
            {data.top_terms.map(t => (
              <span
                key={t.term}
                title={`出现在 ${t.posts} 篇里`}
                className="text-muted-foreground hover:text-foreground transition-colors"
                style={{ fontSize: `${0.75 + (t.posts / maxPosts) * 0.6}rem`, opacity: 0.5 + (t.posts / maxPosts) * 0.5 }}
              >
                {t.term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function VoiceView() {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-8 pt-8 pb-4 shrink-0 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <PenLine className="size-5 text-primary" />
            风格
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            别的工具写出来是「AI 的第三人称摘要」；这里写出来是「你的第一人称署名长文」——
            靠的就是下面这套可编辑的文风合同，加上你历史成品沉淀出的风格指纹。
          </p>
        </div>
        <FingerprintPanel />
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">文风合同 · 直接编辑</div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <KnowledgeEditor />
      </div>
    </div>
  )
}

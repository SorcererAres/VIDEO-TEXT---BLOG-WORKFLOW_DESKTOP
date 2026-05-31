// 顶层"场所"视图：作品集 Library / 你的声音 Voice。
// ④ 先立骨架（可用但简单），③ 把 Library 做成富作品墙、⑤ 把 Voice 做成文风表单 + 指纹画像。

import { useEffect, useState, type ReactNode } from "react"
import { Award, BookOpen, FileText, PenLine, Sparkles } from "lucide-react"
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

// ═══════════════════ 你的声音 Voice ═══════════════════

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
            你的声音
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

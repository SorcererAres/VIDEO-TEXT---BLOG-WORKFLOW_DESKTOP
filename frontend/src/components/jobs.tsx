// Jobs 区域全套：状态徽章 / 失败 banner / SSE 灯 / 任务列表 / Home / 任务工作区
// （Outline / DraftReview / Final / Artifacts 子视图）。
// 整段从 App.tsx 搬出，零行为变更。
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus,
  AlertCircle,
  Loader2,
  User,
  DollarSign,
  Copy,
  Edit,
  RotateCw,
  Check,
  X,
  Award,
  Settings,
  Layers,
  ListTree,
  XCircle,
  FolderOpen,
  ExternalLink,
  Sparkle,
  Trash2,
  MoreHorizontal,
  Eye,
  Code as CodeIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { CalibrationPanel } from '@/components/places'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FilterChip } from '@/components/form-primitives'
import { cn } from '@/lib/utils'
import { StepProgress } from '@/components/StepProgress'
import { LogConsole } from '@/components/LogConsole'
import { type ParsedEvent } from '@/lib/log-parser'
import { MarkdownView } from '@/components/MarkdownView'
import { formatRelativeTime } from '@/lib/utils'
import { API_BASE, apiUrl } from '@/lib/api'
import { type TestLLMResult } from '@/lib/settings-store'
import {
  classifyDiagnosis,
  formatRelativeOrAbsolute,
  shortApiBase,
  type EngineJob,
  type ReviewJson,
} from '@/lib/job-types'

// ═══════════════════ Status Badge ═══════════════════
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "queued":
      return <Badge variant="secondary" className="shrink-0">排队中</Badge>
    case "running":
      return (
        <Badge className="shrink-0 bg-info/15 text-info border-info/30 hover:bg-info/15">
          <Loader2 className="animate-spin" />执行中
        </Badge>
      )
    case "paused":
      return <Badge className="shrink-0 bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">待人工审批</Badge>
    case "succeeded":
      return <Badge className="shrink-0 bg-success/15 text-success border-success/30 hover:bg-success/15">已完成</Badge>
    case "draft":
      return <Badge className="shrink-0 bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">DRAFT</Badge>
    case "failed":
      return <Badge variant="destructive" className="shrink-0">失败</Badge>
    default:
      return <Badge variant="outline" className="shrink-0">{status}</Badge>
  }
}

// ═══════════════════ Failure Diagnosis Hook ═══════════════════
// 任务失败时自动用 task 的配置打一次 /api/test-llm,把"配置错还是网络问题"立刻定位。
// 每个 job.id 只跑一次,不重复浪费请求。
function useFailureDiagnosis(job: EngineJob | null): { diagnosis: TestLLMResult | null; isDiagnosing: boolean } {
  const [diagnosis, setDiagnosis] = useState<TestLLMResult | null>(null)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const runForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!job || job.status !== "failed") {
      setDiagnosis(null)
      setIsDiagnosing(false)
      runForRef.current = null
      return
    }
    if (runForRef.current === job.id) return
    runForRef.current = job.id
    setIsDiagnosing(true)
    setDiagnosis(null)

    // api_key 不再从前端取 —— 后端按优先级链（环境变量 > 钥匙串 / config）自行解析。
    const body = {
      api_base: job.request.api_base,
      model: job.request.model,
    }
    fetch(API_BASE + "/api/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async r => {
        if (r.status === 404) {
          return { ok: false, error: "后端版本过旧,/api/test-llm 端点未注册" } as TestLLMResult
        }
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` } as TestLLMResult
        return r.json() as Promise<TestLLMResult>
      })
      .then(data => setDiagnosis(data))
      .catch(e => setDiagnosis({ ok: false, error: String(e) }))
      .finally(() => setIsDiagnosing(false))
  }, [job?.id, job?.status, job])

  return { diagnosis, isDiagnosing }
}

// ═══════════════════ SSE Status Indicator ═══════════════════
// 顶部"实时连接"小灯,告诉用户日志流是否还在,断了多久了,正在重连第几次。
function SseStatusIndicator({
  status,
  lastEventAt,
}: {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "terminal"
  lastEventAt: number | null
}) {
  // 让 "Xs 前" 每秒刷新一次
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== "connected") return
    const t = window.setInterval(() => setTick(n => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [status])

  if (status === "idle" || status === "terminal") return null

  const elapsedSec = lastEventAt != null ? Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000)) : null
  const elapsedLabel = elapsedSec == null
    ? null
    : elapsedSec < 60
      ? `${elapsedSec}s 前`
      : `${Math.floor(elapsedSec / 60)}分钟前`

  let dotClass = "bg-success shadow-[0_0_8px_rgba(16,185,129,0.6)]"
  let textClass = "text-success"
  let label: string

  if (status === "connecting") {
    dotClass = "bg-warning animate-pulse"
    textClass = "text-warning"
    label = "连接中…"
  } else if (status === "reconnecting") {
    dotClass = "bg-warning animate-pulse"
    textClass = "text-warning"
    label = "已断开 · 重连中…"
  } else {
    // connected
    label = elapsedLabel ? `实时 · ${elapsedLabel}` : "实时"
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 border text-caption-sm cursor-default select-none">
          <span className={cn("size-1.5 rounded-full shrink-0", dotClass)} />
          <span className={cn("font-medium tabular-nums", textClass)}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">
          {status === "connected" && "事件流实时连接中"}
          {status === "connecting" && "正在建立事件流"}
          {status === "reconnecting" && "事件流断开,正在按指数退避重连"}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

// ═══════════════════ Failure Banner ═══════════════════
// 任务失败时把 job.error 顶到醒目位置,不让用户在日志里挖。
// 关键体验:**自动归因** —— 用任务的 model/api_base + 本地 api_key 立刻 ping 一次 /api/test-llm,
// 把"是配置错还是网络抽风"这个核心问题在 banner 里直接回答掉。
function FailureBanner({
  error,
  diagnosis,
  isDiagnosing,
  onCopy,
  onRetry,
  onOpenSettings,
}: {
  error: string
  diagnosis: TestLLMResult | null
  isDiagnosing: boolean
  onCopy: (t: string) => void
  onRetry: () => void
  onOpenSettings: () => void
}) {
  // 把诊断结果归类成一句"用户语言"的提示
  const diagnosisHint = useMemo(() => {
    if (!diagnosis) return null
    if (diagnosis.ok) {
      return {
        tone: "neutral" as const,
        title: "LLM 配置本身可用",
        body: `用相同配置 ping 成功 (${diagnosis.latency_ms ?? "?"}ms,model=${diagnosis.model || "?"})。
超时大概率是本次任务级别的问题:提示词过长 / 模型一时负载高 / 或单次响应耗时超过 90s。建议重试。`,
      }
    }
    const cls = classifyDiagnosis(diagnosis.error || "")
    return {
      tone: "actionable" as const,
      title: `根因高度疑似:${cls.kind === "model_not_found" ? "模型名错误"
        : cls.kind === "auth" ? "API Key 错误"
        : cls.kind === "forbidden" ? "权限不足"
        : cls.kind === "rate_limit" ? "速率/配额限制"
        : cls.kind === "missing_key" ? "未配 API Key"
        : cls.kind === "timeout" ? "API 不可达 / 模型可能不存在"
        : "未知"}`,
      body: cls.hint,
    }
  }, [diagnosis])

  return (
    <Alert variant="destructive" className="mt-3">
      <AlertCircle />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>任务失败</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onCopy(error)} className="h-7">
            <Copy data-icon="inline-start" />
            复制错误
          </Button>
          <Button size="sm" onClick={onRetry} className="h-7">
            <RotateCw data-icon="inline-start" />
            以相同参数重跑
          </Button>
        </div>
      </AlertTitle>
      <AlertDescription>
        <pre className="mt-1 text-xs whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
          {error}
        </pre>

        {/* 自动诊断结果区块 —— 把"为什么超时"这个核心问题尽量回答出来 */}
        <div className="mt-3 p-2.5 rounded border bg-card/60">
          <div className="flex items-center gap-2 text-xs font-semibold mb-1">
            <span>🔍 自动诊断</span>
            {isDiagnosing && <Loader2 className="size-3 animate-spin" />}
          </div>
          {isDiagnosing && (
            <div className="text-xs text-muted-foreground">
              正在用任务的 model / api_base + 本地 API Key 调一次 /api/test-llm…
            </div>
          )}
          {!isDiagnosing && !diagnosis && (
            <div className="text-xs text-muted-foreground">
              暂无诊断结果(可能后端版本过旧、缺少 /api/test-llm 端点)。
            </div>
          )}
          {!isDiagnosing && diagnosis && diagnosisHint && (
            <div className="text-xs flex flex-col gap-1.5">
              <div className={cn(
                "font-semibold",
                diagnosisHint.tone === "actionable" ? "text-warning" : "text-success",
              )}>
                {diagnosisHint.title}
              </div>
              <div className="text-foreground/85 whitespace-pre-wrap leading-relaxed">
                {diagnosisHint.body}
              </div>
            </div>
          )}

          {/* 快速修复 —— PR #3 起 launcher 不再支持指定模型覆盖，模型类问题统一去 Settings 改 profile.model。 */}
          {!isDiagnosing && diagnosis && (
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-border/40 flex-wrap">
              <span className="text-caption-sm text-muted-foreground shrink-0">快速修复:</span>
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenSettings}
                className="h-7 text-xs"
              >
                <Settings data-icon="inline-start" />
                去 Settings 改 Profile
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRetry}
                className="h-7 text-xs"
                title="把参数预填到新建框，可改后再跑"
              >
                <Edit data-icon="inline-start" />
                改参数重跑…
              </Button>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

// ═══════════════════ Job List (live + historical) ═══════════════════
// 维度收敛（2026-06）：原本 scope(4) × filter(5) 的正交切面被压成单一 popover —
//   - status: all / needs_me（paused+failed）/ active（running+queued）/ done（succeeded+draft+historical）
//   - timeRange: any / 7d / 30d
//   - sortMode: smart（needs_me 顶置）/ updated / created
// "本会话"维度彻底砍——用户不懂"会话"语义；要找近的就用 timeRange=7d。
export type JobFilter = "all" | "needs_me" | "active" | "done"
export type JobTimeRange = "any" | "7d" | "30d"
export type JobSortMode = "smart" | "updated" | "created"

interface JobListProps {
  liveJobs: EngineJob[]
  historicalJobs: EngineJob[]
  selectedId: string | null
  query: string
  filter: JobFilter
  timeRange: JobTimeRange
  sortMode: JobSortMode
  onSelect: (id: string) => void
  // PR #5：行 hover 出 × 删除。live → 6s Undo Toast；historical → 多选 ConfirmDialog。
  onDelete: (job: EngineJob) => void
}

// 单一 job 时间戳的统一表示（毫秒）：live 用 updated_at / created_at；historical 用 mtime（秒→毫秒）。
function jobUpdatedMs(j: EngineJob): number {
  if (j.kind === "historical") {
    const m = (j as EngineJob & { mtime?: number }).mtime
    return typeof m === "number" ? m * 1000 : 0
  }
  return Date.parse(j.updated_at || j.created_at || "") || 0
}
function jobCreatedMs(j: EngineJob): number {
  if (j.kind === "historical") {
    const m = (j as EngineJob & { mtime?: number }).mtime
    return typeof m === "number" ? m * 1000 : 0
  }
  return Date.parse(j.created_at || "") || 0
}

// 任务是否在"等我"段（paused 等审批 / failed 等修复）
export function isNeedsMe(job: EngineJob): boolean {
  return job.status === "paused" || job.status === "failed"
}

// 智能排序桶序：paused → failed → running → queued → done(succeeded/draft/historical)
function smartBucket(job: EngineJob): number {
  if (job.kind === "historical") return 4
  switch (job.status) {
    case "paused": return 0
    case "failed": return 1
    case "running": return 2
    case "queued": return 2
    default: return 4  // succeeded / draft
  }
}

function matchesJobFilter(job: EngineJob, filter: JobFilter): boolean {
  if (filter === "all") return true
  switch (filter) {
    case "needs_me":
      return isNeedsMe(job)
    case "active":
      return job.status === "running" || job.status === "queued"
    case "done":
      // succeeded 实时任务 + 历史归档 + draft 落盘 都算"已完成"
      return job.status === "succeeded" || job.status === "draft" || job.kind === "historical"
  }
}

function matchesTimeRange(job: EngineJob, range: JobTimeRange): boolean {
  if (range === "any") return true
  const days = range === "7d" ? 7 : 30
  const cutoff = Date.now() - days * 864e5
  return jobUpdatedMs(job) >= cutoff
}

function matchesJobQuery(job: EngineJob, q: string): boolean {
  if (!q) return true
  const lower = q.toLowerCase()
  return (
    job.stem.toLowerCase().includes(lower) ||
    job.request.speaker.toLowerCase().includes(lower) ||
    job.request.routing.toLowerCase().includes(lower)
  )
}

export function JobList({ liveJobs, historicalJobs, selectedId, query, filter, timeRange, sortMode, onSelect, onDelete }: JobListProps) {
  // 历史归档去重：同 path 已经在 live 里出现过的（刚跑完还在内存）就不重复显示
  const livePaths = new Set(liveJobs.map(j => j.final_post_path).filter(Boolean) as string[])
  const dedupedHistorical = historicalJobs.filter(h => !h.final_post_path || !livePaths.has(h.final_post_path))

  const combined: EngineJob[] = [...liveJobs, ...dedupedHistorical]

  // 状态 + 时间 + query 三层过滤
  const filtered = combined.filter(j =>
    matchesJobFilter(j, filter) && matchesTimeRange(j, timeRange) && matchesJobQuery(j, query)
  )

  // 排序：
  //   smart  = 先按桶（等我 → 进行中 → 已完成），桶内 updated 倒序
  //   updated = 全列表按 updated_at 倒序
  //   created = 全列表按 created_at 倒序
  filtered.sort((a, b) => {
    if (sortMode === "smart") {
      const db = smartBucket(a) - smartBucket(b)
      if (db !== 0) return db
      return jobUpdatedMs(b) - jobUpdatedMs(a)
    }
    if (sortMode === "created") return jobCreatedMs(b) - jobCreatedMs(a)
    return jobUpdatedMs(b) - jobUpdatedMs(a)
  })

  const hasAnyRaw = liveJobs.length > 0 || dedupedHistorical.length > 0
  const isFiltering = !!query || filter !== "all" || timeRange !== "any"

  if (!hasAnyRaw) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm px-4">
        还没有任务,从上方"新建"开始。
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm px-4">
        {isFiltering ? "当前过滤下没有匹配的任务" : "没有任务"}
      </div>
    )
  }

  // min-w-0 + w-full：阻断长 stem 沿 flex-col 链反向把 button 撑爆 sidebar 可视宽。
  return (
    <div className="flex flex-col gap-0.5 w-full min-w-0">
      {filtered.map(job => (
        <JobRow
          key={job.id}
          job={job}
          selected={selectedId === job.id}
          onClick={() => onSelect(job.id)}
          onDelete={() => onDelete(job)}
        />
      ))}
    </div>
  )
}

// SectionHeader / StatusPill 已废 —— 改为单一 flat list + StatusDot（Recents 风）。

// Status dot：根据任务状态映射颜色。运行中 / 等待审批用 animate-pulse 呼吸。
function StatusDot({ job }: { job: EngineJob }) {
  const isHistorical = job.kind === "historical"
  const s = job.status
  // 已完成 / 历史归档 / 草稿 → 空心环
  if (isHistorical || s === "succeeded" || s === "draft") {
    return <span className="block size-2 rounded-full border border-foreground/35 shrink-0" />
  }
  // 失败 → 红色实心
  if (s === "failed") {
    return <span className="block size-2 rounded-full bg-destructive shrink-0" />
  }
  // 暂停（等待审批） → 黄色实心 + pulse
  if (s === "paused") {
    return <span className="block size-2 rounded-full bg-warning shrink-0 animate-pulse" />
  }
  // 队列中 / 运行中 → 蓝色实心 + pulse
  if (s === "running" || s === "queued") {
    return <span className="block size-2 rounded-full bg-info shrink-0 animate-pulse" />
  }
  // 兜底：空心环
  return <span className="block size-2 rounded-full border border-foreground/35 shrink-0" />
}

function JobRow({
  job, selected, onClick, onDelete,
}: {
  job: EngineJob; selected: boolean; onClick: () => void;
  onDelete: () => void;
}) {
  // 仿 Claude Recents：左侧 status dot + 单行标题 truncate。timestamp / MODE / status pill 全砍，
  // 完整 meta（路由 / 演讲人 / 评分 / cost / sectioned）下沉到 hover tooltip。
  const isHistorical = job.kind === "historical"
  const strategy = job.request.rewrite_strategy
  const tsLabel = formatRelativeOrAbsolute(job.updated_at || job.created_at)
  const extraMeta = [
    `路由 ${job.request.routing}`,
    job.request.mode === "quick" ? "QUICK" : "FULL",
    strategy === "sectioned" && "sectioned",
    job.pass_score && `评分 ${job.pass_score}`,
    !isHistorical && job.estimated_cost_usd > 0 && `$${job.estimated_cost_usd.toFixed(4)}`,
    job.request.speaker && job.request.speaker !== "我" && `演讲人：${job.request.speaker}`,
    tsLabel && tsLabel,
  ].filter(Boolean) as string[]

  return (
    <div className="relative group w-full min-w-0 max-w-full">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              // pr-8 永远预留 32px 的"右操作槽"——idle 透明、hover 时 × 浮入。
              // 标题 truncate 始终在 pr-8 之前停，× 出现也不会盖到末几个字（原 px-2.5 + 绝对定位的 × 会压标题）。
              "text-left w-full min-w-0 max-w-full h-8 rounded-md overflow-hidden relative pl-2.5 pr-8 flex items-center gap-2 transition-colors",
              selected
                ? "bg-foreground/[0.08]"
                : "hover:bg-foreground/[0.04]",
            )}
          >
            <StatusDot job={job} />
            <span className={cn(
              "flex-1 min-w-0 truncate text-[13px] leading-[20px]",
              selected ? "text-foreground font-medium" : "text-foreground/85",
            )}>
              {job.stem}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" collisionPadding={16} className="max-w-xs">
          <p className="text-xs leading-relaxed break-all">{job.stem}</p>
          {extraMeta.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground mt-1">{extraMeta.join(" · ")}</p>
          )}
        </TooltipContent>
      </Tooltip>

      {/* PR #5 · hover 出删除按钮（保留） */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        onMouseDown={(e) => e.stopPropagation()}
        title={isHistorical ? "删除归档任务…" : "删除任务"}
        aria-label={isHistorical ? "删除归档任务" : "删除任务"}
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 size-6 rounded-md flex items-center justify-center",
          "text-foreground/50 hover:text-destructive hover:bg-destructive/15",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "transition-opacity transition-colors outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
        )}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

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

// ═══════════════════ Job Params Card ═══════════════════
// Workspace 顶部参数行 + 重跑入口。承接 PR #1 的"重跑路径不再走 CreateForm"决策：
//   - 「再跑一遍」直接用 job.request 提交新任务
//   - 「改参数…」浮出 Launcher 预填字段，等用户改完再提交
// 失败时整行加 warning 底色，模型字段加 chip 高亮（最常见的责任字段）。
const ROUTING_LABEL: Record<string, string> = {
  "/lecture": "讲课·分享", "/dialogue": "受访嘉宾", "/screencast": "录屏讲解",
  "/meeting": "主持·决策", "/default": "AI 判断",
}

function JobParamsCard({ job, onRerunSame, onRerunModify, onDelete, healthOffline }: {
  job: EngineJob
  onRerunSame: () => void
  onRerunModify: () => void
  onDelete: () => void
  healthOffline: boolean
}) {
  const r = job.request
  const isHistorical = job.kind === "historical"
  const isFailed = job.status === "failed"
  // running / queued / paused 不显示重跑（任务还活着，不该并发 retry）
  const canRerun = isHistorical || job.status === "succeeded" || isFailed

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs",
      isFailed
        ? "text-foreground/85 bg-warning/[0.08] -mx-2 px-2 py-1.5 rounded-md ring-1 ring-warning/20"
        : "text-muted-foreground"
    )}>
      <span className="flex items-center gap-1"><User className="size-3" /> {r.speaker}</span>
      <span>视角 <code className="text-xs">{ROUTING_LABEL[r.routing] ?? r.routing}</code></span>
      <span title={r.pause_on_outline ? "大纲生成后等审批" : "不暂停，一气呵成跑完"}>
        {r.pause_on_outline ? "⏸ 大纲后审批" : "▶ 一气呵成"}
      </span>
      <span title={r.model || "未指定，后端走配置档默认"}>
        模型 <code className={cn(
          "text-xs",
          !r.model && "text-muted-foreground/60",
          isFailed && "bg-warning/15 px-1 rounded",
        )}>
          {r.model || "档默认"}
        </code>
      </span>
      {r.api_base && (
        <span title={r.api_base}>
          API <code className="text-xs">{shortApiBase(r.api_base)}</code>
        </span>
      )}
      <span className="truncate max-w-[300px]">源 <code className="text-xs">{r.source}</code></span>
      {(job.input_tokens > 0 || job.output_tokens > 0) && (
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            <DollarSign className="size-3 text-success" />
            <span className="font-mono text-success">${job.estimated_cost_usd.toFixed(4)}</span>
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono">
            {(job.input_tokens / 1000).toFixed(1)}k in / {(job.output_tokens / 1000).toFixed(1)}k out
          </span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {canRerun && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRerunSame}
              disabled={healthOffline}
              title={healthOffline ? "后端离线" : "不改参数，再跑一遍"}
              className="h-7 text-xs"
            >
              <RotateCw data-icon="inline-start" />
              再跑一遍
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRerunModify}
              disabled={healthOffline}
              title={healthOffline ? "后端离线" : "把参数预填到新建框，可改后再跑"}
              className="h-7 text-xs"
            >
              <Edit data-icon="inline-start" />
              改参数…
            </Button>
          </>
        )}
        {/* PR #5：删除入口（任何状态都可删；live → 6s undo；historical → 多选弹窗）。 */}
        <MoreMenu
          items={[
            {
              label: isHistorical ? "删除归档…" : "删除任务",
              icon: Trash2,
              destructive: true,
              disabled: healthOffline,
              onSelect: onDelete,
            },
          ]}
        />
      </div>
    </div>
  )
}

// ─── 小型 ⋯ Popover 菜单 ─────────────────────────────────────────────
// JobParamsCard 用：把次要 / 销毁性动作收进 ⋯，避免行内 chip 长度失控。
function MoreMenu({ items }: {
  items: {
    label: string
    icon: React.ComponentType<{ className?: string }>
    onSelect: () => void
    destructive?: boolean
    disabled?: boolean
  }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="更多操作"
          className="size-7"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {items.map((item, i) => {
          const Icon = item.icon
          return (
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect() }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                item.disabled && "opacity-50 cursor-not-allowed",
                !item.disabled && (item.destructive
                  ? "text-destructive hover:bg-destructive/10"
                  : "hover:bg-foreground/[0.05]"),
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// ═══════════════════ Job Workspace ═══════════════════
interface JobWorkspaceProps {
  job: EngineJob
  activeTab: "console" | "outline" | "review" | "final" | "artifacts"
  setActiveTab: (v: "console" | "outline" | "review" | "final" | "artifacts") => void
  events: ParsedEvent[]
  logs: string[]
  currentStep: number | null
  pausedAt: "outline" | "review" | null
  outlineText: string
  setOutlineText: (v: string) => void
  outlineViewMode: "edit" | "preview"
  setOutlineViewMode: (v: "edit" | "preview") => void
  draftContent: string
  reviewJson: ReviewJson | null
  isSubmittingOutline: boolean
  isSubmittingDraft: boolean
  onApproveOutline: () => void
  onApproveDraft: (accept: boolean) => void
  onRefresh: () => void
  onCopy: (text: string) => void
  onCancel: () => void
  onOpenInOS: (path: string, mode: "finder" | "editor") => void
  // PR #3：「改参数重跑」浮出 launcher 预填；「再跑一遍」直接发新任务。
  onRetry: (job: EngineJob) => void
  onRerunSame: (job: EngineJob) => void
  // PR #5：删除任务（live → 6s undo / historical → 多选弹窗）
  onDelete: (job: EngineJob) => void
  healthOffline: boolean
  sseStatus: "idle" | "connecting" | "connected" | "reconnecting" | "terminal"
  lastEventAt: number | null
  outlineDraftRestoredTs: number | null
  onReloadOutlineOriginal: () => void
  setDraftContent: (v: string) => void
  draftViewMode: "edit" | "preview"
  setDraftViewMode: (v: "edit" | "preview") => void
  draftEditRestoredTs: number | null
  onReloadDraftOriginal: () => void
  onOpenSettings: () => void
}

export function JobWorkspace(props: JobWorkspaceProps) {
  const { job, activeTab, setActiveTab, events, logs, currentStep, pausedAt } = props
  const isHistorical = job.kind === "historical"
  const isFailed = job.status === "failed"
  // SSE 指示器只在"还可能在跑"的任务上显示;历史归档 / 已 succeeded / 已 failed 都不要
  const showSseIndicator = !isHistorical && job.status !== "succeeded" && job.status !== "failed"
  // 失败自动归因 —— hook 内部已经做去重,每个 job.id 只跑一次
  const { diagnosis, isDiagnosing } = useFailureDiagnosis(isFailed ? job : null)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-2 border-b">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-heading-md font-bold text-foreground flex items-center gap-2 flex-wrap font-heading">
              <span className="truncate">{job.stem}</span>
              {!isHistorical && (
                <code className="text-xs font-mono text-muted-foreground font-normal">
                  ({job.id.substring(0, 8)})
                </code>
              )}
              <StatusBadge status={job.status} />
              {isHistorical && job.pass_score && (
                <Badge variant="outline" className="text-xs">{job.pass_score}</Badge>
              )}
            </h2>
            <JobParamsCard
              job={job}
              onRerunSame={() => props.onRerunSame(job)}
              onRerunModify={() => props.onRetry(job)}
              onDelete={() => props.onDelete(job)}
              healthOffline={props.healthOffline}
            />
          </div>
          {!isHistorical && (
            <div className="flex items-center gap-2 shrink-0">
              {showSseIndicator && (
                <SseStatusIndicator status={props.sseStatus} lastEventAt={props.lastEventAt} />
              )}
              {(job.status === "running" || job.status === "queued" || job.status === "paused") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={props.onCancel}
                      disabled={props.healthOffline}
                      aria-label="取消任务"
                      className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <XCircle />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {props.healthOffline ? "后端离线,无法取消" : "取消任务(引擎会在下一个 checkpoint 退出)"}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={props.onRefresh} aria-label="刷新状态与日志" className="size-8">
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">刷新状态与日志</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Step progress bar — 历史归档直接全绿(已成品)*/}
        <StepProgress
          mode={job.request.mode as "full" | "quick"}
          jobStatus={isHistorical ? "succeeded" : job.status}
          currentStep={isHistorical ? 8 : currentStep}
          pausedAt={pausedAt}
          hasTranscription={/\.(mp4|mov|m4v|mkv|webm|flv|avi)$/i.test(job.request.source || "")}
          onJump={target => {
            // 历史归档只允许跳 final;非历史可任意跳
            if (isHistorical && target !== "final") return
            setActiveTab(target)
          }}
        />

        {/* 失败 Banner —— job.error 顶到醒目位置 + 自动归因诊断 + 「去 Settings」「改参数重跑」 */}
        {isFailed && (
          <FailureBanner
            error={job.error || "未知错误(后端未返回 error 字段)"}
            diagnosis={diagnosis}
            isDiagnosing={isDiagnosing}
            onCopy={props.onCopy}
            onRetry={() => props.onRetry(job)}
            onOpenSettings={props.onOpenSettings}
          />
        )}
      </div>

      {/* Tabs — 历史归档只暴露"成品及报告"tab(没日志、没暂停产物)*/}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "console" | "outline" | "review" | "final" | "artifacts")} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-3">
          {/* tab 顺序 = 当前最该看的排第一：成品前置 + 人工节点醒目化。
              暂停时审批 tab 居首（轮到你了）；完成时成品居首；过程（日志/产物）降到其后。
              用 paused_state 而非看磁盘内容 —— 旧 draft_v* 残留时启发式会让用户卡在错误审批界面（5/28 撞过两次）。 */}
          <TabsList>
            {!isHistorical && job.status === "paused" && job.paused_state === "WAITING_USER_OUTLINE" && (
              <TabsTrigger value="outline">
                <ListTree data-icon="inline-start" />
                骨架大纲审批
              </TabsTrigger>
            )}
            {!isHistorical && job.status === "paused" && job.paused_state === "WAITING_USER_REVIEW" && (
              <TabsTrigger value="review">
                <Edit data-icon="inline-start" />
                草稿与质检
              </TabsTrigger>
            )}
            {(isHistorical || job.status === "succeeded") && (
              <TabsTrigger value="final">
                <Award data-icon="inline-start" />
                {isHistorical ? "成品归档" : "成品及报告"}
              </TabsTrigger>
            )}
            {!isHistorical && (
              <TabsTrigger value="console">
                <Layers data-icon="inline-start" />
                运行日志
              </TabsTrigger>
            )}
            {!isHistorical && (
              <TabsTrigger value="artifacts">
                <FolderOpen data-icon="inline-start" />
                过程产物
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden px-6 py-4">
          <TabsContent value="console" className="h-full m-0">
            {/* 历史归档不渲染 LogConsole；这里把 jobStatus 传下去让日志事件按 job 整体态降级历史 step / paused */}
            <LogConsole events={events} rawLogs={logs} jobStatus={isHistorical ? "succeeded" : job.status} className="h-full" />
          </TabsContent>

          <TabsContent value="outline" className="h-full m-0">
            <OutlineView {...props} />
          </TabsContent>

          <TabsContent value="review" className="h-full m-0">
            <DraftReviewView {...props} />
          </TabsContent>

          <TabsContent value="final" className="h-full m-0">
            <FinalView job={job} onCopy={props.onCopy} onOpenInOS={props.onOpenInOS} />
          </TabsContent>

          <TabsContent value="artifacts" className="h-full m-0">
            <ArtifactsView job={job} onCopy={props.onCopy} onOpenInOS={props.onOpenInOS} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// ═══════════════════ Outline Edit View ═══════════════════
function OutlineView({ outlineText, setOutlineText, outlineViewMode, setOutlineViewMode, isSubmittingOutline, onApproveOutline, job, healthOffline, outlineDraftRestoredTs, onReloadOutlineOriginal }: JobWorkspaceProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {outlineDraftRestoredTs && (
        <Alert className="border-warning/30 bg-warning/5 py-2">
          <RotateCw className="text-warning" />
          <AlertTitle className="flex items-center justify-between gap-2 text-sm">
            <span>已恢复 {formatRelativeTime(outlineDraftRestoredTs)}的本地编辑</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReloadOutlineOriginal}
              className="h-7 text-xs"
            >
              <X data-icon="inline-start" />
              丢弃,载入后端原始
            </Button>
          </AlertTitle>
        </Alert>
      )}
      <Alert className="border-primary/30 bg-primary/5">
        <ListTree className="text-primary" />
        <AlertTitle className="flex items-center justify-between">
          <span>Step 5 · 骨架大纲审批</span>
          <Button onClick={onApproveOutline} disabled={isSubmittingOutline || healthOffline} size="sm" title={healthOffline ? "后端离线,无法提交" : undefined}>
            {isSubmittingOutline ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
            批准大纲并开始撰写
          </Button>
        </AlertTitle>
        <AlertDescription>
          AI 已生成博文骨架,审查后批准会进入 Step 6 全文撰写。改了就改了,这是你的最后一次结构性干预。
        </AlertDescription>
      </Alert>

      <Card className="flex-1 flex flex-col overflow-hidden">
        {/* plain div 而非 CardHeader —— 后者 grid auto-rows-min 会把子项强制分两行（同 draft 视图） */}
        <div className="pt-0 pb-2.5 px-4 flex items-center justify-between gap-2 shrink-0">
          <code className="text-xs text-muted-foreground truncate min-w-0">work/{job.stem}/outline.md</code>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="inline-flex rounded-md border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setOutlineViewMode("preview")}
                title="预览（Markdown 渲染）"
                aria-label="预览"
                className={cn(
                  "size-6 rounded flex items-center justify-center transition-colors",
                  outlineViewMode === "preview" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                )}
              >
                <Eye className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOutlineViewMode("edit")}
                title="源码（原始 Markdown，可编辑）"
                aria-label="源码"
                className={cn(
                  "size-6 rounded flex items-center justify-center transition-colors",
                  outlineViewMode === "edit" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                )}
              >
                <CodeIcon className="size-3.5" />
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(outlineText)
                  toast.success("已复制全文")
                } catch (e) {
                  toast.error("复制失败", { description: e instanceof Error ? e.message : String(e) })
                }
              }}
              title="复制全文"
              aria-label="复制全文"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
        <CardContent className="p-0 flex-1 overflow-hidden">
          {outlineViewMode === "edit" ? (
            <textarea
              value={outlineText}
              onChange={e => setOutlineText(e.target.value)}
              className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
              spellCheck={false}
            />
          ) : (
            <ScrollArea className="h-full">
              <div className="px-6 py-5 max-w-[70ch] mx-auto">
                <MarkdownView source={outlineText} />
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════ Draft + Review View ═══════════════════
function DraftReviewView({ draftContent, setDraftContent, reviewJson, isSubmittingDraft, onApproveDraft, healthOffline, draftViewMode, setDraftViewMode, draftEditRestoredTs, onReloadDraftOriginal }: JobWorkspaceProps) {
  const parseFailed = reviewJson?.parse_failed === true
  const offlineTitle = healthOffline ? "后端离线,无法提交" : undefined

  return (
    <div className="flex flex-col h-full gap-4">
      {/* 草稿编辑恢复 Banner —— 跟 OutlineView 同款 */}
      {draftEditRestoredTs && (
        <Alert className="border-warning/30 bg-warning/5 py-2">
          <RotateCw className="text-warning" />
          <AlertTitle className="flex items-center justify-between gap-2 text-sm">
            <span>已恢复 {formatRelativeTime(draftEditRestoredTs)}的本地编辑</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReloadDraftOriginal}
              className="h-7 text-xs"
            >
              <X data-icon="inline-start" />
              丢弃,载入后端原始
            </Button>
          </AlertTitle>
        </Alert>
      )}

      {/* Banner — 区分 parse_failed 和正常 REVIEW */}
      {parseFailed ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 质检系统失效,请人工裁判</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-success text-white hover:bg-success/90">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受并以 DRAFT 落盘
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            LLM 没按合同输出评分表,引擎跳过了自修正,把决定权交给你。读右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受"会一并回写后端。
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-warning/40 bg-warning/5">
          <Award className="text-warning" />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 · 质检人工审批</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-success text-white hover:bg-success/90">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受为草稿 (DRAFT)
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            博文初稿已生成,但未达到自动发布阈值。看一眼右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受为草稿"会一并回写后端;也可弃用重跑。
          </AlertDescription>
        </Alert>
      )}

      {/* Score card (左) + Draft preview (右)。
          注意：grid 不能用 overflow-hidden —— Card 用 ring-1（box-shadow 外溢 1px）当边框，
          被外层 hidden 裁掉就成了"上下边框消失"的视觉 bug。让 Card 自身 overflow-hidden 兜底内容裁剪。
          外层用 min-h-0 保证 flex-1 高度能算对。 */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Score card */}
        <Card className="col-span-1 overflow-hidden flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-body-md flex items-center justify-between">
              <span>质检得分</span>
              <span className={cn("text-heading-lg font-bold tabular-nums", parseFailed ? "text-destructive" : "text-warning")}>
                {reviewJson?.total ?? "—"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
            {(() => {
              const hasScores = !!reviewJson && !parseFailed && Object.entries(reviewJson.scores || {}).length > 0
              if (hasScores) {
                return (
                  <>
                    <div className="flex flex-col gap-2.5">
                      {Object.entries(reviewJson!.scores).map(([dim, score]) => (
                        <ScoreBar key={dim} dim={dim} score={score} />
                      ))}
                    </div>
                    <Separator />
                  </>
                )
              }
              // 无评分时：去掉孤立 Separator + 给用户清晰的状态指引（不再"看似被遮住"）。
              return (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                  {parseFailed ? (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">⚠ 质检结果解析失败</div>
                      {reviewJson?.raw_markdown
                        ? "下方原始 markdown 是兜底，可以人工读一眼。"
                        : "文件存在但 JSON 无法解析，可能引擎版本不匹配。"}
                    </>
                  ) : reviewJson === null ? (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">质检结果尚未生成</div>
                      Step 7 还在跑或刚跑完，稍后会自动出现六维评分。
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">本轮无六维评分</div>
                      可能 LLM 直接给 PASS / 评分字段为空，看下方 Re-Brief 与正文。
                    </>
                  )}
                </div>
              )
            })()}
            <div className="flex-1 overflow-hidden flex flex-col">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Re-Brief 改进建议
              </h4>
              <ScrollArea className="flex-1 min-h-0">
                <div className="text-xs text-foreground/80 leading-relaxed pr-2 whitespace-pre-wrap">
                  {reviewJson?.rebrief?.trim() || (parseFailed && reviewJson?.raw_markdown?.trim()) || (
                    <span className="text-muted-foreground italic">
                      {reviewJson === null ? "正在加载质检详细原因…" : "无具体反馈。"}
                    </span>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        {/* Draft 预览/源码 —— 单行 header（仿风格页范文详情）：标签 + 文件名在左，
            预览/源码 toggle + 复制全文按钮在右；改完接受时一并回写后端。 */}
        <Card className="col-span-2 overflow-hidden flex flex-col py-0">
          {/* 用 plain div 而非 CardHeader —— 后者 grid auto-rows-min 会把子项强制分两行。
              Card 自身 py-0 抹掉默认 16px 外缘，header py-3 自己控制 12px 上下气，
              视觉上卡顶 → 文字 ≈ 12px（不会让用户感觉 header 上方有大块空白）。 */}
          <div className="py-3 px-4 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-normal text-muted-foreground shrink-0">草稿</span>
              <code className="text-caption-sm text-muted-foreground/60 truncate">draft_v{reviewJson?.version ?? 1}.md</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="inline-flex rounded-md border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setDraftViewMode("preview")}
                  title="预览（Markdown 渲染）"
                  aria-label="预览"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    draftViewMode === "preview" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  <Eye className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDraftViewMode("edit")}
                  title="源码（原始 Markdown，可编辑）"
                  aria-label="源码"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    draftViewMode === "edit" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  <CodeIcon className="size-3.5" />
                </button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(draftContent)
                    toast.success("已复制全文")
                  } catch (e) {
                    toast.error("复制失败", { description: e instanceof Error ? e.message : String(e) })
                  }
                }}
                title="复制全文"
                aria-label="复制全文"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
          <CardContent className="p-0 flex-1 overflow-hidden">
            {!draftContent ? (
              <div className="px-6 py-5 text-muted-foreground italic text-sm">正在加载初稿...</div>
            ) : draftViewMode === "edit" ? (
              <textarea
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                spellCheck={false}
              />
            ) : (
              <ScrollArea className="h-full">
                <div className="px-6 py-5 max-w-[70ch] mx-auto">
                  <MarkdownView source={draftContent} />
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ScoreBar({ dim, score }: { dim: string; score: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-foreground/80 shrink-0 w-20">{dim}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            score >= 8 ? "bg-success" : score >= 5 ? "bg-warning" : "bg-destructive",
          )}
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </div>
      <span className="font-semibold tabular-nums w-5 text-right">{score}</span>
    </div>
  )
}

// 去掉 markdown 顶部 YAML frontmatter，只渲染正文（阅读视图）。
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/)
  return m ? md.slice(m[0].length).replace(/^\s+/, "") : md
}

// 成品处置（质量学习闭环信号）：读完标一下实际采纳程度，只存本地。
const DISPOSITIONS: { key: string; label: string }[] = [
  { key: "used", label: "👍 直接用了" },
  { key: "edited", label: "✍️ 改了改" },
  { key: "rewrote", label: "🔁 重写了" },
]

// ═══════════════════ Final View（artifact 文档阅读器）═══════════════════
// 成品博文是主角：居中阅读列渲染整篇文档；元信息（路径/质检/成本）降为次级。
function FinalView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  const isHistorical = job.kind === "historical"
  const isDraft = job.is_draft === true || job.status === "draft"
  const path = job.final_post_path
  const [content, setContent] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [disposition, setDisposition] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setContent(null); return }
    setContent(null); setLoadErr(null)
    fetch(apiUrl(`/file?path=${encodeURIComponent(path)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setContent(stripFrontmatter(d.content ?? "")))
      .catch(e => setLoadErr(String(e)))
  }, [path])

  // 载入该成品已有的处置标记（按 path 查全量 map）
  useEffect(() => {
    if (!path) { setDisposition(null); return }
    fetch(apiUrl("/api/dispositions"))
      .then(r => (r.ok ? r.json() : {}))
      .then((map: Record<string, { value?: string } | undefined>) => setDisposition(map?.[path]?.value ?? null))
      .catch(() => setDisposition(null))
  }, [path])

  // 点击切换处置（再点同一个=取消）；乐观更新 + POST 落盘。
  const setDispo = (key: string) => {
    if (!path) return
    const next = disposition === key ? null : key
    setDisposition(next)
    fetch(apiUrl("/api/dispositions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, value: next }),
    }).catch(() => { /* 本地信号，失败不打断阅读 */ })
  }

  return (
    <ScrollArea className="h-full">
      {/* 顶部 meta 条（sticky）—— 状态 + 质检 + 操作 */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur border-b px-6 py-2.5 flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={cn(
            "text-caption-sm",
            isDraft ? "border-warning/40 text-warning" : "border-success/40 text-success",
          )}
        >
          {isDraft ? "DRAFT 归档" : isHistorical ? "成品归档" : "博文成品"}
        </Badge>
        {job.pass_score && <Badge variant="outline" className="text-caption-sm font-mono">质检 {job.pass_score}</Badge>}
        {!isHistorical && job.estimated_cost_usd > 0 && (
          <Badge variant="outline" className="text-caption-sm font-mono">${job.estimated_cost_usd.toFixed(4)}</Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => content && onCopy(content)} disabled={!content}>
          <Copy data-icon="inline-start" /> 复制全文
        </Button>
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "finder")} title="在 Finder 显示" aria-label="在 Finder 显示">
            <FolderOpen />
          </Button>
        )}
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "editor")} title="用默认编辑器打开" aria-label="用默认编辑器打开">
            <ExternalLink />
          </Button>
        )}
      </div>

      {/* 文档阅读列 —— 成品是主角 */}
      <div className="px-6 py-8 max-w-[72ch] mx-auto">
        {loadErr ? (
          <Alert variant="destructive" className="py-2">
            <AlertCircle />
            <AlertTitle className="text-sm">成品载入失败</AlertTitle>
            <AlertDescription className="text-xs break-all">{loadErr}</AlertDescription>
          </Alert>
        ) : content == null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="animate-spin size-4" /> 正在载入成品…
          </div>
        ) : (
          <MarkdownView source={content} />
        )}

        {/* 处置反馈 —— 读完标一下实际采纳，沉淀质量学习信号（只存本地） */}
        {path && content != null && (
          <div className="mt-10 flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">这篇用得怎么样？只存本地，帮工具校准质检。</div>
            <div className="flex gap-2 flex-wrap">
              {DISPOSITIONS.map(({ key, label }) => (
                <FilterChip
                  key={key}
                  active={disposition === key}
                  onClick={() => setDispo(key)}
                  className="px-3 py-1.5 text-sm"
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </div>
        )}

        {/* 次级详情 —— 路径 / frontmatter / 成本，降权放在文末 */}
        <Separator className="my-8" />
        <div className="flex flex-col gap-3">
          <PathRow label="成品路径" path={job.final_post_path} onCopy={onCopy} onOpenInOS={onOpenInOS} />
          <PathRow label="质检报告" path={job.review_path} onCopy={onCopy} onOpenInOS={onOpenInOS} />
          {isHistorical ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs pt-1">
              <InfoRow label="发布日期" value={job.created_at} />
              <InfoRow label="演讲人" value={job.request.speaker} />
              <InfoRow label="路由" value={job.request.routing} />
              <InfoRow label="质检得分" value={job.pass_score} mono />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-xs pt-1">
              <InfoRow label="预估成本" value={`$${job.estimated_cost_usd.toFixed(5)}`} mono />
              <InfoRow label="输入 Token" value={job.input_tokens.toLocaleString()} mono />
              <InfoRow label="输出 Token" value={job.output_tokens.toLocaleString()} mono />
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

// ═══════════════════ 过程产物面板 ═══════════════════
// 列 work/<stem>/ 下所有中间产物，点开经 /file 查看；跑的过程中也能刷新看逐步生成。
interface WorkFile {
  name: string
  path: string
  size: number
  kind: string
  mtime: number
}
const ARTIFACT_META: Record<string, { label: string; order: number }> = {
  transcript: { label: "原始转录", order: 0 },
  subtitle: { label: "字幕", order: 1 },
  meta: { label: "转录元数据", order: 2 },
  clean: { label: "清洗稿", order: 3 },
  insights: { label: "观点提炼", order: 4 },
  outline: { label: "大纲", order: 5 },
  draft: { label: "草稿", order: 6 },
  review: { label: "质检", order: 7 },
  log: { label: "转录日志", order: 8 },
  state: { label: "状态机", order: 9 },
  events: { label: "事件流", order: 10 },
  other: { label: "其它", order: 11 },
}
function artifactBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ArtifactsView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  const [files, setFiles] = useState<WorkFile[]>([])
  const [listErr, setListErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentErr, setContentErr] = useState<string | null>(null)
  const stem = job.stem

  const loadList = useMemo(() => () => {
    setListErr(null)
    fetch(apiUrl(`/work-files?stem=${encodeURIComponent(stem)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<WorkFile[]> })
      .then(list => {
        list.sort((a, b) => (ARTIFACT_META[a.kind]?.order ?? 99) - (ARTIFACT_META[b.kind]?.order ?? 99) || a.name.localeCompare(b.name))
        setFiles(list)
        setSelected(prev => (prev && list.some(f => f.path === prev) ? prev : list[0]?.path ?? null))
      })
      .catch(e => setListErr(String(e)))
  }, [stem])

  useEffect(() => { loadList() }, [loadList])

  // 运行中自动刷新文件列表（每 5s）——逐步生成的产物即时出现；终态即停。
  // 只刷列表，不自动重拉正在看的文件内容，避免阅读被打断（要看最新内容点 🔄 或重选）。
  useEffect(() => {
    if (job.status !== "running" && job.status !== "queued") return
    const t = window.setInterval(loadList, 5000)
    return () => window.clearInterval(t)
  }, [job.status, loadList])

  // 选中文件 → 读内容
  useEffect(() => {
    if (!selected) { setContent(null); return }
    setContent(null); setContentErr(null)
    fetch(apiUrl(`/file?path=${encodeURIComponent(selected)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setContent(d.content ?? ""))
      .catch(e => setContentErr(String(e)))
  }, [selected])

  const selFile = files.find(f => f.path === selected)
  const ext = (selFile?.name.split(".").pop() ?? "").toLowerCase()

  let viewer: React.ReactNode
  if (contentErr) {
    viewer = <Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{contentErr}</AlertDescription></Alert>
  } else if (content === null) {
    viewer = <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="animate-spin size-4" /> 载入中…</div>
  } else if (ext === "md") {
    viewer = <div className="max-w-[72ch] mx-auto"><MarkdownView source={content} /></div>
  } else {
    let text = content
    if (ext === "json") { try { text = JSON.stringify(JSON.parse(content), null, 2) } catch { /* 原文 */ } }
    viewer = <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">{text}</pre>
  }

  return (
    <div className="flex h-full gap-3 min-h-0">
      {/* 左：文件列表 */}
      <div className="w-56 shrink-0 flex flex-col min-h-0 border rounded-lg bg-card/40">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground truncate min-w-0" title={`work/${stem}/`}>work/{stem}/</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={loadList} title="刷新（运行中可随时看最新产物）" aria-label="刷新产物列表" className="size-6 shrink-0">
            <RotateCw className="size-3.5" />
          </Button>
        </div>
        {/* viewport 覆盖同 App.tsx：防长产物名撑破 Radix table wrapper 致 truncate 失效 */}
        <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
          <div className="p-1.5 flex flex-col gap-0.5">
            {listErr && <div className="text-xs text-destructive p-2">{listErr}</div>}
            {!listErr && files.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">还没有产物。任务开始后这里会逐步出现。</div>}
            {files.map(f => (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f.path)}
                className={cn(
                  "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                  // STYLE 表2 唯一选中态（中性玻璃高亮）
                  f.path === selected ? "bg-foreground/[0.08] text-foreground" : "hover:bg-foreground/[0.05]",
                )}
              >
                <div className="text-xs font-medium truncate">{ARTIFACT_META[f.kind]?.label ?? f.kind}</div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-caption-sm text-muted-foreground font-mono truncate">{f.name}</span>
                  <span className="text-caption-sm text-muted-foreground/70 shrink-0">{artifactBytes(f.size)}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* 右：查看器 */}
      <div className="flex-1 flex flex-col min-h-0 border rounded-lg bg-card/40">
        {selFile && (
          <div className="flex items-center gap-2 px-4 py-2 border-b">
            <span className="text-sm font-medium">{ARTIFACT_META[selFile.kind]?.label ?? selFile.kind}</span>
            <code className="text-caption-sm text-muted-foreground">{selFile.name}</code>
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" disabled={content === null} onClick={() => content && onCopy(content)} title="复制内容" aria-label="复制内容">
              <Copy className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInOS(selFile.path, "editor")} title="用编辑器打开" aria-label="用编辑器打开">
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
        )}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4">
            {selected ? viewer : <div className="text-sm text-muted-foreground py-10 text-center">从左侧选一个产物查看</div>}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <code className={cn("text-foreground/90", mono && "font-mono")}>{value || "—"}</code>
    </div>
  )
}

function PathRow({ label, path, onCopy, onOpenInOS }: { label: string; path?: string; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  if (!path) return null
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded border text-xs">
        <code className="text-primary truncate select-all">{path}</code>
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onCopy(path)} aria-label="复制路径">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">复制路径</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "finder")} aria-label="在 Finder 中显示">
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">在 Finder 中显示</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "editor")} aria-label="用默认应用打开">
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">用默认应用打开</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// Jobs 列表（live + historical）：列表容器 + 状态点 + 行。
// 从 jobs.tsx 原样搬出，零行为变更。
import { Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatRelativeOrAbsolute, type EngineJob } from '@/lib/job-types'
import {
  jobUpdatedMs,
  jobCreatedMs,
  smartBucket,
  matchesJobFilter,
  matchesTimeRange,
  matchesJobQuery,
  type JobFilter,
  type JobTimeRange,
  type JobSortMode,
} from '@/lib/job-filters'

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

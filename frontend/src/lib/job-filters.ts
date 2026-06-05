// Jobs 列表的纯过滤 / 排序 / 时间戳工具与维度类型。
// 从 jobs.tsx 原样下沉，零行为变更（仅供 job-list / jobs.tsx 复用，避免循环依赖）。
import { type EngineJob } from '@/lib/job-types'

// ═══════════════════ Job List (live + historical) ═══════════════════
// 维度收敛（2026-06）：原本 scope(4) × filter(5) 的正交切面被压成单一 popover —
//   - status: all / needs_me（paused+failed）/ active（running+queued）/ done（succeeded+draft+historical）
//   - timeRange: any / 7d / 30d
//   - sortMode: smart（needs_me 顶置）/ updated / created
// "本会话"维度彻底砍——用户不懂"会话"语义；要找近的就用 timeRange=7d。
export type JobFilter = "all" | "needs_me" | "active" | "done"
export type JobTimeRange = "any" | "7d" | "30d"
export type JobSortMode = "smart" | "updated" | "created"

// 单一 job 时间戳的统一表示（毫秒）：live 用 updated_at / created_at；historical 用 mtime（秒→毫秒）。
export function jobUpdatedMs(j: EngineJob): number {
  if (j.kind === "historical") {
    const m = (j as EngineJob & { mtime?: number }).mtime
    return typeof m === "number" ? m * 1000 : 0
  }
  return Date.parse(j.updated_at || j.created_at || "") || 0
}
export function jobCreatedMs(j: EngineJob): number {
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
export function smartBucket(job: EngineJob): number {
  if (job.kind === "historical") return 4
  switch (job.status) {
    case "paused": return 0
    case "failed": return 1
    case "running": return 2
    case "queued": return 2
    default: return 4  // succeeded / draft
  }
}

export function matchesJobFilter(job: EngineJob, filter: JobFilter): boolean {
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

export function matchesTimeRange(job: EngineJob, range: JobTimeRange): boolean {
  if (range === "any") return true
  const days = range === "7d" ? 7 : 30
  const cutoff = Date.now() - days * 864e5
  return jobUpdatedMs(job) >= cutoff
}

export function matchesJobQuery(job: EngineJob, q: string): boolean {
  if (!q) return true
  const lower = q.toLowerCase()
  return (
    job.stem.toLowerCase().includes(lower) ||
    job.request.speaker.toLowerCase().includes(lower) ||
    job.request.routing.toLowerCase().includes(lower)
  )
}

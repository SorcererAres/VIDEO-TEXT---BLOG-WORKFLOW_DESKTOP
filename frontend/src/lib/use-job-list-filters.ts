import { useState, useEffect } from 'react'
import type { JobFilter, JobTimeRange, JobSortMode } from '@/lib/job-filters'

// 任务列表的过滤 / 时间范围 / 排序 / 段折叠状态（均持久化到 localStorage）。
// 从 App.tsx 抽离为自定义 hook —— 纯过滤状态，不依赖 jobs 数据本身
// （needsMeCount 这类依赖 jobs 的派生量仍留在 App）。
export function useJobListFilters() {
  // jobQuery 传给 JobList 做行内过滤；当前恒为 ""（不过滤）。setter 待"⌘K 选中清空 /
  // IPC 注入搜索词"功能落地时再加回 —— 现无调用方，留着会触发 noUnusedLocals 阻塞 build。
  const [jobQuery] = useState("")
  const [jobFilter, setJobFilter] = useState<JobFilter>(
    () => (localStorage.getItem("v2b_job_filter") as JobFilter | null) || "all",
  )
  const [jobTimeRange, setJobTimeRange] = useState<JobTimeRange>(
    () => (localStorage.getItem("v2b_job_time_range") as JobTimeRange | null) || "any",
  )
  const [jobSort, setJobSort] = useState<JobSortMode>(
    () => (localStorage.getItem("v2b_job_sort") as JobSortMode | null) || "smart",
  )
  // 任务段折叠态（左侧 ⌃ 按钮）：收起后列表 + ⚙ 隐藏，只剩 header 一行；
  // 等我项 > 0 时标题旁挂红点。
  const [jobsCollapsed, setJobsCollapsed] = useState<boolean>(
    () => localStorage.getItem("v2b_jobs_collapsed") === "1",
  )
  useEffect(() => { localStorage.setItem("v2b_job_filter", jobFilter) }, [jobFilter])
  useEffect(() => { localStorage.setItem("v2b_job_time_range", jobTimeRange) }, [jobTimeRange])
  useEffect(() => { localStorage.setItem("v2b_job_sort", jobSort) }, [jobSort])
  useEffect(() => { localStorage.setItem("v2b_jobs_collapsed", jobsCollapsed ? "1" : "0") }, [jobsCollapsed])
  // ⚙ icon 是否高亮：任一段非 default 即视为"列表正在被筛"
  const jobsFilterActive = jobFilter !== "all" || jobTimeRange !== "any" || jobSort !== "smart"

  return {
    jobQuery,
    jobFilter,
    setJobFilter,
    jobTimeRange,
    setJobTimeRange,
    jobSort,
    setJobSort,
    jobsCollapsed,
    setJobsCollapsed,
    jobsFilterActive,
  }
}

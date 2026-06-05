// Cmd+K 任务搜索模态（参考 Claude.ai 风格）：顶部输入 + 下方列表，方向键 + Enter 选中。
// 跨 live / restored / historical 三类 job 统一搜索；命中后关闭模态并选中目标 job。
import { useEffect, useMemo, useRef, useState } from "react"
import { Search, X, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelativeOrAbsolute, type EngineJob } from "@/lib/job-types"

interface SearchModalProps {
  open: boolean
  onClose: () => void
  jobs: EngineJob[]
  historicalJobs: EngineJob[]
  onSelect: (id: string) => void
}

export function SearchModal({ open, onClose, jobs, historicalJobs, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 合并 + 按 path 去重，去除已在 live 里的历史 → 避免重复条目
  const allJobs = useMemo(() => {
    const livePaths = new Set(jobs.map(j => j.final_post_path).filter(Boolean) as string[])
    const dedupedHistorical = historicalJobs.filter(h => !h.final_post_path || !livePaths.has(h.final_post_path))
    return [...jobs, ...dedupedHistorical]
  }, [jobs, historicalJobs])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? allJobs.filter(
          j =>
            j.stem.toLowerCase().includes(q) ||
            j.request.speaker.toLowerCase().includes(q) ||
            j.request.routing.toLowerCase().includes(q),
        )
      : allJobs
    return [...base].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
  }, [allJobs, query])

  // 打开时聚焦输入，重置 query 和高亮
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      // 下一帧聚焦，避开 Radix 焦点回收
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // query 变化时重置高亮到第一项，避免指向被过滤掉的旧 idx
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  // 高亮项滚入视口
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-result-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIdx, open])

  if (!open) return null

  const handleSelect = (id: string) => {
    onSelect(id)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx(i => Math.min(results.length - 1, i + 1))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const target = results[activeIdx]
      if (target) handleSelect(target.id)
      return
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh] px-6 animate-in fade-in duration-100"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[640px] max-w-full rounded-2xl bg-card shadow-2xl border overflow-hidden flex flex-col max-h-[70vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部输入栏 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
          <Search className="size-5 text-muted-foreground shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索任务（stem / 演讲人 / 路由）"
            className="flex-1 bg-transparent outline-none text-base text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索"
            className="size-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors shrink-0"
          >
            <X className="size-5" strokeWidth={1.5} />
          </button>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {query ? `没有匹配「${query}」的任务` : "还没有任务"}
            </div>
          ) : (
            results.map((job, idx) => {
              const tsLabel = formatRelativeOrAbsolute(job.updated_at || job.created_at)
              const isActive = idx === activeIdx
              return (
                <button
                  key={job.id}
                  type="button"
                  data-result-idx={idx}
                  onClick={() => handleSelect(job.id)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    "flex items-center gap-3 w-full px-5 py-2.5 text-left transition-colors",
                    isActive ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
                  )}
                >
                  <FileText className="size-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                  <span className="flex-1 truncate text-[14px] text-foreground">{job.stem}</span>
                  {tsLabel && (
                    <span className="text-[13px] text-muted-foreground shrink-0">{tsLabel}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

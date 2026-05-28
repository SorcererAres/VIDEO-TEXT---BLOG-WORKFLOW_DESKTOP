import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  Check,
  Loader2,
  Pause,
  AlertTriangle,
  XCircle,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Terminal,
  EyeOff,
  Eye,
  Search,
  Copy,
  X,
} from "lucide-react"
import { parseLogLine, type ParsedEvent, type LogEventType } from "@/lib/log-parser"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

interface LogConsoleProps {
  logs: string[]
  /** 后端 job.status —— 决定 step/paused 事件用 actionable 还是 historical 渲染。
   *  参考 GitHub Actions / Vercel 的设计：只有"当前活跃"事件保留 spinner/橙色，
   *  历史事件降级为 ✓ / 灰色，避免 succeeded 后还显示"等待审批"误导用户。 */
  jobStatus?: string
  className?: string
}

/** 每个事件在"当前 job 视角"下应该用 actionable 渲染还是 historical 渲染。 */
function deriveActiveFlags(events: ParsedEvent[], jobStatus: string | undefined): boolean[] {
  // succeeded / failed 后所有事件都成历史 —— 这是 5/28 撞到的具体 bug 场景
  if (jobStatus === "succeeded" || jobStatus === "failed") {
    return events.map(() => false)
  }
  // running：最后一条 step 事件保持 actionable，更早的 step 全转完成
  // paused：最后一条 paused 事件保持 actionable，更早的 paused 全转历史
  // 注意：step 和 paused 各自独立追踪，因为它们可能交错
  let lastStepIdx = -1
  let lastPausedIdx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (lastStepIdx === -1 && events[i].type === "step") lastStepIdx = i
    if (lastPausedIdx === -1 && events[i].type === "paused") lastPausedIdx = i
    if (lastStepIdx !== -1 && lastPausedIdx !== -1) break
  }
  return events.map((e, idx) => {
    if (e.type === "step") return idx === lastStepIdx
    if (e.type === "paused") return idx === lastPausedIdx
    // 非 step/paused 类型（system/success/warning/error/detail）不受此规则影响
    return true
  })
}

/**
 * 把后端 print 出来的工程师腔日志,渲染成"我在看 AI 工作"的叙事面板。
 *   - 关键事件(step / success / warning / paused / error) 默认显示,带图标
 *   - 中间技术细节(chunk、缓存命中、清理痕迹) 默认折叠在"详细技术日志"开关下
 *   - 完全无意义的(PAGER=cat 这种)在 parseLogLine 里就 drop 掉了
 *   - 智能跟随滚动:用户在底部才自动跟,否则浮动"↓ N 条新事件"按钮
 *   - 顶部搜索过滤 + 一键复制全部
 */
export function LogConsole({ logs, jobStatus, className }: LogConsoleProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [query, setQuery] = useState("")
  const [showSearch, setShowSearch] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)

  const scrollRootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const prevVisibleCountRef = useRef(0)

  // 解析所有日志(过滤掉 null 的噪音行)
  const events = useMemo(
    () => logs.map(parseLogLine).filter((e): e is ParsedEvent => e !== null),
    [logs],
  )

  const detailCount = events.filter(e => e.type === "detail").length

  // 三层过滤:type(detail 开关)→ query
  const visibleEvents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter(e => {
      if (!showDetails && e.type === "detail") return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        (e.subtitle?.toLowerCase().includes(q) ?? false) ||
        e.raw.toLowerCase().includes(q)
      )
    })
  }, [events, showDetails, query])

  // 派生每条 visible 事件的"是否当前活跃"标记 —— 历史事件不该再 spinner / amber
  const activeFlags = useMemo(
    () => deriveActiveFlags(visibleEvents, jobStatus),
    [visibleEvents, jobStatus],
  )

  // 抓 ScrollArea 内部的 viewport,挂 scroll 监听判断"是否在底部"
  useEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLDivElement>("[data-slot='scroll-area-viewport']")
    if (!viewport) return
    viewportRef.current = viewport

    const handler = () => {
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40
      setIsAtBottom(atBottom)
      if (atBottom) setPendingCount(0)
    }
    viewport.addEventListener("scroll", handler, { passive: true })
    handler()
    return () => viewport.removeEventListener("scroll", handler)
  }, [])

  // 新事件到来:在底部就跟随,不在底部就累加 pending 提示
  useEffect(() => {
    const delta = visibleEvents.length - prevVisibleCountRef.current
    prevVisibleCountRef.current = visibleEvents.length
    if (delta <= 0) return // 切 showDetails / query 时不算新事件
    if (isAtBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    } else {
      setPendingCount(c => c + delta)
    }
  }, [visibleEvents.length, isAtBottom])

  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    setPendingCount(0)
  }

  const handleCopyAll = async () => {
    const text = events
      .map(e => {
        const head = e.subtitle ? `${e.title}  ·  ${e.subtitle}` : e.title
        return `[${e.type.toUpperCase()}] ${head}`
      })
      .join("\n")
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore — 没权限就拉倒 */
    }
  }

  if (events.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Terminal />
            </EmptyMedia>
            <EmptyTitle>暂无运行日志</EmptyTitle>
            <EmptyDescription>
              任务还没启动或处于缓存命中状态。等任务开始跑,AI 的每一步动作都会在这里实时展开。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full bg-card rounded-lg border overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 select-none gap-2">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Sparkles className="size-4 text-primary shrink-0" />
          <span className="font-medium shrink-0">运行进度</span>
          <span className="text-xs text-muted-foreground truncate">
            · {visibleEvents.length}/{events.length} 个事件
            {detailCount > 0 && !showDetails && ` · ${detailCount} 条细节已折叠`}
            {query && ` · 过滤中`}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant={showSearch ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setShowSearch(s => {
                if (s) setQuery("")
                return !s
              })
            }}
            className="h-7 text-xs gap-1.5"
            title="搜索日志"
          >
            <Search className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyAll}
            className="h-7 text-xs gap-1.5"
            title="复制全部日志到剪贴板"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(s => !s)}
            className="h-7 text-xs gap-1.5"
          >
            {showDetails ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
            {showDetails ? "隐藏细节" : "显示细节"}
          </Button>
        </div>
      </div>

      {/* Search bar (折叠) */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="按标题 / 副标题 / 原始日志过滤…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            onKeyDown={e => {
              if (e.key === "Escape") {
                setQuery("")
                setShowSearch(false)
              }
            }}
          />
          {query && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQuery("")}
              className="h-6 text-xs px-1.5"
              title="清空搜索"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      )}

      {/* Event stream */}
      <div ref={scrollRootRef} className="relative flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-1 px-4 py-3">
            {visibleEvents.length === 0 ? (
              <div className="text-sm text-muted-foreground italic text-center py-8">
                没有匹配「{query}」的事件
              </div>
            ) : (
              visibleEvents.map((ev, idx) => (
                <EventRow key={ev.id} event={ev} isActive={activeFlags[idx]} />
              ))
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        {/* "↓ N 条新事件" 浮动按钮:用户向上滚开时显示 */}
        {pendingCount > 0 && !isAtBottom && (
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-7 text-xs gap-1.5 shadow-lg z-10"
          >
            <ChevronDown className="size-3.5" />
            {pendingCount} 条新事件
          </Button>
        )}
      </div>
    </div>
  )
}

const ICONS: Record<LogEventType, typeof Sparkles> = {
  system: Sparkles,
  step: Loader2,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  paused: Pause,
  detail: ChevronRight,
}

function EventRow({ event, isActive = true }: { event: ParsedEvent; isActive?: boolean }) {
  // step / paused 历史化时改图标：step → ✓（已完成）、paused → Check（已审批过去）
  // 不动 success/warning/error/detail —— 它们本身已经语义明确，没有"过期"问题
  const Icon = (() => {
    if (!isActive && event.type === "step") return CheckCircle2
    if (!isActive && event.type === "paused") return Check
    return ICONS[event.type]
  })()

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 py-1.5 px-2 rounded-md text-sm",
        event.type === "detail" && "pl-6 text-xs text-muted-foreground",
      )}
      title={event.raw}
    >
      <Icon
        className={cn(
          "shrink-0 mt-0.5",
          event.type === "detail" ? "size-3" : "size-4",
          event.type === "system" && "text-primary",
          // step：当前活跃才转圈 + 主色；历史用绿勾且不再 animate
          event.type === "step" && isActive && "text-primary animate-spin",
          event.type === "step" && !isActive && "text-emerald-500/70",
          event.type === "success" && "text-emerald-500",
          event.type === "warning" && "text-amber-500",
          event.type === "error" && "text-destructive",
          // paused：当前活跃才橙色；历史降级为静默的 muted
          event.type === "paused" && isActive && "text-amber-500",
          event.type === "paused" && !isActive && "text-muted-foreground/60",
          event.type === "detail" && "text-muted-foreground/60",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={cn(
              "leading-snug",
              event.type === "system" && "font-semibold",
              event.type === "step" && "font-semibold",
              event.type === "step" && !isActive && "text-muted-foreground",
              event.type === "success" && "text-foreground",
              event.type === "warning" && "text-amber-700 dark:text-amber-400",
              event.type === "error" && "text-destructive font-medium",
              // 当前活跃的 paused 才高亮，历史的归类为已过去
              event.type === "paused" && isActive && "text-amber-700 dark:text-amber-400 font-medium",
              event.type === "paused" && !isActive && "text-muted-foreground",
            )}
          >
            {event.title}
          </span>
          {event.subtitle && (
            <span className="text-xs text-muted-foreground">
              {!isActive && event.type === "paused" ? "已审批" : event.subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

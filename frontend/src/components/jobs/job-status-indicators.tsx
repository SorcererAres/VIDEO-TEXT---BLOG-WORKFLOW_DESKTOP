// Jobs 区域状态指示：状态徽章 + SSE 实时连接灯。
// 从 jobs.tsx 原样搬出，零行为变更。
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ═══════════════════ Status Badge ═══════════════════
export function StatusBadge({ status }: { status: string }) {
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

// ═══════════════════ SSE Status Indicator ═══════════════════
// 顶部"实时连接"小灯,告诉用户日志流是否还在,断了多久了,正在重连第几次。
export function SseStatusIndicator({
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

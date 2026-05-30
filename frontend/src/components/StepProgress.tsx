import { Check, Loader2, Pause, AlertTriangle, FileText, Sparkles, ListTree, PenLine, Scale, Archive, AudioLines, Mic } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ComponentType } from "react"

export type StepStatus = "pending" | "running" | "done" | "paused" | "error" | "skipped"

interface StepNode {
  id: string
  label: string
  hint: string
  status: StepStatus
  icon: ComponentType<{ className?: string }>
}

// stage 元信息;quick 模式过滤 3/4/5；前三步(audio/asr/draft)仅 video 任务显示
const STAGE_META: Record<string, { label: string; hint: string; icon: ComponentType<{ className?: string }>; quickOnly?: false }> = {
  audio: { label: "音频", hint: "前1步 · ffmpeg 提取音频", icon: AudioLines },
  asr: { label: "转录", hint: "前2步 · 语音转文字(mlx / whisper.cpp)", icon: Mic },
  draft: { label: "成稿", hint: "前3步 · 生成 raw.txt 转录稿", icon: FileText },
  clean: { label: "清洗", hint: "Step 3 · 清洗 ASR 转录稿", icon: FileText },
  insights: { label: "提炼", hint: "Step 4 · 提炼核心观点", icon: Sparkles },
  outline: { label: "骨架", hint: "Step 5 · 搭建博文骨架", icon: ListTree },
  rewrite: { label: "重写", hint: "Step 6 · 撰写第一人称博文", icon: PenLine },
  check: { label: "质检", hint: "Step 7 · 六维评分,PASS/REVIEW", icon: Scale },
  archive: { label: "归档", hint: "Step 8 · 落盘 + HISTORY + 指纹", icon: Archive },
}

export type JumpTarget = "console" | "outline" | "review" | "final"

interface StepProgressProps {
  mode: "full" | "quick"
  jobStatus: string // queued / running / paused / succeeded / failed
  currentStep: number | null // 来自 inferCurrentStep（0-2=前三步，3-8=LLM）
  pausedAt?: "outline" | "review" | null // 用户审批节点(从 outline_path / draft 推断)
  hasTranscription?: boolean // video 任务：前置 3 个转录节点
  onJump?: (target: JumpTarget) => void // 点击 step dot 跳到对应 tab
  className?: string
}

/**
 * 顶部步骤进度条 —— 把 8 个 step 状态机变成视觉骨架。
 * 设计原则:
 *   - quick 模式只显示 重写 / 质检 / 归档 三档
 *   - 当前 step 用蓝色 pulse 动画 + Loader 图标
 *   - 暂停节点(等用户审批)用黄色 Pause 图标
 *   - 完成节点 绿勾 + 暗色填充
 */
export function StepProgress({ mode, jobStatus, currentStep, pausedAt, hasTranscription, onJump, className }: StepProgressProps) {
  const llmStages = mode === "full"
    ? ["clean", "insights", "outline", "rewrite", "check", "archive"]
    : ["rewrite", "check", "archive"]
  const allStages = hasTranscription ? ["audio", "asr", "draft", ...llmStages] : llmStages

  const isFinished = jobStatus === "succeeded" || jobStatus === "failed"
  const isPaused = jobStatus === "paused"
  const isFailed = jobStatus === "failed"

  // 把 stage id 映射回 Step 编号,判断 done/running/pending
  const stageToStepNum = (id: string) => ({
    audio: 0, asr: 1, draft: 2,
    clean: 3, insights: 4, outline: 5, rewrite: 6, check: 7, archive: 8,
  })[id]!

  const nodes: StepNode[] = allStages.map(id => {
    const stepNum = stageToStepNum(id)
    const meta = STAGE_META[id]
    let status: StepStatus

    if (isFinished && !isFailed) {
      status = "done"
    } else if (currentStep === null) {
      // queued / 还没开始
      status = "pending"
    } else if (stepNum < currentStep) {
      status = "done"
    } else if (stepNum === currentStep) {
      // 当前 step:可能是 running,也可能是暂停(outline 卡在 Step 5、review 卡在 Step 7)
      if (isPaused && pausedAt === "outline" && stepNum === 5) status = "paused"
      else if (isPaused && pausedAt === "review" && stepNum === 7) status = "paused"
      else if (isFailed) status = "error"
      else status = "running"
    } else {
      status = "pending"
    }

    return { id, label: meta.label, hint: meta.hint, status, icon: meta.icon }
  })

  // 决定每个 step dot 点击后跳哪个 tab —— 只有"用户能看到内容"的 step 才可点
  const jumpTargetFor = (node: StepNode): JumpTarget | null => {
    if (node.status === "paused" && node.id === "outline") return "outline"
    if (node.status === "paused" && node.id === "check") return "review"
    if (node.status === "done" && node.id === "archive") return "final"
    if (node.status === "running" || node.status === "done" || node.status === "error") return "console"
    return null
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex items-center gap-1 px-1 py-3", className)}>
        {nodes.map((node, idx) => {
          const target = onJump ? jumpTargetFor(node) : null
          return (
            <div key={node.id} className="flex items-center gap-1 flex-1">
              <StepDot
                node={node}
                onClick={target && onJump ? () => onJump(target) : undefined}
              />
              {idx < nodes.length - 1 && (
                <div className={cn(
                  "h-px flex-1 transition-colors",
                  node.status === "done" ? "bg-emerald-500/40" : "bg-border",
                )} />
              )}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function StepDot({ node, onClick }: { node: StepNode; onClick?: () => void }) {
  const Icon = node.icon
  const clickable = !!onClick
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : -1}
          onClick={onClick}
          onKeyDown={clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.() } }) : undefined}
          className={cn(
            "flex flex-col items-center gap-1.5 select-none rounded-md outline-none",
            clickable
              ? "cursor-pointer hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 transition-opacity"
              : "cursor-default",
          )}
        >
          <div className={cn(
            "size-9 rounded-full flex items-center justify-center transition-all border",
            node.status === "pending" && "bg-muted/30 border-border text-muted-foreground",
            node.status === "running" && "bg-primary/15 border-primary text-primary animate-pulse",
            node.status === "done" && "bg-emerald-500/10 border-emerald-500/40 text-emerald-400",
            node.status === "paused" && "bg-amber-500/10 border-amber-500/60 text-amber-400 animate-pulse",
            node.status === "error" && "bg-destructive/10 border-destructive/50 text-destructive",
            node.status === "skipped" && "bg-muted/10 border-dashed border-border text-muted-foreground/50",
          )}>
            {node.status === "done" && <Check className="size-4" />}
            {node.status === "running" && <Loader2 className="size-4 animate-spin" />}
            {node.status === "paused" && <Pause className="size-4" />}
            {node.status === "error" && <AlertTriangle className="size-4" />}
            {(node.status === "pending" || node.status === "skipped") && <Icon className="size-4" />}
          </div>
          <span className={cn(
            "text-[11px] font-medium",
            node.status === "running" && "text-primary",
            node.status === "done" && "text-emerald-400",
            node.status === "paused" && "text-amber-400",
            node.status === "error" && "text-destructive",
            node.status === "pending" && "text-muted-foreground",
          )}>
            {node.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{node.hint}</p>
        {clickable && <p className="text-[10px] text-muted-foreground mt-0.5">点击跳转</p>}
      </TooltipContent>
    </Tooltip>
  )
}

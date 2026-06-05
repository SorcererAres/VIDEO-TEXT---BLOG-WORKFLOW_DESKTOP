import { Check, Loader2, Pause, AlertTriangle, FileText, Sparkles, ListTree, PenLine, Scale, Archive, AudioLines, Mic } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Fragment, type ComponentType } from "react"

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

// "焦点 step" = 当前活跃 / 暂停 / 失败 的节点。这些节点完整显示 icon + 标题 + 副标题；
// 其它节点（已完成 / 未来 / 跳过）只渲染 icon dot，避免 9 段 stepper 在窄主区被压成竖字。
// 设计参考：Stripe Checkout / Linear 的 stepper 焦点模式。
function isFocusedStatus(s: StepStatus): boolean {
  return s === "running" || s === "paused" || s === "error"
}

/**
 * 顶部步骤进度条 —— 把 8 个 step 状态机变成视觉骨架。
 * 设计原则:
 *   - quick 模式只显示 重写 / 质检 / 归档 三档
 *   - "焦点 step"（running / paused / error）完整展示 icon + label + 副标题
 *   - 其它 step 只显示 icon dot —— 窄主区不再被挤
 *   - 完成节点 绿勾；暂停 黄 Pause；失败 红警告
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
      <div className={cn("flex items-center gap-2 px-1 py-3", className)}>
        {nodes.map((node, idx) => (
          <Fragment key={node.id}>
            <StepCard
              node={node}
              pausedAt={pausedAt}
              focused={isFocusedStatus(node.status)}
              onClick={onJump ? (() => { const t = jumpTargetFor(node); if (t) onJump(t) }) : undefined}
              jumpable={!!(onJump && jumpTargetFor(node))}
            />
            {idx < nodes.length - 1 && (
              // 虚线连接线：done 用语义绿，未走到的步骤用 border
              <div className={cn(
                "flex-1 border-t border-dashed transition-colors min-w-[8px]",
                node.status === "done" ? "border-success/40" : "border-border",
              )} />
            )}
          </Fragment>
        ))}
      </div>
    </TooltipProvider>
  )
}

// 状态副标题：「已完成 / 进行中 / 等待审批…」—— 让状态从颜色搬到文字，配色得以克制
function statusLabelFor(node: StepNode, pausedAt: "outline" | "review" | null | undefined): string {
  switch (node.status) {
    case "done": return "已完成"
    case "running": return "进行中"
    case "paused":
      if (pausedAt === "outline" && node.id === "outline") return "等待审批"
      if (pausedAt === "review" && node.id === "check") return "等待审稿"
      return "已暂停"
    case "error": return "失败"
    case "skipped": return "已跳过"
    case "pending":
    default: return "等待中"
  }
}

function StepCard({
  node, pausedAt, focused, onClick, jumpable,
}: { node: StepNode; pausedAt?: "outline" | "review" | null; focused: boolean; onClick?: () => void; jumpable: boolean }) {
  const Icon = node.icon
  const clickable = !!onClick && jumpable
  const subtitle = statusLabelFor(node, pausedAt)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : -1}
          onClick={clickable ? onClick : undefined}
          onKeyDown={clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.() } }) : undefined}
          className={cn(
            "flex items-center gap-2 shrink-0 select-none rounded-md outline-none px-1 py-1 transition-all",
            clickable
              ? "cursor-pointer hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50"
              : "cursor-default",
          )}
        >
          {/* icon 圆：只用 outline + 语义色（去 bg 填充），克制处理 */}
          <div className={cn(
            "size-5 rounded-full flex items-center justify-center shrink-0 border transition-colors",
            node.status === "pending" && "border-border text-muted-foreground/60",
            node.status === "running" && "border-info/60 text-info animate-pulse",
            node.status === "done" && "border-success/50 text-success/80",
            node.status === "paused" && "border-warning/60 text-warning animate-pulse",
            node.status === "error" && "border-destructive/60 text-destructive",
            node.status === "skipped" && "border-dashed border-border text-muted-foreground/40",
          )}>
            {node.status === "done" && <Check className="size-3" strokeWidth={2.5} />}
            {node.status === "running" && <Loader2 className="size-3 animate-spin" />}
            {node.status === "paused" && <Pause className="size-3" />}
            {node.status === "error" && <AlertTriangle className="size-3" />}
            {(node.status === "pending" || node.status === "skipped") && <Icon className="size-3" />}
          </div>
          {/* 焦点 step（running / paused / error）完整展示标题 + 副标题；其它 step icon-only。
              whitespace-nowrap 防止窄屏下 CJK 单字竖排（旧实现的核心痛点）。 */}
          {focused && (
            <div className="flex flex-col items-start leading-tight whitespace-nowrap">
              <span className="text-[13px] font-medium text-foreground">
                {node.label}
              </span>
              <span className={cn(
                "text-[11px]",
                node.status === "paused" ? "text-warning" :
                node.status === "error" ? "text-destructive" :
                "text-info",
              )}>
                {subtitle}
              </span>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs font-medium">
          {node.label} · <span className="text-muted-foreground font-normal">{subtitle}</span>
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

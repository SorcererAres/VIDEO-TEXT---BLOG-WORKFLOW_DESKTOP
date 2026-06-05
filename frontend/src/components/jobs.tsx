// Jobs 区域桶文件：编排 Job 工作区（参数卡 / ⋯ 菜单 / tab 容器），
// 子组件（状态徽章 / 失败 banner / SSE 灯 / 任务列表 / Home / 各 tab 视图）已下沉 components/jobs/。
// 对外公共 API（JobList / HomeView / JobWorkspace / isNeedsMe / JobFilter / JobTimeRange / JobSortMode）
// 从这里继续 re-export，App.tsx 的 import 不变。
import { useState } from 'react'
import {
  User,
  DollarSign,
  Edit,
  RotateCw,
  XCircle,
  FolderOpen,
  Award,
  Layers,
  ListTree,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { StepProgress } from '@/components/StepProgress'
import { LogConsole } from '@/components/LogConsole'
import {
  shortApiBase,
  type EngineJob,
} from '@/lib/job-types'
import { StatusBadge, SseStatusIndicator } from '@/components/jobs/job-status-indicators'
import { useFailureDiagnosis, FailureBanner } from '@/components/jobs/failure-banner'
import { OutlineView } from '@/components/jobs/outline-view'
import { DraftReviewView } from '@/components/jobs/draft-review-view'
import { FinalView } from '@/components/jobs/final-view'
import { ArtifactsView } from '@/components/jobs/artifacts-view'
import { type JobWorkspaceProps } from '@/components/jobs/job-workspace-types'

// 公共 API re-export —— App.tsx 从 '@/components/jobs' 拿这些名字，保持不变。
export { JobList } from '@/components/jobs/job-list'
export { HomeView, OverviewPanel } from '@/components/jobs/home-view'
export { isNeedsMe } from '@/lib/job-filters'
export { type JobFilter, type JobTimeRange, type JobSortMode } from '@/lib/job-filters'

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

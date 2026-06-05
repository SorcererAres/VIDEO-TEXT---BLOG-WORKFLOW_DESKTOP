// JobWorkspace 的 props 接口 —— 由 jobs.tsx 编排，OutlineView / DraftReviewView 子视图按字段消费。
// 单独下沉成 types 文件，避免 jobs.tsx ↔ 子视图文件之间的循环依赖。
// 从 jobs.tsx 原样搬出，零行为变更。
import { type ParsedEvent } from '@/lib/log-parser'
import { type EngineJob, type ReviewJson } from '@/lib/job-types'

// ═══════════════════ Job Workspace ═══════════════════
export interface JobWorkspaceProps {
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

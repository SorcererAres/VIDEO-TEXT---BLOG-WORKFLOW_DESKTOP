import { useState, useEffect } from 'react'
import { API_BASE } from '@/lib/api'
import { readOutlineDraft, writeOutlineDraft, clearOutlineDraft } from '@/lib/draft-storage'
import type { EngineJob } from '@/lib/job-types'

// 大纲编辑器状态 + 本地草稿自动存档 + 加载器。从 App.tsx 抽离为自定义 hook（传入 selectedJob）。
// 审批提交（handleApproveOutline）仍留 App —— 它要联动 startSse / fetchJobs。
export function useOutlineEditor(selectedJob: EngineJob | null) {
  // Outline Editing state —— 默认预览(渲染后博文),需要改结构再切源码
  const [outlineText, setOutlineText] = useState("")
  const [isSubmittingOutline, setIsSubmittingOutline] = useState(false)
  const [outlineViewMode, setOutlineViewMode] = useState<"edit" | "preview">("preview")
  // 如果加载时发现本地有未提交的草稿(跟后端原始不一致),记下时间戳用于显示恢复 banner
  const [outlineDraftRestoredTs, setOutlineDraftRestoredTs] = useState<number | null>(null)

  // OutlineView 编辑器草稿自动存档 —— 仅在 paused 状态下保存,
  // 因为只有这个状态用户才能/才会去编辑 outline。
  // 节流 800ms,避免连续按键写穿 localStorage。
  const sjId = selectedJob?.id
  const sjStatus = selectedJob?.status
  const sjIsHistorical = selectedJob?.kind === "historical"
  useEffect(() => {
    if (!sjId || sjIsHistorical || sjStatus !== "paused") return
    if (!outlineText) return
    const timer = window.setTimeout(() => {
      writeOutlineDraft(sjId, outlineText)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [outlineText, sjId, sjStatus, sjIsHistorical])

  const loadOutline = async (jobId: string, force = false) => {
    try {
      const res = await fetch(API_BASE + `/jobs/${jobId}/files/outline`)
      if (!res.ok) return
      const data = await res.json()
      const fetched: string = data.content
      if (!force) {
        const draft = readOutlineDraft(jobId)
        // 本地草稿存在 + 跟后端原始不一致 → 恢复并提示
        if (draft && draft.content !== fetched) {
          setOutlineText(draft.content)
          setOutlineDraftRestoredTs(draft.ts)
          return
        }
      }
      setOutlineText(fetched)
      setOutlineDraftRestoredTs(null)
      clearOutlineDraft(jobId)
      // tab 切换由 selectedJob useEffect 统一管，loader 不再 setActiveTab —— 避免异步完成后覆盖用户手切的 tab。
    } catch (e) {
      console.warn("No outline.md yet", e)
    }
  }

  return {
    outlineText, setOutlineText,
    isSubmittingOutline, setIsSubmittingOutline,
    outlineViewMode, setOutlineViewMode,
    outlineDraftRestoredTs, setOutlineDraftRestoredTs,
    loadOutline,
  }
}

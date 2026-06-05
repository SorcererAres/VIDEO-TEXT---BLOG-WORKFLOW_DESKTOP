import { useState, useEffect } from 'react'
import { API_BASE } from '@/lib/api'
import { readDraftEdit, writeDraftEdit, clearDraftEdit } from '@/lib/draft-storage'
import type { EngineJob, ReviewJson } from '@/lib/job-types'

// 草稿与质检状态 + 本地编辑自动存档 + 加载器。从 App.tsx 抽离为自定义 hook（传入 selectedJob）。
// 审批提交（handleApproveDraft）仍留 App —— 它要联动 startSse / fetchJobs。
export function useDraftEditor(selectedJob: EngineJob | null) {
  // Review & Draft state —— draftContent 可编辑;分屏 / 草稿恢复都跟 OutlineView 一致
  const [draftContent, setDraftContent] = useState("")
  const [reviewJson, setReviewJson] = useState<ReviewJson | null>(null)
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false)
  const [draftViewMode, setDraftViewMode] = useState<"edit" | "preview">("preview")
  const [draftEditRestoredTs, setDraftEditRestoredTs] = useState<number | null>(null)

  const sjId = selectedJob?.id
  const sjStatus = selectedJob?.status
  const sjIsHistorical = selectedJob?.kind === "historical"
  // DraftReviewView 编辑器草稿同步 —— 跟 outline 一样的节流策略
  useEffect(() => {
    if (!sjId || sjIsHistorical || sjStatus !== "paused") return
    if (!draftContent) return
    const timer = window.setTimeout(() => {
      writeDraftEdit(sjId, draftContent)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [draftContent, sjId, sjStatus, sjIsHistorical])

  // force=true: 跳过本地编辑草稿,强制采用后端原始 draft
  const loadDraftAndReview = async (jobId: string, force = false) => {
    try {
      const draftRes = await fetch(API_BASE + `/jobs/${jobId}/files/draft`)
      if (draftRes.ok) {
        const draftData = await draftRes.json()
        const fetched: string = draftData.content
        let used = fetched
        if (!force) {
          const edit = readDraftEdit(jobId)
          if (edit && edit.content !== fetched) {
            used = edit.content
            setDraftEditRestoredTs(edit.ts)
          } else {
            setDraftEditRestoredTs(null)
            clearDraftEdit(jobId)
          }
        } else {
          setDraftEditRestoredTs(null)
          clearDraftEdit(jobId)
        }
        setDraftContent(used)
        // tab 切换由 selectedJob useEffect 统一管，loader 不再 setActiveTab
      }
      const reviewRes = await fetch(API_BASE + `/jobs/${jobId}/files/review_json`)
      if (reviewRes.ok) {
        // 后端 /jobs/{id}/files/{key} 返回 { content: "<file text>", path }，
        // review_json 的 content 是 JSON 字符串 —— 必须 parse 出来才是真正的 ReviewJson。
        // 之前直接 setReviewJson(reviewData)，导致 reviewJson.scores 是 undefined，
        // 触发"本轮无六维评分"假阳性（disk 上 6 维分数齐全也不显示）。
        const reviewWrapper: { content: string; path?: string } = await reviewRes.json()
        try {
          const inner = JSON.parse(reviewWrapper.content) as ReviewJson
          setReviewJson(inner)
        } catch (parseErr) {
          // JSON 损坏 —— 落 parse_failed 标志，让 UI 走"解析失败"分支 + 显示 raw_markdown 兜底
          setReviewJson({
            version: 0,
            verdict: "REVIEW",
            scores: {},
            total: "—",
            rebrief: "",
            raw_markdown: reviewWrapper.content,
            parse_failed: true,
          })
          console.warn("review_json 解析失败", parseErr)
        }
      }
    } catch (e) { console.warn("No draft / review_json found", e) }
  }

  return {
    draftContent, setDraftContent,
    reviewJson, setReviewJson,
    isSubmittingDraft, setIsSubmittingDraft,
    draftViewMode, setDraftViewMode,
    draftEditRestoredTs, setDraftEditRestoredTs,
    loadDraftAndReview,
  }
}

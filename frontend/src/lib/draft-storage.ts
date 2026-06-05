// 编辑器草稿的本地备份（localStorage，按 jobId 分桶）。
// paused 状态下用户在前端编辑 outline.md / draft.md，切走或刷新就丢，这里给一份本地备份。
// 纯函数模块（无 React 依赖），从 App.tsx 机械抽离而来。

// ─── 大纲编辑器草稿(localStorage,按 jobId 分桶)──
const OUTLINE_DRAFT_PREFIX = "v2b_outline_draft_"

export interface OutlineDraft {
  content: string
  ts: number
}

export function readOutlineDraft(jobId: string): OutlineDraft | null {
  try {
    const raw = localStorage.getItem(OUTLINE_DRAFT_PREFIX + jobId)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d !== "object" || typeof d.content !== "string") return null
    return d as OutlineDraft
  } catch {
    return null
  }
}

export function writeOutlineDraft(jobId: string, content: string) {
  try {
    localStorage.setItem(OUTLINE_DRAFT_PREFIX + jobId, JSON.stringify({ content, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function clearOutlineDraft(jobId: string) {
  try {
    localStorage.removeItem(OUTLINE_DRAFT_PREFIX + jobId)
  } catch {
    /* ignore */
  }
}

// ─── 草稿编辑器草稿(localStorage,按 jobId 分桶)──
// REVIEW 暂停时用户可以在前端微调 draft.md。如果切走/刷新就丢,这里给本地备份。
const DRAFT_EDIT_PREFIX = "v2b_draft_edit_"

export function readDraftEdit(jobId: string): OutlineDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_EDIT_PREFIX + jobId)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d !== "object" || typeof d.content !== "string") return null
    return d as OutlineDraft
  } catch {
    return null
  }
}

export function writeDraftEdit(jobId: string, content: string) {
  try {
    localStorage.setItem(DRAFT_EDIT_PREFIX + jobId, JSON.stringify({ content, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function clearDraftEdit(jobId: string) {
  try {
    localStorage.removeItem(DRAFT_EDIT_PREFIX + jobId)
  } catch {
    /* ignore */
  }
}

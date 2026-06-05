// 任务删除 / 撤销 / 归档清理 的 API 客户端。
// PR #5 起：sidebar 行 hover × + 右键 / Workspace ⋯ menu / FailureBanner 都会调这里。
//
// 设计：纯 fetch wrapper，错误直接 throw（含可读 detail），由调用方决定怎么 toast。
import { API_BASE } from "./api"

export interface HistoricalDeletePayload {
  /** output/Posts/<year>/<file>.md 相对路径 */
  post_path: string
  posts: boolean
  reviews: boolean
  work: boolean
  history_index: boolean
  fingerprints: boolean
}

export interface HistoricalDeleteResult {
  ok: true
  deleted: string[]
  errors: string[]
  stem: string
}

async function _handle<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  // 后端 HTTPException 统一返回 { detail: "..." }
  let detail = `HTTP ${res.status}`
  try {
    const j = await res.json()
    if (typeof j?.detail === "string") detail = j.detail
  } catch {
    /* 非 JSON */
  }
  throw new Error(detail)
}

/** 删除 live job（6s undo window）。成功返回 { undo_window_seconds: 6 }。 */
export async function deleteLiveJob(jobId: string): Promise<{ ok: true; undo_window_seconds: number }> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" })
  return _handle(res)
}

/** 撤销删除：6s 窗口内调用恢复 job 到 list。窗口外 → 404 throw。 */
export async function restoreLiveJob(jobId: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/restore`, { method: "POST" })
  return _handle(res)
}

/** 删除归档 job（含多选产物开关）。 */
export async function deleteHistoricalJob(p: HistoricalDeletePayload): Promise<HistoricalDeleteResult> {
  const qs = new URLSearchParams({
    post_path: p.post_path,
    posts: String(p.posts),
    reviews: String(p.reviews),
    work: String(p.work),
    history_index: String(p.history_index),
    fingerprints: String(p.fingerprints),
  })
  const res = await fetch(`${API_BASE}/jobs/history?${qs}`, { method: "DELETE" })
  return _handle(res)
}

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

/** （维护用·高危）按 post_path 彻底清扫产物链 —— post + review + work + 索引 + 指纹。
 *
 * DECOUPLE Round 3：原 deleteHistoricalJob（DELETE /jobs/history）迁到
 * POST /api/maintenance/purge。日常删作品请用 trash-actions.moveTrashPost（移 30 天回收站）。
 * 当前前端无 UI 入口，保留供后续"设置 → 维护"区直接调用。 */
export async function purgePostChain(p: HistoricalDeletePayload): Promise<HistoricalDeleteResult> {
  const res = await fetch(`${API_BASE}/api/maintenance/purge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  })
  return _handle(res)
}

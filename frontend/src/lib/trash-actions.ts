// 作品集 Trash 体系的前端客户端 —— PR #6。
// 后端 endpoints（PR #4 已落）：
//   DELETE /posts?post_path=...                → 移到 .trash（30 天保留）
//   GET    /trash/posts                        → 列回收站（按删除时间倒序）
//   POST   /trash/posts/{trash_id}/restore     → 还原到 output/Posts/<year>/
//   DELETE /trash/posts/{trash_id}             → 永久删
import { API_BASE } from "./api"

export interface TrashPost {
  /** trash 文件名 `<ts>__<year>__<orig>.md`，作为 ID */
  trash_id: string
  /** 原所在年份目录 */
  year: string
  /** 原文件名（含 .md） */
  original_name: string
  /** 删除时间戳（unix seconds） */
  deleted_at: number
  /** 字节数 */
  size: number
  /** 距永久清理还剩多少天（前端展示） */
  days_until_purge: number
}

export interface MoveToTrashResult {
  ok: true
  trash_id: string
  original_path: string
  retention_days: number
}

async function _handle<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let detail = `HTTP ${res.status}`
  try {
    const j = await res.json()
    if (typeof j?.detail === "string") detail = j.detail
  } catch {
    /* 非 JSON */
  }
  const err = new Error(detail) as Error & { status?: number }
  err.status = res.status
  throw err
}

/** 把作品集文章移到回收站。post_path = output/Posts/<year>/<file>.md */
export async function moveTrashPost(post_path: string): Promise<MoveToTrashResult> {
  const qs = new URLSearchParams({ post_path })
  const res = await fetch(`${API_BASE}/posts?${qs}`, { method: "DELETE" })
  return _handle(res)
}

/** 列回收站 */
export async function listTrashPosts(): Promise<TrashPost[]> {
  const res = await fetch(`${API_BASE}/trash/posts`)
  return _handle(res)
}

/** 还原到原位置。目标已存在时后端返回 409。 */
export async function restoreTrashPost(trash_id: string): Promise<{ ok: true; restored_to: string }> {
  const res = await fetch(`${API_BASE}/trash/posts/${encodeURIComponent(trash_id)}/restore`, { method: "POST" })
  return _handle(res)
}

/** 永久删 */
export async function purgeTrashPost(trash_id: string): Promise<{ ok: true }> {
  const res = await fetch(`${API_BASE}/trash/posts/${encodeURIComponent(trash_id)}`, { method: "DELETE" })
  return _handle(res)
}

// 参考范文 CRUD —— PR #7。后端 endpoints (PR #4 已落)：
//   GET    /knowledge/examples           列范文（含 title/word_count/size/mtime）
//   POST   /knowledge/examples           {filename, content} 上传
//   DELETE /knowledge/examples/{name}    删除
import { API_BASE } from "./api"

export interface Example {
  /** 文件名（不含路径，含 .md 后缀） */
  name: string
  /** 优先取 frontmatter.title，其次第一行 H1，最后 stem */
  title: string
  /** 正文去空白字符数（CJK 估算） */
  word_count: number
  size: number
  /** 修改时间（unix seconds） */
  mtime: number
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

export async function listExamples(): Promise<Example[]> {
  const res = await fetch(`${API_BASE}/knowledge/examples`)
  return _handle(res)
}

/** 上传一篇范文。filename 自动加 .md 后缀；非法字符 400；同名 409。 */
export async function uploadExample(filename: string, content: string): Promise<{ ok: true } & Example> {
  const res = await fetch(`${API_BASE}/knowledge/examples`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  })
  return _handle(res)
}

export async function deleteExample(name: string): Promise<{ ok: true; name: string }> {
  const res = await fetch(`${API_BASE}/knowledge/examples/${encodeURIComponent(name)}`, {
    method: "DELETE",
  })
  return _handle(res)
}

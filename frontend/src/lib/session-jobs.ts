// ─── 本会话提交的 job ID 跟踪（localStorage）──
// 5/28 UX 诊断：侧栏"当前会话"实际上是"所有 restore 出来的活跃 job"，
// 把今天主动提交的和半年前残留的混在一起。用 localStorage 显式记录本浏览器
// 用户主动提交过的 job ID，让"本会话" tab 真正只显示用户视角的"本会话"。
// App.tsx（提交时 push）和 components/jobs.tsx（JobList 读取过滤）共用。
const SESSION_JOB_IDS_KEY = "v2b_session_job_ids"

export function readSessionJobIds(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_JOB_IDS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : []
  } catch {
    return []
  }
}

export function pushSessionJobId(id: string) {
  try {
    const ids = readSessionJobIds()
    if (!ids.includes(id)) {
      ids.push(id)
      // 留最近 100 个，避免无限增长
      const trimmed = ids.length > 100 ? ids.slice(-100) : ids
      localStorage.setItem(SESSION_JOB_IDS_KEY, JSON.stringify(trimmed))
    }
  } catch {
    /* localStorage 满了忽略 */
  }
}

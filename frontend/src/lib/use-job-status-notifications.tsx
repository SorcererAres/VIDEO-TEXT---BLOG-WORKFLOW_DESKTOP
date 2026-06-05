import { useRef } from 'react'
import { toast } from 'sonner'
import type { EngineJob } from '@/lib/job-types'
import { isTauri } from '@/lib/is-tauri'

// ═══════════════════ Pause icon for toast ═══════════════════
function Pause() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

// 任务列表的状态跃迁提醒：对比上一轮 jobs，对发生状态跃迁的任务发提醒。
// 从 App.tsx 抽离为自定义 hook —— 返回 detectStatusTransitions，由 App 注入 useTasks 的
// onDataRef（fetchTasks 拉到新数据时调用）。detectStatusTransitions 每次 render 是新闭包，
// 与抽离前一致（App 仍每 render 重新赋值给 tasksOnDataRef.current）。
export function useJobStatusNotifications() {
  const prevJobStatesRef = useRef<Map<string, string>>(new Map())
  const jobsNotifyInitRef = useRef(false)

  // 任务状态提醒。前台（窗口聚焦）用轻量 toast 不打扰；Tauri 壳里窗口失焦/后台时
  // 改走 macOS 系统通知中心（可点击唤回）。非 Tauri（浏览器）一律 toast。
  const toastJobEvent = (kind: "info" | "success" | "error", title: string, body: string) => {
    if (kind === "success") toast.success(title, { description: body })
    else if (kind === "error") toast.error(title, { description: body })
    else toast(title, { description: body, icon: <Pause /> })
  }
  const notifyJobEvent = (kind: "info" | "success" | "error", title: string, body: string) => {
    const inForeground = typeof document !== "undefined" && document.hasFocus()
    if (!isTauri || inForeground) { toastJobEvent(kind, title, body); return }
    // 后台 + Tauri：送系统通知中心；权限未授予 / 出错则回退 toast（回前台仍可见）
    void (async () => {
      try {
        const n = await import("@tauri-apps/plugin-notification")
        let granted = await n.isPermissionGranted()
        if (!granted) granted = (await n.requestPermission()) === "granted"
        if (granted) n.sendNotification({ title, body })
        else toastJobEvent(kind, title, body)
      } catch {
        toastJobEvent(kind, title, body)
      }
    })()
  }

  // 一个 job 的「通知意义」复合键：paused 要区分卡在哪个人工节点。
  const jobNotifyKey = (j: EngineJob) =>
    j.status === "paused" ? `paused:${j.paused_state ?? ""}` : j.status

  // 对比上一轮 jobs，对发生状态跃迁的任务发提醒。首轮只建立基线、不提醒
  //（否则启动时会把 restore 出来的旧 paused/succeeded 任务全弹一遍）。
  // 首次见到的新任务也只记录不弹，只有「已知任务的状态变了」才提醒。
  const detectStatusTransitions = (newJobs: EngineJob[]) => {
    const prev = prevJobStatesRef.current
    const next = new Map<string, string>()
    for (const j of newJobs) next.set(j.id, jobNotifyKey(j))

    if (jobsNotifyInitRef.current) {
      for (const j of newJobs) {
        const before = prev.get(j.id)
        const after = next.get(j.id)!
        if (before === undefined || before === after) continue
        if (after === "paused:WAITING_USER_OUTLINE") {
          notifyJobEvent("info", "等你审批大纲", `「${j.stem}」Step 5 已生成 outline.md`)
        } else if (after === "paused:WAITING_USER_REVIEW") {
          notifyJobEvent("info", "等你审稿", `「${j.stem}」请打开「草稿与质检」`)
        } else if (after === "succeeded") {
          notifyJobEvent("success", "博文生成完成", `「${j.stem}」成品已落盘 output/Posts/`)
        } else if (after === "failed") {
          notifyJobEvent("error", "任务失败", `「${j.stem}」${j.error ? "：" + j.error.slice(0, 80) : ""}`)
        }
      }
    }
    prevJobStatesRef.current = next
    jobsNotifyInitRef.current = true
  }

  return { detectStatusTransitions }
}

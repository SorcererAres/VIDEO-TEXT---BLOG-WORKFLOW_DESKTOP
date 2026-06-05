import { useCallback, useRef, useState } from "react"
import { API_BASE } from "./api"
import type { EngineJob } from "./job-types"

/**
 * 任务域 store（DECOUPLE Round 2）。
 *
 * 把原先内联在 App.tsx 的 `jobs` state + `fetchJobs` 抽出。数据源切到
 * Round 1 新增的 `/api/tasks`（与旧 `/jobs` 返回字节一致）。
 *
 * onDataRef：App 注入"拿到新列表、setState 之前"要跑的副作用 —— 当前是
 * detectStatusTransitions（状态跃迁通知）。用 ref 而非参数，是为了规避
 * detectStatusTransitions 定义在 hook 调用点之后造成的 TDZ；App 在其定义后
 * 每次 render 把最新闭包写入 onDataRef.current 即可。
 */
export function useTasks() {
  const [tasks, setTasks] = useState<EngineJob[]>([])
  const onDataRef = useRef<((data: EngineJob[]) => void) | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + "/api/tasks")
      if (res.ok) {
        const data: EngineJob[] = await res.json()
        // 后端按创建顺序返回，前端列表最新在上 → reverse（与旧 fetchJobs 一致）
        data.reverse()
        onDataRef.current?.(data)
        setTasks(data)
      }
    } catch (e) {
      console.error("Failed to fetch tasks list", e)
    }
  }, [])

  return { tasks, setTasks, fetchTasks, onDataRef }
}

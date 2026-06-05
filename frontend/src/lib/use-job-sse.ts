import { useState, useRef } from 'react'
import { API_BASE } from '@/lib/api'
import {
  mapProgress,
  systemEvent,
  successEvent,
  errorEvent,
  pausedEvent,
  type ParsedEvent,
  type ProgressData,
} from '@/lib/log-parser'

// SSE 连接状态机 —— terminal 表示任务已 succeeded/failed,不应再重连
export type SseStatus = "idle" | "connecting" | "connected" | "reconnecting" | "terminal"

// 任务事件流（SSE）：日志 / 结构化进度 + 连接生命周期 + 指数退避重连。
// 从 App.tsx 抽离为自定义 hook。connectSse 的 paused/succeeded/failed 处理要拉新任务列表，
// 故注入 fetchJobs（来自 useTasks）。selectedJob 选择编排（startSse/resetSse 的调用时机）仍留 App。
export function useJobSse(fetchJobs: () => void) {
  // logs = 原始 print 文本流（「原始日志」视图排查用）；
  // progressEvents = 结构化叙事（来自后端 progress + job 生命周期事件）。H1 去耦后两者分离。
  const [logs, setLogs] = useState<string[]>([])
  const [progressEvents, setProgressEvents] = useState<ParsedEvent[]>([])
  const sseRef = useRef<EventSource | null>(null)
  const [sseStatus, setSseStatus] = useState<SseStatus>("idle")
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const sseAttemptsRef = useRef(0)
  const sseReconnectTimerRef = useRef<number | null>(null)
  const sseTargetJobRef = useRef<string | null>(null)

  // 彻底关掉 SSE 并清掉待发的重连定时器
  const tearDownSse = () => {
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }
    if (sseReconnectTimerRef.current !== null) {
      window.clearTimeout(sseReconnectTimerRef.current)
      sseReconnectTimerRef.current = null
    }
  }

  // 启动一个全新的 SSE 会话(新 job 或重选 job 时调一次)
  const startSse = (jobId: string) => {
    tearDownSse()
    sseTargetJobRef.current = jobId
    sseAttemptsRef.current = 0
    setLogs([])
    setProgressEvents([])
    setSseStatus("connecting")
    setLastEventAt(null)
    connectSse(jobId)
  }

  // 实际建连(也用于退避重连)
  const connectSse = (jobId: string) => {
    // 若目标 job 已被换走(用户点了别的任务),直接放弃
    if (sseTargetJobRef.current !== jobId) return

    const isReconnect = sseAttemptsRef.current > 0
    setSseStatus(isReconnect ? "reconnecting" : "connecting")

    const source = new EventSource(API_BASE + `/jobs/${jobId}/events`)
    sseRef.current = source

    const markEvent = () => setLastEventAt(Date.now())

    source.onopen = () => {
      setSseStatus("connected")
      sseAttemptsRef.current = 0
      markEvent()
    }

    source.addEventListener("log", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const msg = eventData.data?.message || ""
        if (msg) setLogs(prev => [...prev, msg])
      } catch (err) { console.error("Err parsing SSE log event", err) }
    })

    // 结构化进度事件（H1）：后端直接给语义字段，前端只做 kind→展示 映射，不再正则反解析。
    source.addEventListener("progress", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const data = eventData.data as ProgressData | undefined
        if (data?.kind) setProgressEvents(prev => [...prev, mapProgress(data)])
      } catch (err) { console.error("Err parsing SSE progress event", err) }
    })

    source.addEventListener("started", () => {
      markEvent()
      setProgressEvents(prev => [...prev, systemEvent("任务开始执行")])
    })

    // 注意：paused/succeeded/failed 这三类「状态提醒」**不在这里弹 toast**。
    // SSE 一连上后端会重放该任务的历史事件（日志面板需要），重放到历史 paused
    // 行就会误触发提醒——这正是"切到已完成任务也弹『等你审批』"的根因。
    // 提醒统一改由 detectStatusTransitions（基于 jobs 列表真实状态跃迁）发出，
    // 重放不改变列表状态 → 不会误弹。这里只管日志 + 连接生命周期。
    source.addEventListener("paused", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const stateStatus = eventData.data?.state_status || ""
        setProgressEvents(prev => [...prev, pausedEvent(stateStatus)])
        fetchJobs() // 拉新列表 → detectStatusTransitions 据真实跃迁发提醒
        setSseStatus("terminal")
        sseTargetJobRef.current = null
        tearDownSse()
      } catch (err) { console.error("Err parsing SSE paused event", err) }
    })

    source.addEventListener("succeeded", () => {
      markEvent()
      setProgressEvents(prev => [...prev, successEvent("全部步骤已通过")])
      fetchJobs()
      setSseStatus("terminal")
      sseTargetJobRef.current = null // 防止队列里残留的 onerror 触发重连
      tearDownSse()
    })

    source.addEventListener("failed", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const err = eventData.data?.error || ""
        setProgressEvents(prev => [...prev, errorEvent(`任务失败：${err}`)])
        fetchJobs()
      } catch (err) { console.error("Err parsing SSE failed event", err) }
      setSseStatus("terminal")
      sseTargetJobRef.current = null
      tearDownSse()
    })

    source.onerror = () => {
      // EventSource 会自己尝试重连,但我们要管控状态条 + 实现指数退避。
      // 关掉它,手动调度下一次。
      source.close()
      if (sseRef.current === source) sseRef.current = null

      // 目标已换走 / 已 terminal(succeeded/failed 把 ref 置 null),不再重连
      if (sseTargetJobRef.current !== jobId) return

      sseAttemptsRef.current += 1
      const attempts = sseAttemptsRef.current
      const backoff = Math.min(30000, 1000 * 2 ** (attempts - 1))
      setSseStatus("reconnecting")
      sseReconnectTimerRef.current = window.setTimeout(() => {
        sseReconnectTimerRef.current = null
        connectSse(jobId)
      }, backoff)
    }
  }

  // 切到无 live SSE 的场景（无选中 / 历史归档）时复位事件流与连接 —— 与 App 选择 effect
  // 原先两处内联的重置（清 logs/progressEvents、idle、清目标、tearDown）逐字等价。
  const resetSse = () => {
    setLogs([])
    setProgressEvents([])
    setSseStatus("idle")
    sseTargetJobRef.current = null
    tearDownSse()
  }

  // setProgressEvents 暴露给 App：handleApproveDraft 拒绝分支要追加一条「草稿已拒绝」系统事件。
  return { logs, progressEvents, setProgressEvents, sseStatus, lastEventAt, startSse, tearDownSse, resetSse }
}

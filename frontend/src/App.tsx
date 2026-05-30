import { useState, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Plus,
  AlertCircle,
  X,
  Settings,
  Search,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { pushRecentSource } from '@/components/SourcePicker'
import { ConfirmDialogHost, confirmAction } from '@/components/ConfirmDialog'
import { CreateForm } from '@/components/CreateForm'
import { JobList, HomeView, JobWorkspace } from '@/components/jobs'
import { SettingsPanel } from '@/components/settings'
import { inferCurrentStep, parseLogLine, type ParsedEvent } from '@/lib/log-parser'
import { API_BASE } from '@/lib/api'
import {
  listProfiles,
  type LlmProfile,
} from '@/lib/settings-store'
import {
  COMMON_MODELS,
  type EngineJob,
  type ReviewJson,
} from '@/lib/job-types'
import { pushSessionJobId } from '@/lib/session-jobs'

// 任务数据类型 + 跨视图的小工具搬到 lib/job-types.ts，下方按需 import。

// ─── 新建任务表单草稿(localStorage)──
// 用户在 CreateForm 填到一半切走,回来时不丢内容。提交成功后清掉。
interface CreateDraft {
  source: string
  speaker: string
  routing: string
  mode: "full" | "quick"
  maxRetries: number
  model: string
  force: boolean
  pauseOnOutline: boolean
  rewriteStrategy: "single" | "sectioned"
  ts: number
}
const CREATE_DRAFT_KEY = "v2b_create_draft"

function readCreateDraft(): CreateDraft | null {
  try {
    const raw = localStorage.getItem(CREATE_DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d !== "object" || !d.source) return null
    return d as CreateDraft
  } catch {
    return null
  }
}

function writeCreateDraft(d: CreateDraft) {
  try {
    localStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(d))
  } catch {
    /* localStorage 满了 / 隐私模式拒绝,忽略 */
  }
}

function clearCreateDraft() {
  try {
    localStorage.removeItem(CREATE_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

// ─── 大纲编辑器草稿(localStorage,按 jobId 分桶)──
// paused 状态下用户编辑 outline.md,切走/刷新就丢。这里给一份本地备份。
const OUTLINE_DRAFT_PREFIX = "v2b_outline_draft_"

interface OutlineDraft {
  content: string
  ts: number
}

function readOutlineDraft(jobId: string): OutlineDraft | null {
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

function writeOutlineDraft(jobId: string, content: string) {
  try {
    localStorage.setItem(OUTLINE_DRAFT_PREFIX + jobId, JSON.stringify({ content, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

function clearOutlineDraft(jobId: string) {
  try {
    localStorage.removeItem(OUTLINE_DRAFT_PREFIX + jobId)
  } catch {
    /* ignore */
  }
}

// ─── 草稿编辑器草稿(localStorage,按 jobId 分桶)──
// REVIEW 暂停时用户可以在前端微调 draft.md。如果切走/刷新就丢,这里给本地备份。
const DRAFT_EDIT_PREFIX = "v2b_draft_edit_"

function readDraftEdit(jobId: string): OutlineDraft | null {
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

function writeDraftEdit(jobId: string, content: string) {
  try {
    localStorage.setItem(DRAFT_EDIT_PREFIX + jobId, JSON.stringify({ content, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

function clearDraftEdit(jobId: string) {
  try {
    localStorage.removeItem(DRAFT_EDIT_PREFIX + jobId)
  } catch {
    /* ignore */
  }
}

// 本会话 job ID 跟踪（readSessionJobIds / pushSessionJobId）搬到 lib/session-jobs.ts，
// App.tsx 提交时 push、components/jobs.tsx 的 JobList 读取过滤，共用一处。

// 是否运行在 Tauri 壳内（决定交通灯留白 / vibrancy 等原生壳专属处理）
const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export default function App() {
  const [jobs, setJobs] = useState<EngineJob[]>([])
  const [historicalJobs, setHistoricalJobs] = useState<EngineJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<EngineJob | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<"console" | "outline" | "review" | "final" | "artifacts">("console")
  const [healthStatus, setHealthStatus] = useState<"online" | "offline">("offline")
  // 可收起的安静侧栏（Claude recents 气质）—— 状态持久化
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("v2b_sidebar_open") !== "0")
  useEffect(() => { localStorage.setItem("v2b_sidebar_open", sidebarOpen ? "1" : "0") }, [sidebarOpen])

  // Settings 表单已自包含（自行从后端 GET /api/llm-config 加载 + 保存），父级不再持有 LLM 配置 state。

  // Outline Editing state —— 默认分屏(左编辑右预览),桌面端最高效
  const [outlineText, setOutlineText] = useState("")
  const [isSubmittingOutline, setIsSubmittingOutline] = useState(false)
  const [outlineViewMode, setOutlineViewMode] = useState<"edit" | "preview" | "split">("split")
  // 如果加载时发现本地有未提交的草稿(跟后端原始不一致),记下时间戳用于显示恢复 banner
  const [outlineDraftRestoredTs, setOutlineDraftRestoredTs] = useState<number | null>(null)

  // Review & Draft state —— draftContent 可编辑;分屏 / 草稿恢复都跟 OutlineView 一致
  const [draftContent, setDraftContent] = useState("")
  const [reviewJson, setReviewJson] = useState<ReviewJson | null>(null)
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false)
  const [draftViewMode, setDraftViewMode] = useState<"edit" | "preview" | "split">("split")
  const [draftEditRestoredTs, setDraftEditRestoredTs] = useState<number | null>(null)

  // Creation Form state —— 启动时如果有 localStorage 草稿就预填,避免模态切换丢失输入
  const draftInit = useRef<CreateDraft | null>(readCreateDraft()).current
  const [source, setSource] = useState(() => draftInit?.source ?? "")
  // 记住上次用的 speaker —— 这是个高频字段,默认就用上次的值,只有第一次才回退到"我"
  const [speaker, setSpeaker] = useState(() => draftInit?.speaker ?? (localStorage.getItem("v2b_last_speaker") || "我"))
  // 演讲人自动识别：提示 + AI 识别中态 + 用户是否手动改过（手动改过就不自动覆盖）
  const [speakerHint, setSpeakerHint] = useState<{ text: string; tone: "ok" | "warn" } | null>(null)
  const [detectingSpeaker, setDetectingSpeaker] = useState(false)
  const speakerTouchedRef = useRef(false)
  const [routing, setRouting] = useState(() => draftInit?.routing ?? "/lecture")
  const [mode, setMode] = useState<"full" | "quick">(() => draftInit?.mode ?? "full")
  const [maxRetries, setMaxRetries] = useState(() => draftInit?.maxRetries ?? 1)
  const [model, setModel] = useState(() => draftInit?.model ?? "")
  const [force, setForce] = useState(() => draftInit?.force ?? false)
  const [pauseOnOutline, setPauseOnOutline] = useState(() => draftInit?.pauseOnOutline ?? true)
  const [rewriteStrategy, setRewriteStrategy] = useState<"single" | "sectioned">(
    () => draftInit?.rewriteStrategy ?? "single",
  )
  const [isSubmittingJob, setIsSubmittingJob] = useState(false)
  const [draftRestoredTs, setDraftRestoredTs] = useState<number | null>(() => draftInit?.ts ?? null)

  // 建任务时用哪个配置档 —— ""=跟随默认；列表与默认从 /api/llm-profiles 拉取
  const [profileId, setProfileId] = useState<string>("")
  const [profileOptions, setProfileOptions] = useState<LlmProfile[]>([])
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null)

  // 侧栏任务列表过滤 —— 历史归档一多就难找,加搜索 + 状态 chip
  const [jobQuery, setJobQuery] = useState("")
  const [jobFilter, setJobFilter] = useState<"all" | "active" | "waiting" | "done" | "failed">("all")

  const sseRef = useRef<EventSource | null>(null)
  // SSE 连接状态机 —— terminal 表示任务已 succeeded/failed,不应再重连
  type SseStatus = "idle" | "connecting" | "connected" | "reconnecting" | "terminal"
  const [sseStatus, setSseStatus] = useState<SseStatus>("idle")
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const sseAttemptsRef = useRef(0)
  const sseReconnectTimerRef = useRef<number | null>(null)
  const sseTargetJobRef = useRef<string | null>(null)

  // 外观跟随系统：由 main.tsx 的 next-themes ThemeProvider 接管（浅/深/自动），
  // 不再强制 .dark。用户可在 Settings 手动覆盖三态。

  // CreateForm 草稿自动存档 —— source 非空就节流写入 500ms
  // 没填 source 的"空草稿"不写,避免用户每次开页都看到 banner
  useEffect(() => {
    if (!source.trim()) return
    const timer = window.setTimeout(() => {
      writeCreateDraft({
        source, speaker, routing, mode, maxRetries, model, force, pauseOnOutline, rewriteStrategy,
        ts: Date.now(),
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [source, speaker, routing, mode, maxRetries, model, force, pauseOnOutline, rewriteStrategy])

  // OutlineView 编辑器草稿自动存档 —— 仅在 paused 状态下保存,
  // 因为只有这个状态用户才能/才会去编辑 outline。
  // 节流 800ms,避免连续按键写穿 localStorage。
  const sjId = selectedJob?.id
  const sjStatus = selectedJob?.status
  const sjIsHistorical = selectedJob?.kind === "historical"
  useEffect(() => {
    if (!sjId || sjIsHistorical || sjStatus !== "paused") return
    if (!outlineText) return
    const timer = window.setTimeout(() => {
      writeOutlineDraft(sjId, outlineText)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [outlineText, sjId, sjStatus, sjIsHistorical])

  // DraftReviewView 编辑器草稿同步 —— 跟 outline 一样的节流策略
  useEffect(() => {
    if (!sjId || sjIsHistorical || sjStatus !== "paused") return
    if (!draftContent) return
    const timer = window.setTimeout(() => {
      writeDraftEdit(sjId, draftContent)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [draftContent, sjId, sjStatus, sjIsHistorical])

  // Check health and load jobs initially —— 标签页隐藏时暂停轮询,省电省后端
  useEffect(() => {
    checkHealth()
    fetchJobs()
    fetchHistory()
    fetchProfiles()

    let healthId: number | null = null
    let jobsId: number | null = null
    let historyId: number | null = null

    const startPolling = () => {
      if (healthId === null) healthId = window.setInterval(checkHealth, 8000)
      if (jobsId === null) jobsId = window.setInterval(fetchJobs, 5000)
      // 历史归档磁盘扫描,频率低一些(磁盘不会频繁变)
      if (historyId === null) historyId = window.setInterval(fetchHistory, 30000)
    }
    const stopPolling = () => {
      if (healthId !== null) { window.clearInterval(healthId); healthId = null }
      if (jobsId !== null) { window.clearInterval(jobsId); jobsId = null }
      if (historyId !== null) { window.clearInterval(historyId); historyId = null }
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        // 回到前台立刻刷一次,把"离线期间"的状态拉新
        checkHealth()
        fetchJobs()
        fetchHistory()
        startPolling()
      }
    }

    if (!document.hidden) startPolling()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  // 全局键盘快捷键 —— 桌面应用必备
  //   Cmd/Ctrl + N    新建任务
  //   Cmd/Ctrl + ,    打开设置
  //   Cmd/Ctrl + K    聚焦侧栏搜索
  //   Esc             关闭 CreateForm / SettingsForm
  // (Cmd+Enter 提交在 CreateForm 的 form onKeyDown 里处理)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      const inInput = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )

      // Tauri 壳里 Cmd+N / Cmd+, 由原生菜单加速键负责（见 src-tauri/src/lib.rs），
      // webview 不再重复处理，避免双触发。
      if (isMod && e.key.toLowerCase() === "n" && !inInput && !isTauri) {
        e.preventDefault()
        if (healthStatus !== "offline") {
          setIsCreating(true)
          setSelectedJobId(null)
          setShowSettings(false)
        }
        return
      }

      if (isMod && e.key === "," && !isTauri) {
        e.preventDefault()
        setShowSettings(true)
        setIsCreating(false)
        setSelectedJobId(null)
        return
      }

      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>("input[placeholder^='搜索 stem']")
        input?.focus()
        input?.select()
        return
      }

      if (isMod && e.key === "\\") {
        e.preventDefault()
        setSidebarOpen(v => !v)
        return
      }

      if (e.key === "Escape" && !inInput) {
        if (isCreating) {
          setIsCreating(false)
          return
        }
        if (showSettings) {
          setShowSettings(false)
          return
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [healthStatus, isCreating, showSettings])

  // Tauri 壳：监听原生菜单事件（新建任务）+ 设置窗改了配置档后回灌
  useEffect(() => {
    if (!isTauri) return
    const uns: Array<Promise<() => void>> = []
    uns.push(listen("menu:new", () => {
      if (healthStatus !== "offline") {
        setIsCreating(true); setSelectedJobId(null); setShowSettings(false)
      }
    }))
    uns.push(listen("profiles:changed", () => { fetchProfiles() }))
    return () => { uns.forEach(p => p.then(f => f()).catch(() => {})) }
  }, [healthStatus])

  // 演讲人手输：标记"用户改过"，自动识别不再覆盖
  const handleSpeakerInput = (v: string) => { speakerTouchedRef.current = true; setSpeaker(v) }

  // 选源后自动跑免费启发式识别演讲人；命中且用户没手动改过则回填，否则提示兜底
  useEffect(() => {
    speakerTouchedRef.current = false
    setSpeakerHint(null)
    if (!source.trim() || healthStatus === "offline") return
    let cancelled = false
    fetch(API_BASE + "/api/detect-speaker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, use_llm: false }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { speaker: string | null; reason?: string } | null) => {
        if (cancelled || !d) return
        if (d.speaker && !speakerTouchedRef.current) {
          setSpeaker(d.speaker)
          setSpeakerHint({ text: `已自动识别：${d.speaker}（可改）`, tone: "ok" })
        } else if (!d.speaker) {
          setSpeakerHint({ text: `${d.reason ? d.reason + "；" : "未自动识别出演讲人，"}已沿用上次，请确认或点「AI 识别」`, tone: "warn" })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // AI 识别演讲人（用默认/所选配置档，一次很便宜）
  const detectSpeakerAI = async () => {
    if (!source.trim() || !requireOnline("识别演讲人")) return
    setDetectingSpeaker(true)
    try {
      const r = await fetch(API_BASE + "/api/detect-speaker", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, profile_id: profileId || undefined, use_llm: true }),
      })
      const d: { speaker: string | null; reason?: string } = await r.json()
      if (d.speaker) {
        speakerTouchedRef.current = false
        setSpeaker(d.speaker)
        setSpeakerHint({ text: `AI 识别：${d.speaker}（可改）`, tone: "ok" })
      } else {
        setSpeakerHint({ text: `${d.reason || "AI 未能识别"}，请手填或沿用「${speaker}」`, tone: "warn" })
      }
    } catch (e) {
      setSpeakerHint({ text: `识别失败：${String(e)}`, tone: "warn" })
    } finally {
      setDetectingSpeaker(false)
    }
  }

  // 开始新建任务（离线时拦截）
  const startCreate = () => {
    if (healthStatus === "offline") { toast.error("后端服务离线", { description: "请先启动后端，再新建任务" }); return }
    setIsCreating(true); setSelectedJobId(null); setShowSettings(false)
  }

  // 打开设置：Tauri 壳里开独立窗口（macOS 规范），浏览器里退回主窗口内嵌视图
  const openSettings = () => {
    if (isTauri) {
      invoke("open_settings").catch(() => {})
    } else {
      setShowSettings(true); setIsCreating(false); setSelectedJobId(null)
    }
  }

  // Select job update & SSE trigger
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null)
      setLogs([])
      sseTargetJobRef.current = null
      tearDownSse()
      setSseStatus("idle")
      return
    }

    // 同时在 live 和 historical 里找;live 优先
    const job = jobs.find(j => j.id === selectedJobId) ?? historicalJobs.find(j => j.id === selectedJobId)
    if (job) {
      const prevStatus = selectedJob?.status
      setSelectedJob(job)

      // 历史归档:不打 SSE,不拉 work/* 产物,直接挂"成品及报告"tab
      if (job.kind === "historical") {
        sseTargetJobRef.current = null
        tearDownSse()
        setSseStatus("idle")
        setLogs([])
        setActiveTab("final")
        return
      }

      if (job.status === "paused") {
        // 关键：用后端的 paused_state 决定加载 outline 还是 draft，**不再盲调两个**。
        // 之前是 loadDraftAndReview 末尾 setActiveTab("review") 永远赢，把 WAITING_USER_OUTLINE
        // 的任务硬切到 review tab + 显示上一轮残留的 draft —— 5/28 撞了 3 次的同一类 bug。
        fetch(API_BASE + `/jobs/${job.id}`)
          .then(res => res.json())
          .then(data => {
            if (data.status !== "paused") return
            if (data.paused_state === "WAITING_USER_OUTLINE") {
              loadOutline(job.id)
            } else if (data.paused_state === "WAITING_USER_REVIEW") {
              loadDraftAndReview(job.id)
            } else {
              // 老后端兼容：缺 paused_state 字段时按"outline 永远先于 draft"试
              loadOutline(job.id)
              loadDraftAndReview(job.id)
            }
          })
      } else if (job.status === "succeeded") {
        if (activeTab === "outline" || activeTab === "review") {
          setActiveTab("final")
        }
      }

      if (job.id !== selectedJob?.id || (job.status !== prevStatus && (job.status === "running" || job.status === "queued"))) {
        startSse(job.id)
      }
    }
  }, [selectedJobId, jobs, historicalJobs])

  const checkHealth = async () => {
    try {
      const res = await fetch(API_BASE + "/health")
      setHealthStatus(res.ok ? "online" : "offline")
    } catch {
      setHealthStatus("offline")
    }
  }

  const fetchJobs = async () => {
    try {
      const res = await fetch(API_BASE + "/jobs")
      if (res.ok) {
        const data = await res.json()
        setJobs(data.reverse())
      }
    } catch (e) {
      console.error("Failed to fetch jobs list", e)
    }
  }

  const fetchHistory = async () => {
    try {
      const res = await fetch(API_BASE + "/jobs/history")
      if (res.ok) {
        const data: EngineJob[] = await res.json()
        setHistoricalJobs(data)
      }
    } catch (e) {
      console.error("Failed to fetch history", e)
    }
  }

  // 拉配置档列表 —— 建任务的「配置档」选择器用；SettingsForm 改动后也会回调刷新
  const fetchProfiles = async () => {
    try {
      const snap = await listProfiles()
      setProfileOptions(snap.profiles)
      setDefaultProfileId(snap.defaultProfileId)
      // 选中的档若已被删/停用，回退到「跟随默认」，避免 <select> 值悬空
      setProfileId(prev => (prev && snap.profiles.some(p => p.id === prev && p.enabled) ? prev : ""))
    } catch (e) {
      console.error("Failed to fetch llm profiles", e)
    }
  }

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

    source.addEventListener("started", () => {
      markEvent()
      setLogs(prev => [...prev, "[*] Backend job execution started..."])
    })

    source.addEventListener("paused", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const stateStatus = eventData.data?.state_status || ""
        setLogs(prev => [...prev, `[!] Workflow suspended: Paused at ${stateStatus}`])
        fetchJobs()
        if (stateStatus === "WAITING_USER_OUTLINE") {
          toast("等你审批大纲", { description: "Step 5 已生成 outline.md", icon: <Pause /> })
        } else if (stateStatus === "WAITING_USER_REVIEW") {
          toast("等你审稿", { description: "请打开「草稿与质检」", icon: <Pause /> })
        }
        setSseStatus("terminal")
        sseTargetJobRef.current = null
        tearDownSse()
      } catch (err) { console.error("Err parsing SSE paused event", err) }
    })

    source.addEventListener("succeeded", () => {
      markEvent()
      setLogs(prev => [...prev, "[✓] Job completed successfully!"])
      fetchJobs()
      toast.success("博文生成完成", { description: "成品已落盘到 output/Posts/" })
      setSseStatus("terminal")
      sseTargetJobRef.current = null // 防止队列里残留的 onerror 触发重连
      tearDownSse()
    })

    source.addEventListener("failed", (e: MessageEvent) => {
      markEvent()
      try {
        const eventData = JSON.parse(e.data)
        const err = eventData.data?.error || ""
        setLogs(prev => [...prev, `[错误] Job failed: ${err}`])
        fetchJobs()
        toast.error("任务失败", { description: err })
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

  // force=true: 跳过本地草稿,强制采用后端原始 outline
  const loadOutline = async (jobId: string, force = false) => {
    try {
      const res = await fetch(API_BASE + `/jobs/${jobId}/files/outline`)
      if (!res.ok) return
      const data = await res.json()
      const fetched: string = data.content
      if (!force) {
        const draft = readOutlineDraft(jobId)
        // 本地草稿存在 + 跟后端原始不一致 → 恢复并提示
        if (draft && draft.content !== fetched) {
          setOutlineText(draft.content)
          setOutlineDraftRestoredTs(draft.ts)
          setActiveTab("outline")
          return
        }
      }
      setOutlineText(fetched)
      setOutlineDraftRestoredTs(null)
      clearOutlineDraft(jobId)
      setActiveTab("outline")
    } catch (e) {
      console.warn("No outline.md yet", e)
    }
  }

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
        setActiveTab("review")
      }
      const reviewRes = await fetch(API_BASE + `/jobs/${jobId}/files/review_json`)
      if (reviewRes.ok) {
        const reviewData = await reviewRes.json()
        setReviewJson(reviewData)
      }
    } catch (e) { console.warn("No draft / review_json found", e) }
  }

  // 离线守卫 —— 销毁性 / 写操作前调一下,离线直接 toast 拦截
  const requireOnline = (action: string): boolean => {
    if (healthStatus === "offline") {
      toast.error("后端服务离线", { description: `请先启动后端,再${action}` })
      return false
    }
    return true
  }

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!source.trim()) return
    if (!requireOnline("提交任务")) return

    // 提交前 sanity check —— 仅当用户**显式填了** per-job 模型覆盖、且不在白名单时才拦
    // （留空走配置档的模型，配置档的模型已在 Settings 里验证过，无需再拦）
    const finalModelName = model.trim()
    if (finalModelName && !(COMMON_MODELS as readonly string[]).includes(finalModelName)) {
      const ok = await confirmAction({
        title: `模型名 "${finalModelName}" 不在常见列表里`,
        description: (
          <>
            常见模型: <code className="text-xs">{COMMON_MODELS.join(" / ")}</code>
            <br />
            如果模型名写错,任务可能会跑 5 分钟才超时失败。
            <b className="text-foreground">建议先到 Settings 用「测试连接」验证,避免浪费时间。</b>
          </>
        ),
        confirmText: "我确定,直接提交",
        cancelText: "我想先去 Settings 测一下",
        variant: "destructive",
      })
      if (!ok) return
    }

    setIsSubmittingJob(true)
    try {
      const payload: Record<string, unknown> = {
        source, speaker, routing, mode,
        max_retries: maxRetries,
        force,
        pause_on_outline: pauseOnOutline,
      }
      // §9-C：sectioned 仅在 full 模式有效，quick 时强制回 single 避免后端拒收。
      payload.rewrite_strategy = mode === "full" ? rewriteStrategy : "single"
      // 配置档：选了就带 profile_id，否则后端用默认档。api_key / api_base 不由前端发送。
      if (profileId) payload.profile_id = profileId
      // model 仅作为本任务对该档的临时覆盖：填了才带，否则用档里的模型。
      const finalModel = model.trim()
      if (finalModel) payload.model = finalModel

      const res = await fetch(API_BASE + "/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const data = await res.json()
        pushRecentSource(source) // 记入 localStorage,下次新建任务时排在最前面
        localStorage.setItem("v2b_last_speaker", speaker.trim() || "我")
        pushSessionJobId(data.id) // 标记本会话主动提交，sidebar"本会话"区只显示这些
        // 任务提交成功 —— 清掉表单草稿,下次回 CreateForm 是干净状态
        clearCreateDraft()
        setDraftRestoredTs(null)
        setIsCreating(false)
        setSource("")
        fetchJobs()
        setSelectedJobId(data.id)
        setActiveTab("console")
        toast.success("任务已提交", { description: `Job ${data.id.substring(0, 8)}` })
      } else {
        const err = await res.json()
        toast.error("创建失败", { description: err.detail || "未知错误" })
      }
    } catch (err) {
      toast.error("网络错误", { description: String(err) })
    } finally {
      setIsSubmittingJob(false)
    }
  }

  const handleApproveOutline = async () => {
    if (!selectedJob) return
    if (!requireOnline("批准大纲")) return
    setIsSubmittingOutline(true)
    try {
      const res = await fetch(API_BASE + `/jobs/${selectedJob.id}/approve-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline_markdown: outlineText }),
      })
      if (res.ok) {
        // 大纲已落到后端,本地草稿清掉
        clearOutlineDraft(selectedJob.id)
        setOutlineDraftRestoredTs(null)
        setActiveTab("console")
        startSse(selectedJob.id)
        fetchJobs()
        toast.success("大纲已批准", { description: "进入 Step 6 重写中" })
      } else {
        const err = await res.json()
        toast.error("大纲提交失败", { description: err.detail })
      }
    } catch (e) {
      toast.error("网络错误", { description: String(e) })
    } finally {
      setIsSubmittingOutline(false)
    }
  }

  const handleApproveDraft = async (accept: boolean) => {
    if (!selectedJob) return
    if (!requireOnline(accept ? "接受草稿" : "拒绝草稿")) return
    // 拒绝是销毁性操作 —— 工作流会中止,这次草稿丢弃。先二次确认。
    if (!accept) {
      const ok = await confirmAction({
        title: "拒绝当前草稿并中止工作流?",
        description: (
          <>
            草稿不会落盘,这次跑产生的内容会丢失。已消耗的 token 不退还。
            <br />
            如果只是想做小修改,建议先<b className="text-foreground">接受为 DRAFT</b>,落盘后再手动改。
          </>
        ),
        confirmText: "确认拒绝",
        cancelText: "再想想",
        variant: "destructive",
      })
      if (!ok) return
    }
    setIsSubmittingDraft(true)
    try {
      // accept 时把当前编辑后的 draftContent 一并传上去 —— 后端会覆盖 draft_v<best>.md 再落盘
      const body: Record<string, unknown> = { accept }
      if (accept && draftContent) {
        body.draft_markdown = draftContent
      }
      const res = await fetch(API_BASE + `/jobs/${selectedJob.id}/approve-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        // 草稿已落盘,清掉本地编辑备份
        clearDraftEdit(selectedJob.id)
        setDraftEditRestoredTs(null)
        setActiveTab("console")
        if (accept) {
          startSse(selectedJob.id)
          toast.success("已接受为 DRAFT", { description: "进入 Step 8 落盘归档" })
        } else {
          setLogs(prev => [...prev, "[!] Draft rejected. Workflow aborted by user."])
          toast("草稿已拒绝", { description: "工作流已中止" })
        }
        fetchJobs()
      } else {
        const err = await res.json()
        toast.error("提交失败", { description: err.detail })
      }
    } catch (e) {
      toast.error("网络错误", { description: String(e) })
    } finally {
      setIsSubmittingDraft(false)
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("已复制到剪贴板")
  }

  const handleCancelJob = async () => {
    if (!selectedJob) return
    if (!requireOnline("取消任务")) return
    const ok = await confirmAction({
      title: `取消任务「${selectedJob.stem}」?`,
      description: (
        <>
          正在跑的 LLM 调用会在最长 30 秒内结束,
          <b className="text-foreground">已完成的步骤会保留</b>。已消耗的 token 不退还。
        </>
      ),
      confirmText: "取消任务",
      cancelText: "继续运行",
      variant: "destructive",
    })
    if (!ok) return
    try {
      const res = await fetch(API_BASE + `/jobs/${selectedJob.id}/cancel`, { method: "POST" })
      if (res.ok) {
        toast.success("已发出取消信号", { description: "引擎会在下一个 checkpoint 退出" })
        fetchJobs()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error("取消失败", { description: err.detail || "未知错误" })
      }
    } catch (e) {
      toast.error("网络错误", { description: String(e) })
    }
  }

  const openInOS = async (path: string, mode: "finder" | "editor") => {
    try {
      const res = await fetch(API_BASE + "/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, mode }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error("打开失败", { description: err.detail || "" })
      }
    } catch (e) {
      toast.error("网络错误", { description: String(e) })
    }
  }

  // ----- derived state for visual layer -----
  const parsedEvents: ParsedEvent[] = useMemo(
    () => logs.map(parseLogLine).filter((e): e is ParsedEvent => e !== null),
    [logs],
  )
  const currentStep = useMemo(() => inferCurrentStep(parsedEvents), [parsedEvents])
  const pausedAt: "outline" | "review" | null = useMemo(() => {
    if (selectedJob?.status !== "paused") return null
    // 首选：用后端给的 paused_state。这是引擎实际状态机的真相，不会被
    // 上一轮残留的 draft_v* / review_v* 文件骗到。
    if (selectedJob.paused_state === "WAITING_USER_OUTLINE") return "outline"
    if (selectedJob.paused_state === "WAITING_USER_REVIEW") return "review"
    // 兜底：旧版后端没这个字段时按内容启发式（保持向后兼容）。
    if (draftContent) return "review"
    if (outlineText) return "outline"
    return null
    // deps 跟 React Compiler 推断对齐（整个 selectedJob 而非分散属性），
    // 否则触发 "Existing memoization could not be preserved" 编译失败。
  }, [selectedJob, outlineText, draftContent])

  // 用相同参数重跑失败任务 —— 把 job.request 灌回 CreateForm 并切到新建视图。
  // 关键:支持 modelOverride,失败 Banner 的"换 deepseek-chat 重跑"这种快速修复就走这一条。
  const handleRetryFromJob = (job: EngineJob, modelOverride?: string) => {
    const req = job.request
    setSource(req.source)
    setSpeaker(req.speaker)
    setRouting(req.routing)
    setMode(req.mode as "full" | "quick")
    setMaxRetries(req.max_retries)
    setModel(modelOverride ?? req.model ?? "")
    setForce(req.force)
    setPauseOnOutline(req.pause_on_outline)
    setRewriteStrategy((req.rewrite_strategy as "single" | "sectioned") ?? "single")
    // 这是"用相同参数重跑",不是"恢复未提交草稿",所以隐藏 banner
    setDraftRestoredTs(null)
    setIsCreating(true)
    setSelectedJobId(null)
    setShowSettings(false)
    if (modelOverride) {
      toast.success(`已换模型为 ${modelOverride}`, { description: "其他参数保持不变,确认后提交" })
    }
  }

  // 用户点"放弃恢复" —— 重置表单到默认值并清掉本地草稿
  const handleDiscardDraft = () => {
    setSource("")
    setSpeaker(localStorage.getItem("v2b_last_speaker") || "我")
    setRouting("/lecture")
    setMode("full")
    setMaxRetries(1)
    setModel("")
    setForce(false)
    setPauseOnOutline(true)
    setRewriteStrategy("single")
    clearCreateDraft()
    setDraftRestoredTs(null)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Toaster position="top-right" theme="system" />
      <ConfirmDialogHost />
      <div className="app-root flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
        {/* Tauri 壳：顶部 28px 拖拽条，给左上角交通灯留位（浏览器不渲染） */}
        {isTauri && <div className="h-7 shrink-0" data-tauri-drag-region />}
        {healthStatus === "offline" && (
          <div className="shrink-0 bg-destructive/15 border-b border-destructive/30 px-4 py-2 text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span className="font-medium">后端服务离线</span>
            <span className="text-destructive/80">
              ·任务提交、批准、取消等操作已暂停。请运行
              <code className="mx-1 text-xs bg-destructive/10 px-1 rounded">scripts/run_engine_server.py</code>
              启动 FastAPI 服务。
            </span>
          </div>
        )}
        <div className="relative flex flex-1 overflow-hidden">
        {/* 侧栏收起时：左上角浮出一个安静的展开按钮（避开交通灯，故 top 留白） */}
        {!sidebarOpen && (
          <div className={cn("absolute left-2 z-20", isTauri ? "top-9" : "top-2")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="size-8 bg-card/80 border shadow-sm">
                  <PanelLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">展开侧栏 (Cmd/Ctrl + \\)</TooltipContent>
            </Tooltip>
          </div>
        )}
        {/* ─────── Sidebar ─────── */}
        <aside className={cn("app-sidebar w-80 flex flex-col border-r bg-sidebar min-h-0 overflow-hidden", !sidebarOpen && "hidden")}>
          {/* Brand + status */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "size-2.5 rounded-full",
                healthStatus === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-destructive",
              )} />
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Video2Blog
              </h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="size-8">
                  <PanelLeftClose />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">收起侧栏 (Cmd/Ctrl + \\)</TooltipContent>
            </Tooltip>
          </div>

          {/* New job button */}
          <div className="p-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="w-full rounded-full"
                  onClick={startCreate}
                  disabled={healthStatus === "offline"}
                >
                  <Plus data-icon="inline-start" />
                  新建改写任务
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {healthStatus === "offline" ? "后端离线时无法提交新任务" : "新建改写任务 (Cmd/Ctrl + N)"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 搜索 + 状态 chip —— 历史归档多了用来快速定位 */}
          <div className="px-3 pb-2 flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/70 pointer-events-none" />
              <input
                type="text"
                value={jobQuery}
                onChange={e => setJobQuery(e.target.value)}
                placeholder="搜索 stem / 演讲人 / 路由…"
                title="聚焦搜索 (Cmd/Ctrl + K)"
                className="w-full bg-card border rounded-md py-1.5 pl-8 pr-7 text-xs outline-none focus:border-primary transition-colors"
              />
              {jobQuery && (
                <button
                  type="button"
                  onClick={() => setJobQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-4 rounded-sm hover:bg-muted flex items-center justify-center"
                  aria-label="清空搜索"
                >
                  <X className="size-3 text-muted-foreground" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {([
                ["all", "全部"],
                ["active", "进行中"],
                ["waiting", "待审批"],
                ["done", "已完成"],
                ["failed", "失败"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setJobFilter(key)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                    jobFilter === key
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Job list — live + historical 两段,历史按 path 去重避免和 live succeeded 重复 */}
          <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
            <JobList
              liveJobs={jobs}
              historicalJobs={historicalJobs}
              selectedId={selectedJobId}
              query={jobQuery}
              filter={jobFilter}
              onSelect={(id) => { setSelectedJobId(id); setIsCreating(false); setShowSettings(false) }}
            />
          </ScrollArea>

          {/* 用户/连接 页脚（Claude 侧栏底部气质，本地工具不伪造身份） */}
          <button
            type="button"
            onClick={openSettings}
            className="shrink-0 border-t px-2.5 py-2.5 flex items-center gap-2.5 text-left hover:bg-muted/40 transition-colors"
          >
            <div className="size-7 shrink-0 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center">
              V2B
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">本地工作台</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className={cn("size-1.5 rounded-full", healthStatus === "online" ? "bg-emerald-500" : "bg-destructive")} />
                {healthStatus === "online" ? "已连接 · 127.0.0.1:8765" : "后端离线"}
              </div>
            </div>
            <Settings className="size-4 text-muted-foreground shrink-0" />
          </button>
        </aside>

        {/* ─────── Main area ─────── */}
        <main className="app-main flex-1 flex flex-col overflow-hidden">
          {isCreating ? (
            <CreateForm
              source={source} setSource={setSource}
              speaker={speaker} setSpeaker={handleSpeakerInput}
              onDetectSpeaker={detectSpeakerAI} speakerHint={speakerHint} detectingSpeaker={detectingSpeaker}
              routing={routing} setRouting={setRouting}
              mode={mode} setMode={setMode}
              maxRetries={maxRetries} setMaxRetries={setMaxRetries}
              model={model} setModel={setModel}
              force={force} setForce={setForce}
              pauseOnOutline={pauseOnOutline} setPauseOnOutline={setPauseOnOutline}
              rewriteStrategy={rewriteStrategy} setRewriteStrategy={setRewriteStrategy}
              profileId={profileId} setProfileId={setProfileId}
              profileOptions={profileOptions}
              defaultProfileId={defaultProfileId}
              onOpenSettings={openSettings}
              isSubmitting={isSubmittingJob}
              healthOffline={healthStatus === "offline"}
              draftRestoredTs={draftRestoredTs}
              onDiscardDraft={handleDiscardDraft}
              onSubmit={handleCreateJob}
              onCancel={() => setIsCreating(false)}
            />
          ) : showSettings ? (
            <SettingsPanel onProfilesChanged={fetchProfiles} />
          ) : selectedJob ? (
            <JobWorkspace
              job={selectedJob}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              logs={logs}
              currentStep={currentStep}
              pausedAt={pausedAt}
              outlineText={outlineText}
              setOutlineText={setOutlineText}
              outlineViewMode={outlineViewMode}
              setOutlineViewMode={setOutlineViewMode}
              draftContent={draftContent}
              reviewJson={reviewJson}
              isSubmittingOutline={isSubmittingOutline}
              isSubmittingDraft={isSubmittingDraft}
              onApproveOutline={handleApproveOutline}
              onApproveDraft={handleApproveDraft}
              onRefresh={() => { startSse(selectedJob.id); fetchJobs() }}
              onCopy={copyText}
              onCancel={handleCancelJob}
              onOpenInOS={openInOS}
              onRetry={handleRetryFromJob}
              healthOffline={healthStatus === "offline"}
              sseStatus={sseStatus}
              lastEventAt={lastEventAt}
              outlineDraftRestoredTs={outlineDraftRestoredTs}
              onReloadOutlineOriginal={() => selectedJob && loadOutline(selectedJob.id, true)}
              setDraftContent={setDraftContent}
              draftViewMode={draftViewMode}
              setDraftViewMode={setDraftViewMode}
              draftEditRestoredTs={draftEditRestoredTs}
              onReloadDraftOriginal={() => selectedJob && loadDraftAndReview(selectedJob.id, true)}
              onOpenSettings={openSettings}
            />
          ) : (
            <HomeView
              historicalJobs={historicalJobs}
              onCreate={startCreate}
              healthOffline={healthStatus === "offline"}
              defaultProfileName={profileOptions.find(p => p.id === defaultProfileId)?.name ?? null}
            />
          )}
        </main>
        </div>
      </div>
    </TooltipProvider>
  )
}



// ═══════════════════ Pause icon for toast ═══════════════════
function Pause() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

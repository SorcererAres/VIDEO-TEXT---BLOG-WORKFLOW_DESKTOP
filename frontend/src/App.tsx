import { useState, useEffect, useMemo, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  AlertCircle,
  X,
  Trash,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import {
  IconToggle,
  IconSearch,
  IconNew,
  IconStart,
  IconLibrary,
  IconVoice,
  IconFilter,
  IconSettings,
} from '@/components/icons'
import { Toaster, toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { SearchModal } from '@/components/SearchModal'
import { ConfirmDialogHost, confirmAction } from '@/components/ConfirmDialog'
import { deleteLiveJob, restoreLiveJob } from '@/lib/job-actions'
import { moveTrashPost, restoreTrashPost, purgeTrashPost, type TrashPost } from '@/lib/trash-actions'
import { Launcher, type LauncherHandle } from '@/components/Launcher'
import type { LauncherSubmitPayload } from '@/lib/launcher-command'
import { TrafficLights } from '@/components/TrafficLights'
import { JobList, HomeView, JobWorkspace, isNeedsMe } from '@/components/jobs'
import { LibraryView, VoiceView } from '@/components/places'
import { SettingsPanel } from '@/components/settings'
import {
  inferCurrentStep,
  mapProgress,
  systemEvent,
  successEvent,
  errorEvent,
  pausedEvent,
  type ParsedEvent,
  type ProgressData,
} from '@/lib/log-parser'
import { API_BASE } from '@/lib/api'
import {
  listProfiles,
  type LlmProfile,
} from '@/lib/settings-store'
import {
  type EngineJob,
  type EngineJobRequest,
  type ReviewJson,
} from '@/lib/job-types'
import { pushSessionJobId } from '@/lib/session-jobs'
// DECOUPLE Round 2：任务 / 作品 / 回收站三套数据源各自成 hook。
import { useTasks } from '@/lib/use-tasks'
import { usePosts } from '@/lib/use-posts'
import { useTrash } from '@/lib/use-trash'
import { readOutlineDraft, writeOutlineDraft, clearOutlineDraft, readDraftEdit, writeDraftEdit, clearDraftEdit } from '@/lib/draft-storage'
import { FilterRadioGroup } from '@/components/FilterRadioGroup'
import { useSidebarLayout } from '@/lib/use-sidebar-layout'
import { useJobListFilters } from '@/lib/use-job-list-filters'
import { useJobStatusNotifications } from '@/lib/use-job-status-notifications'
import { isTauri } from '@/lib/is-tauri'

// 任务数据类型 + 跨视图的小工具搬到 lib/job-types.ts，下方按需 import。

// 启动时一次性清掉 PR #1 前的 CreateForm 草稿残留（v2b_create_draft）。
// 现在新建走 Launcher，草稿恢复 banner 体系整套废了。
try { localStorage.removeItem("v2b_create_draft") } catch { /* ignore */ }

// 编辑器草稿的本地备份(outline.md / draft.md，按 jobId 分桶)搬到 lib/draft-storage.ts。

// 本会话 job ID 跟踪（pushSessionJobId）搬到 lib/session-jobs.ts。
// 2026-06 重设计后 JobList 已不读取 sessionIds（scope=session 维度砍掉），但 App.tsx
// 提交时仍 push —— 给 ⌘K 搜索的"最近提交"加权预留，且写入成本可忽略。

// isTauri 下沉到 lib/is-tauri.ts（App 与 hook 共用单一来源）。

// 任务 ⚙ popover 里的单段 radio group（FilterRadioGroup）搬到 components/FilterRadioGroup.tsx。

export default function App() {
  // DECOUPLE Round 2：三套数据源（任务 / 作品 / 回收站）各自成 hook，App 不再
  // 内联 state + fetch。别名保留原变量名（jobs / historicalJobs / trashPosts…），
  // 让下方所有调用处零改动；fetchJobs 内部的状态跃迁通知见 onDataRef 注入。
  // 三套 store 均不在 App 内直接写 setter：任务靠 fetchJobs 轮询，作品 / 回收站操作后
  // 各自 fetchHistory / fetchTrash 重拉（DECOUPLE Round 3 起删除语义统一，App 不再跨域
  // 手工补偿 historicalJobs —— 作品域以 fetchHistory 为单一刷新来源）。
  const { tasks: jobs, fetchTasks: fetchJobs, onDataRef: tasksOnDataRef } = useTasks()
  const { posts: historicalJobs, fetchPosts: fetchHistory } = usePosts()
  const { trashPosts, fetchTrash } = useTrash()
  // LibraryView 内部视图：作品集 / 回收站。受控于 App，让 sidebar 底部的「回收站」入口能直接切到 trash。
  const [libraryView, setLibraryView] = useState<"library" | "trash">("library")
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<EngineJob | null>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)
  // inline Launcher（HomeView 内）—— 拖拽接管 / composer 展开用
  const launcherRef = useRef<LauncherHandle>(null)
  // overlay Launcher（⌘N / 侧栏 IconNew / 重跑预填）—— 全局浮层用
  const overlayLauncherRef = useRef<LauncherHandle>(null)
  const [showSettings, setShowSettings] = useState(false)
  // Cmd+K 任务搜索模态（顶部 icon 按钮 / 快捷键触发）
  const [showSearch, setShowSearch] = useState(false)
  // 「风格」全屏二级页（Figma 样式）：覆盖主界面，返回箭头退出。不走 place 系统。
  const [showVoice, setShowVoice] = useState(false)
  // 顶层"场所"（IA ④）：无 job/新建/设置时，主区按 place 展示。workshop=选中 job，settings=showSettings。
  const [place, setPlace] = useState<"start" | "library" | "voice">("start")
  // logs = 原始 print 文本流（「原始日志」视图排查用）；
  // progressEvents = 结构化叙事（来自后端 progress + job 生命周期事件）。H1 去耦后两者分离。
  const [logs, setLogs] = useState<string[]>([])
  const [progressEvents, setProgressEvents] = useState<ParsedEvent[]>([])
  const [activeTab, setActiveTab] = useState<"console" | "outline" | "review" | "final" | "artifacts">("console")
  const [healthStatus, setHealthStatus] = useState<"online" | "offline">("offline")
  // 本机能否跑视频转录（/health capabilities.transcription）。打包版未内置转录引擎时 false。
  const [transcriptionAvailable, setTranscriptionAvailable] = useState(true)
  // 可收起的安静侧栏（展开态 + 宽度拖拽 + 收起态 hover-preview）抽到 lib/use-sidebar-layout.ts。
  const {
    sidebarOpen, setSidebarOpen, sidebarWidth, sidebarRef, sidebarHovered,
    startSidebarDrag, resetSidebarWidth, openHover, scheduleHoverClose,
    pinSidebar, collapseSidebar,
  } = useSidebarLayout()

  // Settings 表单已自包含（自行从后端 GET /api/llm-config 加载 + 保存），父级不再持有 LLM 配置 state。

  // Outline Editing state —— 默认预览(渲染后博文),需要改结构再切源码
  const [outlineText, setOutlineText] = useState("")
  const [isSubmittingOutline, setIsSubmittingOutline] = useState(false)
  const [outlineViewMode, setOutlineViewMode] = useState<"edit" | "preview">("preview")
  // 如果加载时发现本地有未提交的草稿(跟后端原始不一致),记下时间戳用于显示恢复 banner
  const [outlineDraftRestoredTs, setOutlineDraftRestoredTs] = useState<number | null>(null)

  // Review & Draft state —— draftContent 可编辑;分屏 / 草稿恢复都跟 OutlineView 一致
  const [draftContent, setDraftContent] = useState("")
  const [reviewJson, setReviewJson] = useState<ReviewJson | null>(null)
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false)
  const [draftViewMode, setDraftViewMode] = useState<"edit" | "preview">("preview")
  const [draftEditRestoredTs, setDraftEditRestoredTs] = useState<number | null>(null)

  // 旧 CreateForm state（source/speaker/routing/mode/...）PR #3 已全部下放到 Launcher 内部。
  // App.tsx 只保留 profile 列表，因为 Launcher 通过 props 接收，且 Settings/重跑等也需要 fetch。
  const [profileOptions, setProfileOptions] = useState<LlmProfile[]>([])
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null)

  // 侧栏任务列表过滤（2026-06 重设计）—— scope/filter/search 四个入口压成「⚙ 单 popover」。
  //   filter:    all / needs_me / active / done       ——「状态」段
  //   timeRange: any / 7d / 30d                       ——「时间」段
  //   sortMode:  smart / updated / created             ——「排序」段
  // 任务列表过滤/时间/排序/段折叠状态（含 localStorage 持久化）抽到 lib/use-job-list-filters.ts。
  const {
    jobQuery, jobFilter, setJobFilter, jobTimeRange, setJobTimeRange,
    jobSort, setJobSort, jobsCollapsed, setJobsCollapsed, jobsFilterActive,
  } = useJobListFilters()
  // 等我项数量（paused 等审批 + failed 等修复）—— 收起态时挂红点用。
  // 仅看 live jobs：historical 一定是 succeeded 终态归档，不会出现在等我桶。
  const needsMeCount = useMemo(() => jobs.filter(isNeedsMe).length, [jobs])

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
    fetchTrash()
    fetchProfiles()

    let healthId: number | null = null
    let jobsId: number | null = null
    let historyId: number | null = null
    let trashId: number | null = null

    const startPolling = () => {
      if (healthId === null) healthId = window.setInterval(checkHealth, 8000)
      if (jobsId === null) jobsId = window.setInterval(fetchJobs, 5000)
      // 历史归档磁盘扫描,频率低一些(磁盘不会频繁变)
      if (historyId === null) historyId = window.setInterval(fetchHistory, 30000)
      // 回收站轮询频率跟归档同档（用户不会高频删/还原）
      if (trashId === null) trashId = window.setInterval(fetchTrash, 30000)
    }
    const stopPolling = () => {
      if (healthId !== null) { window.clearInterval(healthId); healthId = null }
      if (jobsId !== null) { window.clearInterval(jobsId); jobsId = null }
      if (historyId !== null) { window.clearInterval(historyId); historyId = null }
      if (trashId !== null) { window.clearInterval(trashId); trashId = null }
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        // 回到前台立刻刷一次,把"离线期间"的状态拉新
        checkHealth()
        fetchJobs()
        fetchHistory()
        fetchTrash()
        startPolling()
      }
    }

    if (!document.hidden) startPolling()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
    // 只在 mount 时启动轮询；fetchJobs/fetchHistory 等用最新闭包即可，无需进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setLauncherOpen(true)
          setShowSettings(false)
        }
        return
      }

      if (isMod && e.key === "," && !isTauri) {
        e.preventDefault()
        setShowSettings(true)
        setLauncherOpen(false)
        setSelectedJobId(null)
        return
      }

      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setShowSearch(true)
        return
      }

      if (isMod && e.key === "\\") {
        e.preventDefault()
        setSidebarOpen(v => !v)
        return
      }

      if (e.key === "Escape" && !inInput) {
        if (showSearch) {
          setShowSearch(false)
          return
        }
        if (launcherOpen) {
          setLauncherOpen(false)
          return
        }
        if (showSettings) {
          setShowSettings(false)
          return
        }
        if (showVoice) {
          setShowVoice(false)
          return
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
    // setSidebarOpen 来自 useSidebarLayout，引用稳定（useState setter），列入依赖仅为满足 eslint，不改变重订阅时机。
  }, [healthStatus, launcherOpen, showSettings, showVoice, showSearch, setSidebarOpen])

  // Tauri 壳：监听原生菜单事件（新建任务）+ 设置窗改了配置档后回灌
  useEffect(() => {
    if (!isTauri) return
    const uns: Array<Promise<() => void>> = []
    uns.push(listen("menu:new", () => {
      if (healthStatus !== "offline") {
        setLauncherOpen(true); setShowSettings(false)
      }
    }))
    // Cmd+, / 菜单「设置…」→ 弹出设置 modal（不再开独立窗口）
    uns.push(listen("menu:settings", () => { setShowSettings(true) }))
    uns.push(listen("profiles:changed", () => { fetchProfiles() }))
    return () => { uns.forEach(p => p.then(f => f()).catch(() => {})) }
  }, [healthStatus])

  // 演讲人识别（启发式 + AI）已搬到 Launcher 内部 —— 它持有 source/speaker state，链路更短。

  // 开始新建任务 —— 唯一入口：overlay Launcher。离线时拦截。
  const startCreate = () => {
    if (healthStatus === "offline") { toast.error("后端服务离线", { description: "请先启动后端，再新建任务" }); return }
    setLauncherOpen(true); setShowSettings(false)
  }

  // 打开设置：in-app modal（Claude Desktop 风格）—— 居中弹层浮在当前界面上，不切走主区、不开独立窗口。
  const openSettings = () => { setShowSettings(true) }

  // Select job update & SSE trigger
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null)
      setLogs([])
      setProgressEvents([])
      sseTargetJobRef.current = null
      tearDownSse()
      setSseStatus("idle")
      return
    }

    // 同时在 live 和 historical 里找;live 优先
    const job = jobs.find(j => j.id === selectedJobId) ?? historicalJobs.find(j => j.id === selectedJobId)
    if (job) {
      const prevStatus = selectedJob?.status
      const isFreshSelect = job.id !== selectedJob?.id
      setSelectedJob(job)

      // 历史归档:不打 SSE,不拉 work/* 产物,直接挂"成品及报告"tab
      if (job.kind === "historical") {
        sseTargetJobRef.current = null
        tearDownSse()
        setSseStatus("idle")
        setLogs([])
        setProgressEvents([])
        if (isFreshSelect) setActiveTab("final")  // 只在初次选中时切，否则用户切 tab 又被拽回
        return
      }

      if (job.status === "paused") {
        const justEnteredPaused = prevStatus !== "paused"
        // 只在初次选中或刚进入 paused 时拉数据 + 切 tab —— 否则 jobs 轮询每 5s 都会把用户拽回审批 tab。
        // 关键：用后端的 paused_state 决定加载 outline 还是 draft，**不再盲调两个**（5/28 撞 3 次同 bug）。
        if (isFreshSelect || justEnteredPaused) {
          fetch(API_BASE + `/jobs/${job.id}`)
            .then(res => res.json())
            .then(data => {
              if (data.status !== "paused") return
              if (data.paused_state === "WAITING_USER_OUTLINE") {
                loadOutline(job.id)
                setActiveTab("outline")
              } else if (data.paused_state === "WAITING_USER_REVIEW") {
                loadDraftAndReview(job.id)
                setActiveTab("review")
              } else {
                // 老后端兼容：缺 paused_state 字段时按"outline 永远先于 draft"试
                loadOutline(job.id)
                loadDraftAndReview(job.id)
                setActiveTab("outline")
              }
            })
        }
      } else if (job.status === "succeeded") {
        // 成品前置：跑完那一刻（running→succeeded）或新选中一个已完成任务时，默认落到成品阅读视图。
        // 但不在后续每次 jobs 刷新时强切 —— 否则用户手点"运行日志"看一眼又被拽回成品。
        const justFinished = job.id === selectedJob?.id && prevStatus !== "succeeded"
        if (isFreshSelect || justFinished || activeTab === "outline" || activeTab === "review") {
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
      if (res.ok) {
        try {
          const data = await res.json()
          // 缺字段时默认 true（兼容老后端 / dev）
          setTranscriptionAvailable(data?.capabilities?.transcription !== false)
        } catch { /* 非 JSON 不影响在线判定 */ }
      }
    } catch {
      setHealthStatus("offline")
    }
  }

  // 任务列表的状态跃迁提醒（toast/系统通知）抽到 lib/use-job-status-notifications.tsx。
  // DECOUPLE Round 2：把返回的 detectStatusTransitions 注入任务 store —— 每次 render
  // 刷新为最新闭包，fetchTasks 拉到新数据时即会调用它（据真实状态跃迁发提醒）。
  const { detectStatusTransitions } = useJobStatusNotifications()
  tasksOnDataRef.current = detectStatusTransitions

  // 拉配置档列表 —— Launcher 通过 props 接收；SettingsForm 改动后也会回调刷新。
  // "当前选档已禁用 → 回退" 现在由 Launcher 内部处理（它持有自己的 profileId）。
  const fetchProfiles = async () => {
    try {
      const snap = await listProfiles()
      setProfileOptions(snap.profiles)
      setDefaultProfileId(snap.defaultProfileId)
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
          return
        }
      }
      setOutlineText(fetched)
      setOutlineDraftRestoredTs(null)
      clearOutlineDraft(jobId)
      // tab 切换由 selectedJob useEffect 统一管，loader 不再 setActiveTab —— 避免异步完成后覆盖用户手切的 tab。
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
        // tab 切换由 selectedJob useEffect 统一管，loader 不再 setActiveTab
      }
      const reviewRes = await fetch(API_BASE + `/jobs/${jobId}/files/review_json`)
      if (reviewRes.ok) {
        // 后端 /jobs/{id}/files/{key} 返回 { content: "<file text>", path }，
        // review_json 的 content 是 JSON 字符串 —— 必须 parse 出来才是真正的 ReviewJson。
        // 之前直接 setReviewJson(reviewData)，导致 reviewJson.scores 是 undefined，
        // 触发"本轮无六维评分"假阳性（disk 上 6 维分数齐全也不显示）。
        const reviewWrapper: { content: string; path?: string } = await reviewRes.json()
        try {
          const inner = JSON.parse(reviewWrapper.content) as ReviewJson
          setReviewJson(inner)
        } catch (parseErr) {
          // JSON 损坏 —— 落 parse_failed 标志，让 UI 走"解析失败"分支 + 显示 raw_markdown 兜底
          setReviewJson({
            version: 0,
            verdict: "REVIEW",
            scores: {},
            total: "—",
            rebrief: "",
            raw_markdown: reviewWrapper.content,
            parse_failed: true,
          })
          console.warn("review_json 解析失败", parseErr)
        }
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

  // Launcher 提交路径 —— LauncherSubmitPayload → 后端 EngineJobRequest。
  // PR #3 起：唯一新建入口（CreateForm 路径已废）。
  // Launcher 内部已 pushRecentSource + setLastSpeaker，App.tsx 不重复。
  const handleLauncherSubmit = async (lp: LauncherSubmitPayload): Promise<boolean> => {
    if (!requireOnline("提交任务")) return false
    const mode = lp.mode ?? "full"
    const payload: Record<string, unknown> = {
      source: lp.source,
      speaker: lp.speaker,
      routing: lp.routing,
      mode,
      max_retries: lp.max_retries ?? 1,
      force: lp.force ?? false,
      pause_on_outline: lp.pause_on_outline,
    }
    // §9-C：sectioned 仅 full 有效；quick 强制回 single 避免后端拒收
    payload.rewrite_strategy = mode === "full" ? (lp.rewrite_strategy ?? "single") : "single"
    if (lp.transcribe_engine && lp.transcribe_engine !== "default") payload.transcribe_engine = lp.transcribe_engine
    if (lp.profile_id) payload.profile_id = lp.profile_id

    try {
      const res = await fetch(API_BASE + "/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const data = await res.json()
        pushSessionJobId(data.id)
        fetchJobs()
        setSelectedJobId(data.id)
        setActiveTab("console")
        toast.success("任务已提交", { description: `Job ${data.id.substring(0, 8)}` })
        return true
      } else {
        const err = await res.json()
        toast.error("创建失败", { description: err.detail || "未知错误" })
        return false
      }
    } catch (err) {
      toast.error("网络错误", { description: String(err) })
      return false
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
          setProgressEvents(prev => [...prev, systemEvent("草稿已拒绝，工作流中止")])
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
  // H1 去耦后：叙事直接来自后端结构化 progress 事件（progressEvents），不再正则反解析 logs。
  const currentStep = useMemo(() => inferCurrentStep(progressEvents), [progressEvents])
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

  // 把 EngineJobRequest 翻译成 LauncherSubmitPayload（重跑场景的公共构造）。
  // 注意 profile_id 后端不存（解析为 model+api_base 后丢弃），回填时让 launcher 走默认档；
  // 用户原本档可能已删除/改名，强行猜映射反而误导。
  const jobToLauncherPayload = (req: EngineJobRequest): LauncherSubmitPayload => ({
    source: req.source,
    speaker: req.speaker,
    routing: req.routing,
    pause_on_outline: req.pause_on_outline,
    max_retries: req.max_retries,
    force: req.force,
    rewrite_strategy: (req.rewrite_strategy as "single" | "sectioned" | undefined) ?? "single",
    mode: req.mode === "quick" ? "quick" : undefined,
  })

  // 「改参数重跑」—— 浮出 overlay Launcher 预填字段，用户改完再提交。
  const handleRetryFromJob = (job: EngineJob) => {
    overlayLauncherRef.current?.prefill(jobToLauncherPayload(job.request))
    setLauncherOpen(true)
    setShowSettings(false)
  }

  // 「再跑一遍」—— 不弹 launcher，用 job.request 原参数直接 POST /jobs。
  // 离线由 handleLauncherSubmit 内部 requireOnline 守卫拦截。
  const handleRerunSameJob = (job: EngineJob) => {
    handleLauncherSubmit(jobToLauncherPayload(job.request))
  }

  // ── PR #5: 任务删除 ────────────────────────────────────────────────
  // Live job：直删 + 6s Undo Toast（sonner action 按钮）。被删 job 若是当前 selected，落回 HomeView。
  const handleDeleteLiveJob = async (job: EngineJob) => {
    if (!requireOnline("删除任务")) return
    const stemShort = job.stem.length > 20 ? job.stem.slice(0, 20) + "…" : job.stem
    try {
      await deleteLiveJob(job.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 后端 ID 已不存在（disk-xxx 在 sidecar 重启 / repo_root 切换时会重算）→ stale state，
      // 静默刷新列表即可，不打断用户。
      if (/未知任务 ID/.test(msg)) {
        if (selectedJobId === job.id) setSelectedJobId(null)
        fetchJobs()
        return
      }
      toast.error("删除失败", { description: msg })
      return
    }
    // 若被删的就是当前 selected，落回 HomeView
    if (selectedJobId === job.id) {
      setSelectedJobId(null)
    }
    fetchJobs()
    // 6s Undo Toast —— 点撤销则 POST /jobs/{id}/restore；不点 6s 后后端 finalize（删 work/）
    toast.success("任务已删除", {
      description: stemShort,
      duration: 6000,
      action: {
        label: "撤销",
        onClick: async () => {
          try {
            await restoreLiveJob(job.id)
            fetchJobs()
            toast.success("已撤销删除")
          } catch (e) {
            toast.error("撤销失败", { description: e instanceof Error ? e.message : String(e) })
          }
        },
      },
    })
  }

  // 统一入口：live → 删任务（清 work/，6s undo）；historical（已完成作品）→ 移回收站。
  // DECOUPLE Round 3：historical 行删除不再弹"5 选清扫"面板，与 Library 卡片同一语义
  // （移 30 天回收站，可撤销）。整链彻底清除（连 work/评分/索引/指纹）降级为显式维护
  // 操作（后端 POST /api/maintenance/purge），入口待"设置 → 维护"区接入。
  const handleDeleteJob = (job: EngineJob) => {
    if (job.kind === "historical") {
      void handleDeletePost(job)
    } else {
      void handleDeleteLiveJob(job)
    }
  }

  // ── PR #6: 作品集回收站 ─────────────────────────────────────────────
  // 作品集卡片点 × → 移到 .trash/posts/（30 天可恢复）+ Undo Toast 立即撤销。
  const handleDeletePost = async (job: EngineJob) => {
    if (!requireOnline("删除作品")) return
    const postPath = job.final_post_path
    if (!postPath) {
      toast.error("无法删除", { description: "该作品缺少 final_post_path" })
      return
    }
    let trashId: string
    try {
      const result = await moveTrashPost(postPath)
      trashId = result.trash_id
    } catch (e) {
      toast.error("删除失败", { description: e instanceof Error ? e.message : String(e) })
      return
    }
    if (selectedJobId === job.id) setSelectedJobId(null)
    // 移走后即时重拉作品 / 回收站（DECOUPLE Round 3：去掉手工 setHistoricalJobs 补偿，
    // 作品域由 fetchHistory 单一来源刷新，不再让 App 跨域改 store）。
    fetchTrash()
    fetchHistory()
    const stemShort = job.stem.length > 24 ? job.stem.slice(0, 24) + "…" : job.stem
    toast.success("已移到回收站", {
      description: `${stemShort} · 30 天后自动清空`,
      duration: 8000,
      action: {
        label: "撤销",
        onClick: async () => {
          try {
            await restoreTrashPost(trashId)
            fetchHistory()
            fetchTrash()
            toast.success("已撤销删除")
          } catch (e) {
            toast.error("撤销失败", { description: e instanceof Error ? e.message : String(e) })
          }
        },
      },
    })
  }

  // 回收站还原。目标已存在 → 409，弹 confirm 让用户去原位置改名/删旧件再来。
  const handleRestoreTrash = async (t: TrashPost) => {
    if (!requireOnline("还原")) return
    try {
      await restoreTrashPost(t.trash_id)
      fetchTrash()
      fetchHistory()
      toast.success("已还原", { description: `output/Posts/${t.year}/${t.original_name}` })
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      const msg = e instanceof Error ? e.message : String(e)
      if (status === 409) {
        toast.error("还原冲突", {
          description: `原位置已有同名文件：output/Posts/${t.year}/${t.original_name}。请先处理它再还原。`,
          duration: 8000,
        })
      } else {
        toast.error("还原失败", { description: msg })
      }
    }
  }

  // 永久删（不可恢复，二次确认）
  const handlePurgeTrash = async (t: TrashPost) => {
    if (!requireOnline("永久删除")) return
    const ok = await confirmAction({
      title: `永久删除 "${t.original_name}"？`,
      description: <>该操作<b>不可恢复</b>。删除后回收站、原位置都将彻底没有这篇。</>,
      confirmText: "永久删除",
      cancelText: "取消",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await purgeTrashPost(t.trash_id)
      fetchTrash()
      toast.success("已永久删除", { description: t.original_name })
    } catch (e) {
      toast.error("永久删除失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  // handleDiscardDraft / 草稿恢复 banner 体系整套已废（PR #3）。Launcher 不弹恢复 banner。

  // 切到某个顶层场所：清掉 job/新建/设置，让主区落到该 place。
  const goPlace = (p: "start" | "library" | "voice") => {
    setPlace(p)
    setSelectedJobId(null)
    setShowSettings(false)
  }
  // 当前主区在显示什么 —— 驱动侧栏导航高亮。job/新建/设置 优先于 place。
  // currentView 用于侧栏导航高亮。launcherOpen 浮在主区上方不切走主区，所以不纳入这里 ——
  // 侧栏 IconNew 的 active 单独由 launcherOpen 决定（见下方 nav）。
  const currentView: "settings" | "workshop" | "start" | "library" | "voice" =
    showSettings ? "settings" : selectedJob ? "workshop" : place

  return (
    <TooltipProvider delayDuration={200}>
      <Toaster position="top-right" theme="system" />
      <ConfirmDialogHost />
      {/* 中性 Tahoe：实底窗口底色（中性浅灰）衬托浮起的 sidebar 卡片。玻璃透出已撤销。 */}
      <div className="app-root flex flex-col h-screen text-foreground overflow-hidden font-sans bg-background">
        {/* 不再有横跨顶部的 toolbar：sidebar 卡片自己顶到窗口上沿（含交通灯），
            主区单独留拖拽条。offline banner 移进主区顶部。 */}
        <div className="relative flex flex-1 overflow-hidden">
        {/* 自绘交通灯（仅 Tauri 壳）：固定在窗口左上，不随 sidebar 收起而消失；聚焦红黄绿 / 失焦灰。 */}
        {isTauri && <TrafficLights />}
        {/* 单一 sidebar toggle：位置固定（交通灯右边 + gap），icon 跟状态切换。
            收起态 = Menu hamburger；展开态 = PanelLeftClose；收起态 hover 触发 hover-preview。
            按钮 24x24：top-[14px] 让中心 = 14+12 = 26px，与自绘交通灯中心
            （容器 top18 + p-px 1 + 半径7 = 26）对齐。 */}
        <div
          className={cn("absolute z-40 flex items-center gap-0.5", isTauri ? "top-[14px] left-[92px]" : "top-2 left-2")}
          onMouseEnter={!sidebarOpen ? openHover : undefined}
          onMouseLeave={!sidebarOpen ? scheduleHoverClose : undefined}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={sidebarOpen ? collapseSidebar : pinSidebar}
                aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
                className="size-6 hover:bg-foreground/[0.06]"
                data-tauri-drag-region={false}
              >
                <IconToggle />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarOpen ? "收起侧栏 (Cmd/Ctrl + \\)" : "展开侧栏 (Cmd/Ctrl + \\)"}
            </TooltipContent>
          </Tooltip>
          {/* 搜索按钮（顶部一级入口，取代原内嵌搜索框）：点开弹出全屏模态。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSearch(true)}
                aria-label="搜索任务"
                className="size-6 hover:bg-foreground/[0.06]"
                data-tauri-drag-region={false}
              >
                <IconSearch />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">搜索任务 (Cmd/Ctrl + K)</TooltipContent>
          </Tooltip>
        </div>
        {/* ─────── Sidebar ─────── */}
        {/* 浮起的圆角导航面板：亮底 + 细边框 + 轻阴影，顶到窗口上沿把交通灯包进卡片内。
            圆角 12px 对齐 DESIGN.md rounded.lg —— 卡片几何在借鉴系里统一这一档。
            宽度由 sidebarWidth state 控制（拖拽 + localStorage 持久化）。
            三态：
              · sidebarOpen=true → in-flow，挤主区（pinned）
              · !sidebarOpen && sidebarHovered → absolute overlay 浮在主区上方（hover-preview）
              · !sidebarOpen && !sidebarHovered → absolute + translateX(-100%) 移出视口（hidden） */}
        <aside
          ref={sidebarRef}
          onMouseEnter={!sidebarOpen ? openHover : undefined}
          onMouseLeave={!sidebarOpen ? scheduleHoverClose : undefined}
          style={{
            width: sidebarWidth,
            transform: (sidebarOpen || sidebarHovered) ? "translateX(0)" : "translateX(calc(-100% - 16px))",
          }}
          className={cn(
            // sidebar 实底中性浅灰（放弃玻璃透出，可用性优先）：浮起圆角卡片 + 细 hairline + 轻阴影。
            "app-sidebar flex flex-col rounded-xl border border-border/60 bg-card shadow-sm min-h-0 overflow-hidden transition-transform duration-200 ease-out",
            sidebarOpen
              ? "relative shrink-0 ml-2 mt-2 mb-2"               // pinned：占布局
              : "absolute top-2 bottom-2 left-2 z-30",          // overlay：浮在主区上方
          )}
        >
          {/* 顶行 40px：仅作为交通灯承载 + drag region。toggle 按钮上移到窗口左上
              （交通灯旁），单一按钮表达"展开/收起"两种状态——见上方 sidebarOpen 分支的 toggle。 */}
          <div className="h-10 shrink-0" data-tauri-drag-region={isTauri || undefined} />

          {/* 顶层导航（设计稿对齐）：32px 行高列表项，外 px-2.5 让激活底色保留 10px 侧边留白；
              内 flex 容器承载圆角 6px 的激活底。颜色用 foreground/* token 走主题反转
              （之前硬码 #f0f1f2 在 dark mode 成白亮块、文字鬼影；token 化后两态都对）。 */}
          <nav className="px-0 pt-1 pb-1 flex flex-col gap-1">
            {([
              ["new", "新任务", IconNew],
              ["start", "开始", IconStart],
              ["library", "作品集", IconLibrary],
              ["voice", "风格", IconVoice],
            ] as const).map(([key, label, Icon]) => {
              // 作品集激活态需排除"已切到回收站"的情况 —— 那时侧栏高亮归 回收站 项
              const active = key === "new" ? launcherOpen
                : key === "voice" ? showVoice
                : key === "library" ? (currentView === "library" && libraryView === "library")
                : currentView === key
              const disabled = key === "new" && healthStatus === "offline"
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (key === "new") return startCreate()
                    if (key === "voice") return setShowVoice(true)
                    // 点「作品集」时把内部视图复位为 library（不然从回收站切走又切回还停在 trash）
                    if (key === "library") setLibraryView("library")
                    goPlace(key)
                  }}
                  title={key === "new" && disabled ? "后端离线时无法新建任务" : undefined}
                  className={cn(
                    "group flex items-center h-8 px-2.5 w-full text-left",
                    disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "flex flex-1 items-center gap-1.5 h-full pl-2 pr-2.5 py-1 rounded-md min-w-0 transition-colors",
                      active
                        ? "bg-foreground/[0.08]"
                        : "group-hover:bg-foreground/[0.04]",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-foreground/85" />
                    <span className="text-[13px] leading-4 font-medium text-foreground/85 truncate flex-1">
                      {label}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Sidebar 任务段头（2026-06 重设计）——
              「任务」纯标题 + 紧邻的 ⌃/⌄ 收起按钮（含等我红点）；
              ⚙ 永远钉在最右，收起态下也可见，供用户预设筛选。
              旧的 scope dropdown + 内嵌搜索全部砍掉。 */}
          <div className="flex items-center pl-[14px] pr-3 pt-[15px] pb-[5px] gap-1">
            <span className="text-[11px] leading-[14px] text-foreground/70 select-none">任务</span>
            <button
              type="button"
              onClick={() => setJobsCollapsed(c => !c)}
              title={jobsCollapsed ? "展开任务列表" : "收起任务列表"}
              aria-expanded={!jobsCollapsed}
              aria-label={jobsCollapsed ? "展开任务列表" : "收起任务列表"}
              className="size-5 rounded-md flex items-center justify-center text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground transition-colors"
            >
              {jobsCollapsed
                ? <ChevronRight className="size-3 opacity-70" />
                : <ChevronDown className="size-3 opacity-70" />}
            </button>
            {/* 收起态 + 等我项 > 0 时挂红点 —— 列表不可见时唯一的催办锚点。
                展开态不挂：列表自身的智能置顶 + 黄/红状态点已经够强。 */}
            {jobsCollapsed && needsMeCount > 0 && (
              <span
                className="size-1.5 rounded-full bg-destructive shrink-0"
                title={`${needsMeCount} 个任务等你处理`}
              />
            )}
            <div className="flex-1" />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="筛选与排序"
                  title="筛选与排序"
                  className={cn(
                    // 默认透明；任一段非默认 → 灰底 + ring 提示"列表被筛过"。
                    "size-6 rounded-md flex items-center justify-center transition-colors text-foreground/70",
                    jobsFilterActive
                      ? "bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.1] ring-1 ring-foreground/15"
                      : "hover:bg-foreground/[0.06]",
                  )}
                >
                  <IconFilter className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-44 p-1.5 gap-0">
                <FilterRadioGroup
                  label="状态"
                  value={jobFilter}
                  onChange={setJobFilter}
                  options={[
                    ["all", "全部"],
                    ["needs_me", "仅等我"],
                    ["active", "仅进行中"],
                    ["done", "仅已完成"],
                  ]}
                />
                <div className="my-1.5 border-t border-foreground/10" />
                <FilterRadioGroup
                  label="时间"
                  value={jobTimeRange}
                  onChange={setJobTimeRange}
                  options={[
                    ["any", "不限"],
                    ["7d", "近 7 天"],
                    ["30d", "近 30 天"],
                  ]}
                />
                <div className="my-1.5 border-t border-foreground/10" />
                <FilterRadioGroup
                  label="排序"
                  value={jobSort}
                  onChange={setJobSort}
                  options={[
                    ["smart", "智能（推荐）"],
                    ["updated", "最近更新"],
                    ["created", "创建时间"],
                  ]}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Job list — 展开态渲染；收起态用同位置的 flex-1 占位 div 吃掉剩余高度，
              保证回收站 / 设置始终钉在 sidebar 底部，不随任务展开收起上下漂移。
              `[&_[data-slot=scroll-area-viewport]>div]:!block` —— 覆盖 Radix viewport 内 inline
              `display: table` 的横向膨胀 hack：侧栏只要竖滚，table 模式让长 stem 反向撑爆 sidebar 可视宽。 */}
          {jobsCollapsed ? (
            <div className="flex-1 min-h-0" aria-hidden />
          ) : (
            <ScrollArea className="flex-1 min-h-0 px-2 pb-2 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
              <JobList
                liveJobs={jobs}
                historicalJobs={historicalJobs}
                selectedId={selectedJobId}
                query={jobQuery}
                filter={jobFilter}
                timeRange={jobTimeRange}
                sortMode={jobSort}
                onSelect={(id) => { setSelectedJobId(id); setShowSettings(false) }}
                onDelete={handleDeleteJob}
              />
            </ScrollArea>
          )}

          {/* 回收站全局入口 —— 跟「设置」同款 h-9 / 11px 字号视觉。上方 mt-2 与近期任务列表分组。
              永远显示（空时不带 badge）；点击 → goPlace("library") + libraryView="trash"。 */}
          {(() => {
            const trashActive = currentView === "library" && libraryView === "trash"
            return (
              <button
                type="button"
                onClick={() => { setLibraryView("trash"); goPlace("library") }}
                title={`回收站 · ${trashPosts.length} 篇待清理（30 天后自动清空）`}
                className="group shrink-0 mt-2 mb-1 flex items-center h-9 px-2.5 w-full text-left"
              >
                <span className={cn(
                  "flex flex-1 items-center gap-1.5 h-full pl-2 pr-2.5 py-1 rounded-md min-w-0 transition-colors",
                  trashActive ? "bg-foreground/[0.08]" : "group-hover:bg-foreground/[0.04]",
                )}>
                  <Trash className="size-4 shrink-0 text-foreground/85" />
                  <span className="text-[11px] leading-4 text-foreground/85 truncate flex-1">回收站</span>
                  {trashPosts.length > 0 && (
                    <span className="shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-foreground/[0.08] text-foreground/70 font-medium">
                      {trashPosts.length}
                    </span>
                  )}
                </span>
              </button>
            )
          })()}

          {/* 页脚：极简「设置」行 —— 设计稿 24px 行高 / 11px label / 右侧连接指示灯 */}
          <button
            type="button"
            onClick={openSettings}
            title={healthStatus === "online" ? `已连接 · ${API_BASE.replace(/^https?:\/\//, "")}` : "后端离线"}
            className="group shrink-0 mb-2 flex items-center h-9 px-2.5 w-full text-left"
          >
            <span className="flex flex-1 items-center gap-1.5 h-full pl-2 pr-2.5 py-1 rounded-md min-w-0 transition-colors group-hover:bg-foreground/[0.04]">
              <IconSettings className="size-4 shrink-0 text-foreground/85" />
              <span className="text-[11px] leading-4 text-foreground/85 truncate flex-1">设置</span>
              <span
                aria-label={healthStatus === "online" ? "在线" : "离线"}
                className={cn("size-1.5 rounded-full shrink-0", healthStatus === "online" ? "bg-success" : "bg-destructive")}
              />
            </span>
          </button>

          {/* 拖拽手柄：右边缘 6px 命中区，idle 透明，hover 显细线，active 显主色；
              双击复位到默认 256；拖到 <180 自动 snap-collapse（见 startSidebarDrag）。
              仅在 pinned 状态下显示——hover-preview 是临时预览，调宽要求先 pin。 */}
          {sidebarOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧栏宽度"
              title="拖动调整宽度 · 双击复位"
              onMouseDown={startSidebarDrag}
              onDoubleClick={resetSidebarWidth}
              className="group absolute top-1 bottom-1 -right-0.5 w-1.5 cursor-col-resize z-30"
            >
              <div className="absolute right-0 top-0 bottom-0 w-px bg-transparent group-hover:bg-foreground/20 group-active:bg-primary/50 transition-colors" />
            </div>
          )}
        </aside>

        {/* ─────── Main area ─────── */}
        {/* Tahoe master-detail：主内容区是**实底**（中性浅灰），保证长文/表单可读；
            玻璃只给 sidebar/控件（content over chrome ≠ 内容飘在桌面上）。
            浏览器与 Tauri 都用 bg-background 实底。 */}
        <main className="app-main flex-1 flex flex-col overflow-hidden bg-background">
          {/* 主区顶部拖拽条：sidebar 卡片自带顶行后，这里补一条让主区也能拖动窗口 */}
          {isTauri && <div className="h-7 shrink-0" data-tauri-drag-region />}
          {healthStatus === "offline" && (
            <div className="shrink-0 bg-destructive/15 border-y border-destructive/30 px-4 py-2 text-sm flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span className="font-medium">后端服务离线</span>
              <span className="text-destructive/80">
                ·任务提交、批准、取消等操作已暂停。请运行
                <code className="mx-1 text-xs bg-destructive/10 px-1 rounded">scripts/run_engine_server.py</code>
                启动 FastAPI 服务。
              </span>
            </div>
          )}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {selectedJob ? (
            <JobWorkspace
              job={selectedJob}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              events={progressEvents}
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
              onRerunSame={handleRerunSameJob}
              onDelete={handleDeleteJob}
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
          ) : place === "library" ? (
            <LibraryView
              historicalJobs={historicalJobs}
              trashPosts={trashPosts}
              onOpenJob={(id) => { setSelectedJobId(id); setShowSettings(false) }}
              onDeletePost={handleDeletePost}
              onRestoreTrash={handleRestoreTrash}
              onPurgeTrash={handlePurgeTrash}
              initialView={libraryView}
            />
          ) : (
            <HomeView
              historicalJobs={historicalJobs}
              onCreate={startCreate}
              onOpenLibrary={() => goPlace("library")}
              onOpenSettings={openSettings}
              needsKey={!profileOptions.some(p => p.has_key)}
              healthOffline={healthStatus === "offline"}
              composer={
                <Launcher
                  variant="inline"
                  ref={launcherRef}
                  transcriptionAvailable={transcriptionAvailable}
                  profileOptions={profileOptions}
                  defaultProfileId={defaultProfileId}
                  healthOffline={healthStatus === "offline"}
                  onSubmit={handleLauncherSubmit}
                  onOpenSettings={openSettings}
                />
              }
              onFileDrop={(file) => { launcherRef.current?.uploadFile(file) }}
            />
          )}
          </div>
        </main>
        </div>

        {/* 搜索 modal：Cmd+K / 顶部 Search 按钮触发，命中后选中目标 job。 */}
        <SearchModal
          open={showSearch}
          onClose={() => setShowSearch(false)}
          jobs={jobs}
          historicalJobs={historicalJobs}
          onSelect={(id) => { setSelectedJobId(id); setShowSettings(false) }}
        />

        {/* 新建任务 overlay Launcher —— ⌘N / Tauri 菜单 / 侧栏 IconNew / HomeView composer / 重跑预填 都走这里。 */}
        <Launcher
          variant="overlay"
          ref={overlayLauncherRef}
          open={launcherOpen}
          onClose={() => setLauncherOpen(false)}
          transcriptionAvailable={transcriptionAvailable}
          profileOptions={profileOptions}
          defaultProfileId={defaultProfileId}
          healthOffline={healthStatus === "offline"}
          onSubmit={handleLauncherSubmit}
          onOpenSettings={openSettings}
        />

        {/* 设置 modal（Claude Desktop 风）：半透明遮罩 + 居中卡片，浮在当前界面上。
            点遮罩 / 右上 × / Esc 关闭；不切走主区。 */}
        {showSettings && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 animate-in fade-in duration-150"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="relative bg-card rounded-xl border shadow-2xl w-full max-w-5xl h-[80vh] max-h-[760px] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="关闭设置"
                className="absolute top-3 right-3 z-10 size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
              <SettingsPanel onProfilesChanged={fetchProfiles} />
            </div>
          </div>
        )}

        {/* 「风格」全屏二级页（Figma 样式）：覆盖主界面，自带 header（交通灯位 + 返回 + 标题）。
            z-40 低于自绘交通灯(z-50)，交通灯浮在其 header 左上；返回箭头 / Esc 退出。 */}
        {showVoice && (
          <div className="fixed inset-0 z-40 bg-background animate-in fade-in duration-150">
            <VoiceView onBack={() => setShowVoice(false)} />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}




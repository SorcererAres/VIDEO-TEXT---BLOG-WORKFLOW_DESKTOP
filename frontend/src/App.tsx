import { useState, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Plus,
  AlertCircle,
  Loader2,
  User,
  DollarSign,
  Copy,
  Edit,
  RotateCw,
  Check,
  X,
  Award,
  Settings,
  Layers,
  ListTree,
  XCircle,
  FolderOpen,
  ExternalLink,
  Search,
  PanelLeft,
  PanelLeftClose,
  Sparkle,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { StepProgress } from '@/components/StepProgress'
import { LogConsole } from '@/components/LogConsole'
import { MarkdownView } from '@/components/MarkdownView'
import { pushRecentSource } from '@/components/SourcePicker'
import { ConfirmDialogHost, confirmAction } from '@/components/ConfirmDialog'
import { CreateForm, formatRelativeTime } from '@/components/CreateForm'
import { SettingsPanel } from '@/components/settings'
import { inferCurrentStep, parseLogLine, type ParsedEvent } from '@/lib/log-parser'
import { API_BASE, apiUrl } from '@/lib/api'
import {
  listProfiles,
  type LlmProfile,
  type TestLLMResult,
} from '@/lib/settings-store'

interface EngineJobRequest {
  source: string
  speaker: string
  routing: string
  mode: string
  max_retries: number
  model?: string
  api_base?: string
  force: boolean
  pause_on_outline: boolean
  api_key?: string
  // §9-C: single (默认) | sectioned。后端会在非 full / outline 不可解析时自动回退 single。
  rewrite_strategy?: "single" | "sectioned"
}


interface EngineJob {
  id: string
  status: string
  request: EngineJobRequest
  stem: string
  created_at: string
  updated_at: string
  final_post_path?: string
  review_path?: string
  clean_path?: string
  insights_path?: string
  outline_path?: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
  error?: string
  // status==="paused" 时进一步说明在哪个人工节点：
  //   "WAITING_USER_OUTLINE" → Step 5 大纲审批
  //   "WAITING_USER_REVIEW"  → Step 7 草稿审批
  // 不用磁盘上是否有 draft 内容反推，避免被上一轮残留文件误导（真实撞过的 UI bug）。
  paused_state?: "WAITING_USER_OUTLINE" | "WAITING_USER_REVIEW" | null
  // 历史归档专属字段 —— /jobs/history 返回的对象会有这两个
  kind?: "historical"
  pass_score?: string
  is_draft?: boolean
}

interface QualityScores {
  [key: string]: number
}

interface ReviewJson {
  version: number
  verdict: string
  scores: QualityScores
  total: string
  rebrief: string
  raw_markdown?: string
  parse_failed?: boolean
}

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

// ─── 本会话提交的 job ID 跟踪（localStorage）──
// 5/28 UX 诊断：侧栏"当前会话"实际上是"所有 restore 出来的活跃 job"，
// 把今天主动提交的和半年前残留的混在一起。用 localStorage 显式记录本浏览器
// 用户主动提交过的 job ID，让"本会话" tab 真正只显示用户视角的"本会话"。
const SESSION_JOB_IDS_KEY = "v2b_session_job_ids"

function readSessionJobIds(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_JOB_IDS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : []
  } catch {
    return []
  }
}

function pushSessionJobId(id: string) {
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

// 把 ISO 或 'YYYY-MM-DD HH:MM:SS' 时间字符串转成"刚刚 / X 分钟前 / 今天 14:30 / 5/26"
function formatRelativeOrAbsolute(ts: string | undefined | null): string {
  if (!ts) return ""
  const t = new Date(ts.replace(" ", "T"))
  if (isNaN(t.getTime())) return ts
  const diff = (Date.now() - t.getTime()) / 1000
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) {
    const today = new Date()
    const sameDay = t.getDate() === today.getDate() && t.getMonth() === today.getMonth() && t.getFullYear() === today.getFullYear()
    if (sameDay) return `今天 ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`
    return `${Math.floor(diff / 3600)} 小时前`
  }
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return `${t.getMonth() + 1}/${t.getDate()}`
}

// 是否运行在 Tauri 壳内（决定交通灯留白 / vibrancy 等原生壳专属处理）
const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

// 常用 LLM 模型 chips —— Settings 用,提交前 sanity check 也用
const COMMON_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-latest",
] as const

// 给一个错误字符串归类,推断最可能的根因 + 给用户可读的提示
type DiagnosisKind = "model_not_found" | "auth" | "forbidden" | "timeout" | "missing_key" | "rate_limit" | "unknown"
function classifyDiagnosis(err: string): { kind: DiagnosisKind; hint: string } {
  const lower = err.toLowerCase()
  if ((lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"))) || lower.includes("invalid_model")) {
    return { kind: "model_not_found", hint: "模型名不存在 —— 检查 Settings 中的「默认模型」,改用常见模型 chip 一键填入" }
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("invalid_api_key")) {
    return { kind: "auth", hint: "API Key 错误或已失效 —— 在 Settings 重新填写并保存" }
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
    return { kind: "forbidden", hint: "API Key 没有该模型的访问权限 —— 换个有权限的 model,或确认账户已开通" }
  }
  if (lower.includes("429") || lower.includes("rate") || lower.includes("quota") || lower.includes("limit")) {
    return { kind: "rate_limit", hint: "触发了速率/配额限制 —— 等几分钟再试,或换 API Key" }
  }
  if (lower.includes("缺失 api key") || lower.includes("missing")) {
    return { kind: "missing_key", hint: "完全没配 API Key —— 到 Settings 填一个" }
  }
  if (lower.includes("timeout") || lower.includes("连接超时") || lower.includes("超时") || lower.includes("超过总耗时") || lower.includes("ssl") || lower.includes("eof")) {
    return { kind: "timeout", hint: "API Base 不可达,或模型名错导致服务端 hang(部分 API 不返回 4xx 而是不响应)" }
  }
  return { kind: "unknown", hint: "看下方原文判断" }
}

// "https://api.deepseek.com/v1" → "api.deepseek.com" —— Header chip 用
function shortApiBase(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).host
  } catch {
    return url.length > 30 ? url.slice(0, 30) + "…" : url
  }
}

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

// ═══════════════════ Status Badge ═══════════════════
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "queued":
      return <Badge variant="secondary" className="shrink-0">排队中</Badge>
    case "running":
      return (
        <Badge className="shrink-0 bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/15">
          <Loader2 className="animate-spin" />执行中
        </Badge>
      )
    case "paused":
      return <Badge className="shrink-0 bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">待人工审批</Badge>
    case "succeeded":
      return <Badge className="shrink-0 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">已完成</Badge>
    case "draft":
      return <Badge className="shrink-0 bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">DRAFT</Badge>
    case "failed":
      return <Badge variant="destructive" className="shrink-0">失败</Badge>
    default:
      return <Badge variant="outline" className="shrink-0">{status}</Badge>
  }
}

// ═══════════════════ Failure Diagnosis Hook ═══════════════════
// 任务失败时自动用 task 的配置打一次 /api/test-llm,把"配置错还是网络问题"立刻定位。
// 每个 job.id 只跑一次,不重复浪费请求。
function useFailureDiagnosis(job: EngineJob | null): { diagnosis: TestLLMResult | null; isDiagnosing: boolean } {
  const [diagnosis, setDiagnosis] = useState<TestLLMResult | null>(null)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const runForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!job || job.status !== "failed") {
      setDiagnosis(null)
      setIsDiagnosing(false)
      runForRef.current = null
      return
    }
    if (runForRef.current === job.id) return
    runForRef.current = job.id
    setIsDiagnosing(true)
    setDiagnosis(null)

    // api_key 不再从前端取 —— 后端按优先级链（环境变量 > 钥匙串 / config）自行解析。
    const body = {
      api_base: job.request.api_base,
      model: job.request.model,
    }
    fetch(API_BASE + "/api/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async r => {
        if (r.status === 404) {
          return { ok: false, error: "后端版本过旧,/api/test-llm 端点未注册" } as TestLLMResult
        }
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` } as TestLLMResult
        return r.json() as Promise<TestLLMResult>
      })
      .then(data => setDiagnosis(data))
      .catch(e => setDiagnosis({ ok: false, error: String(e) }))
      .finally(() => setIsDiagnosing(false))
  }, [job?.id, job?.status, job])

  return { diagnosis, isDiagnosing }
}

// ═══════════════════ SSE Status Indicator ═══════════════════
// 顶部"实时连接"小灯,告诉用户日志流是否还在,断了多久了,正在重连第几次。
function SseStatusIndicator({
  status,
  lastEventAt,
}: {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "terminal"
  lastEventAt: number | null
}) {
  // 让 "Xs 前" 每秒刷新一次
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== "connected") return
    const t = window.setInterval(() => setTick(n => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [status])

  if (status === "idle" || status === "terminal") return null

  const elapsedSec = lastEventAt != null ? Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000)) : null
  const elapsedLabel = elapsedSec == null
    ? null
    : elapsedSec < 60
      ? `${elapsedSec}s 前`
      : `${Math.floor(elapsedSec / 60)}分钟前`

  let dotClass = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
  let textClass = "text-emerald-400"
  let label: string

  if (status === "connecting") {
    dotClass = "bg-amber-400 animate-pulse"
    textClass = "text-amber-400"
    label = "连接中…"
  } else if (status === "reconnecting") {
    dotClass = "bg-amber-500 animate-pulse"
    textClass = "text-amber-400"
    label = "已断开 · 重连中…"
  } else {
    // connected
    label = elapsedLabel ? `实时 · ${elapsedLabel}` : "实时"
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 border text-[11px] cursor-default select-none">
          <span className={cn("size-1.5 rounded-full shrink-0", dotClass)} />
          <span className={cn("font-medium tabular-nums", textClass)}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">
          {status === "connected" && "事件流实时连接中"}
          {status === "connecting" && "正在建立事件流"}
          {status === "reconnecting" && "事件流断开,正在按指数退避重连"}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

// ═══════════════════ Failure Banner ═══════════════════
// 任务失败时把 job.error 顶到醒目位置,不让用户在日志里挖。
// 关键体验:**自动归因** —— 用任务的 model/api_base + 本地 api_key 立刻 ping 一次 /api/test-llm,
// 把"是配置错还是网络抽风"这个核心问题在 banner 里直接回答掉。
function FailureBanner({
  error,
  diagnosis,
  isDiagnosing,
  currentModel,
  onCopy,
  onRetry,
  onRetryWithModel,
  onOpenSettings,
}: {
  error: string
  diagnosis: TestLLMResult | null
  isDiagnosing: boolean
  currentModel?: string  // 任务原本用的 model,用于把它从"换模型"chip 里过滤掉
  onCopy: (t: string) => void
  onRetry: () => void
  onRetryWithModel: (model: string) => void
  onOpenSettings: () => void
}) {
  // 把诊断结果归类成一句"用户语言"的提示
  const diagnosisHint = useMemo(() => {
    if (!diagnosis) return null
    if (diagnosis.ok) {
      return {
        tone: "neutral" as const,
        title: "LLM 配置本身可用",
        body: `用相同配置 ping 成功 (${diagnosis.latency_ms ?? "?"}ms,model=${diagnosis.model || "?"})。
超时大概率是本次任务级别的问题:提示词过长 / 模型一时负载高 / 或单次响应耗时超过 90s。建议重试。`,
      }
    }
    const cls = classifyDiagnosis(diagnosis.error || "")
    return {
      tone: "actionable" as const,
      title: `根因高度疑似:${cls.kind === "model_not_found" ? "模型名错误"
        : cls.kind === "auth" ? "API Key 错误"
        : cls.kind === "forbidden" ? "权限不足"
        : cls.kind === "rate_limit" ? "速率/配额限制"
        : cls.kind === "missing_key" ? "未配 API Key"
        : cls.kind === "timeout" ? "API 不可达 / 模型可能不存在"
        : "未知"}`,
      body: cls.hint,
    }
  }, [diagnosis])

  return (
    <Alert variant="destructive" className="mt-3">
      <AlertCircle />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>任务失败</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onCopy(error)} className="h-7">
            <Copy data-icon="inline-start" />
            复制错误
          </Button>
          <Button size="sm" onClick={onRetry} className="h-7">
            <RotateCw data-icon="inline-start" />
            以相同参数重跑
          </Button>
        </div>
      </AlertTitle>
      <AlertDescription>
        <pre className="mt-1 text-xs whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
          {error}
        </pre>

        {/* 自动诊断结果区块 —— 把"为什么超时"这个核心问题尽量回答出来 */}
        <div className="mt-3 p-2.5 rounded border bg-card/60">
          <div className="flex items-center gap-2 text-xs font-semibold mb-1">
            <span>🔍 自动诊断</span>
            {isDiagnosing && <Loader2 className="size-3 animate-spin" />}
          </div>
          {isDiagnosing && (
            <div className="text-xs text-muted-foreground">
              正在用任务的 model / api_base + 本地 API Key 调一次 /api/test-llm…
            </div>
          )}
          {!isDiagnosing && !diagnosis && (
            <div className="text-xs text-muted-foreground">
              暂无诊断结果(可能后端版本过旧、缺少 /api/test-llm 端点)。
            </div>
          )}
          {!isDiagnosing && diagnosis && diagnosisHint && (
            <div className="text-xs flex flex-col gap-1.5">
              <div className={cn(
                "font-semibold",
                diagnosisHint.tone === "actionable" ? "text-amber-300" : "text-emerald-300",
              )}>
                {diagnosisHint.title}
              </div>
              <div className="text-foreground/85 whitespace-pre-wrap leading-relaxed">
                {diagnosisHint.body}
              </div>
            </div>
          )}

          {/* 快速修复按钮组 —— 换模型重跑(主路径) + 打开 Settings(配置类问题) */}
          {!isDiagnosing && diagnosis && (
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-border/40 flex-wrap">
              <span className="text-[11px] text-muted-foreground shrink-0">快速修复:</span>
              {COMMON_MODELS.filter(m => m !== currentModel).slice(0, 3).map(m => (
                <Button
                  key={m}
                  size="sm"
                  variant="outline"
                  onClick={() => onRetryWithModel(m)}
                  className="h-7 text-xs"
                  title={`把 model 换成 ${m} 重新提交,其他参数保持不变`}
                >
                  <RotateCw data-icon="inline-start" />
                  换 <code className="font-mono">{m}</code> 重跑
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={onOpenSettings}
                className="h-7 text-xs"
              >
                <Settings data-icon="inline-start" />
                打开 Settings
              </Button>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

// ═══════════════════ Job List (live + historical) ═══════════════════
type JobFilter = "all" | "active" | "waiting" | "done" | "failed"

interface JobListProps {
  liveJobs: EngineJob[]
  historicalJobs: EngineJob[]
  selectedId: string | null
  query: string
  filter: JobFilter
  onSelect: (id: string) => void
}

// 同一个 job 是否命中过滤条件
function matchesJobFilter(job: EngineJob, filter: JobFilter): boolean {
  if (filter === "all") return true
  switch (filter) {
    case "active":
      return job.status === "running" || job.status === "queued"
    case "waiting":
      return job.status === "paused"
    case "done":
      // succeeded 实时任务 + 历史归档 + draft 落盘 都算"已完成"
      return job.status === "succeeded" || job.status === "draft" || job.kind === "historical"
    case "failed":
      return job.status === "failed"
  }
}

function matchesJobQuery(job: EngineJob, q: string): boolean {
  if (!q) return true
  const lower = q.toLowerCase()
  return (
    job.stem.toLowerCase().includes(lower) ||
    job.request.speaker.toLowerCase().includes(lower) ||
    job.request.routing.toLowerCase().includes(lower)
  )
}

function JobList({ liveJobs, historicalJobs, selectedId, query, filter, onSelect }: JobListProps) {
  // 历史归档去重:同 path 已经在 live 里出现过的(刚跑完还在内存)就不重复显示
  const livePaths = new Set(liveJobs.map(j => j.final_post_path).filter(Boolean) as string[])
  const dedupedHistorical = historicalJobs.filter(h => !h.final_post_path || !livePaths.has(h.final_post_path))

  // 5/28 UX 重构：把"当前会话"拆成两类
  // - 本会话（sessionIds 命中）：用户在这个浏览器主动提交过 → 永远置顶
  // - 后端活跃但非本会话：server _restore_jobs_from_disk 出来的 disk-xxx，
  //   或者其他 session 提交的；放第二段，视觉降权
  const sessionIds = useMemo(() => new Set(readSessionJobIds()), [])
  const sessionJobs = liveJobs.filter(j => sessionIds.has(j.id))
  const restoredJobs = liveJobs.filter(j => !sessionIds.has(j.id))

  // 再叠加 query + filter
  const sessionFiltered = sessionJobs.filter(j => matchesJobFilter(j, filter) && matchesJobQuery(j, query))
  const restoredFiltered = restoredJobs.filter(j => matchesJobFilter(j, filter) && matchesJobQuery(j, query))
  const historicalFiltered = dedupedHistorical.filter(j => matchesJobFilter(j, filter) && matchesJobQuery(j, query))

  // 排序：本会话 / 活跃按更新时间倒序；历史归档 server 已按 mtime 排好
  const sortByUpdated = (a: EngineJob, b: EngineJob) => (b.updated_at || "").localeCompare(a.updated_at || "")
  sessionFiltered.sort(sortByUpdated)
  restoredFiltered.sort(sortByUpdated)

  const hasAnyRaw = liveJobs.length > 0 || dedupedHistorical.length > 0
  const hasAnyFiltered = sessionFiltered.length > 0 || restoredFiltered.length > 0 || historicalFiltered.length > 0
  const isFiltering = !!query || filter !== "all"

  if (!hasAnyRaw) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm px-4">
        还没有任务,从上方"新建"开始。
      </div>
    )
  }

  if (!hasAnyFiltered) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm px-4">
        {isFiltering ? "当前过滤下没有匹配的任务" : "没有任务"}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {sessionFiltered.length > 0 && (
        <>
          <SectionHeader>本会话 · {sessionFiltered.length}</SectionHeader>
          <div className="flex flex-col gap-1">
            {sessionFiltered.map(job => (
              <JobRow key={job.id} job={job} selected={selectedId === job.id} onClick={() => onSelect(job.id)} />
            ))}
          </div>
        </>
      )}

      {restoredFiltered.length > 0 && (
        <>
          {sessionFiltered.length > 0 && <div className="my-1 border-t border-border/50" />}
          <SectionHeader muted>
            后端活跃 · {restoredFiltered.length}
            <span className="ml-1.5 text-[9px] normal-case tracking-normal text-muted-foreground/50">
              · 服务重启 restore 的 job
            </span>
          </SectionHeader>
          <div className="flex flex-col gap-1">
            {restoredFiltered.map(job => (
              <JobRow key={job.id} job={job} selected={selectedId === job.id} onClick={() => onSelect(job.id)} dim />
            ))}
          </div>
        </>
      )}

      {historicalFiltered.length > 0 && (
        <>
          {(sessionFiltered.length > 0 || restoredFiltered.length > 0) && (
            <div className="my-1 border-t border-border/50" />
          )}
          <SectionHeader muted>
            历史归档 · {historicalFiltered.length} 篇
            {isFiltering && historicalFiltered.length !== dedupedHistorical.length && ` / ${dedupedHistorical.length}`}
          </SectionHeader>
          <div className="flex flex-col gap-1">
            {historicalFiltered.map(job => (
              <JobRow key={job.id} job={job} selected={selectedId === job.id} onClick={() => onSelect(job.id)} historical />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SectionHeader({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "px-3 py-1 text-[10px] uppercase tracking-wider font-semibold select-none",
        muted ? "text-muted-foreground/50" : "text-muted-foreground/80",
      )}
    >
      {children}
    </div>
  )
}

// status 对应的左侧 colored dot —— 比 badge 更轻量的视觉锚
function StatusDot({ status }: { status: string }) {
  const cls = (() => {
    switch (status) {
      case "running": return "bg-blue-400 animate-pulse"
      case "queued": return "bg-slate-400"
      case "paused": return "bg-amber-400 animate-pulse"
      case "succeeded": return "bg-emerald-500"
      case "draft": return "bg-amber-500"
      case "failed": return "bg-destructive"
      default: return "bg-muted-foreground/40"
    }
  })()
  return <span className={cn("size-2 rounded-full shrink-0", cls)} aria-hidden />
}

function JobRow({
  job, selected, onClick, historical, dim,
}: {
  job: EngineJob; selected: boolean; onClick: () => void;
  historical?: boolean; dim?: boolean
}) {
  // 5/28 UX 重构：信息密度优先，去掉演讲人占据右下显眼位（改放成本/评分元数据）。
  // 标题用 Tooltip 替代 native title 避免浮窗错位 bug。
  const strategy = job.request.rewrite_strategy
  const isSectioned = strategy === "sectioned"
  const modeLabel = job.request.mode === "full" ? "full" : "quick"
  const passScore = job.pass_score // 历史归档专属
  const hasCost = !historical && job.estimated_cost_usd > 0
  const tsLabel = formatRelativeOrAbsolute(job.updated_at || job.created_at)

  return (
    <button
      onClick={onClick}
      className={cn(
        "group text-left p-2.5 rounded-lg border transition-all w-full",
        selected
          ? "bg-primary/10 border-primary/30"
          : "bg-transparent border-transparent hover:bg-accent/50 hover:border-border",
        // dim：后端 restore 但非本会话；historical：已归档成品。两者都视觉降权。
        (dim || historical) && !selected && "opacity-70 hover:opacity-100",
      )}
    >
      {/* Row 1：左侧 colored dot + 标题（带 Radix Tooltip）+ 右侧 status badge */}
      <div className="flex items-start gap-2 mb-1">
        <div className="pt-1">
          <StatusDot status={job.status} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <h3 className="font-semibold text-sm leading-snug line-clamp-2 flex-1 min-w-0 break-all cursor-default">
              {job.stem}
            </h3>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" collisionPadding={16} className="max-w-xs">
            <p className="text-xs leading-relaxed break-all">{job.stem}</p>
          </TooltipContent>
        </Tooltip>
        <StatusBadge status={job.status} />
      </div>

      {/* Row 2: meta chips —— 时间 · 模式 · sectioned 标记 · 评分 · 成本 · 演讲人(轻) */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-4 text-[10.5px] text-muted-foreground">
        {tsLabel && <span className="font-medium">{tsLabel}</span>}
        <span className="text-muted-foreground/40">·</span>
        <span className="uppercase tracking-wide">{modeLabel}</span>
        {isSectioned && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-primary/80">sectioned</span>
          </>
        )}
        {passScore && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-emerald-400/80">{passScore}</span>
          </>
        )}
        {hasCost && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-amber-400/70 font-mono">${job.estimated_cost_usd.toFixed(4)}</span>
          </>
        )}
        {job.request.speaker && job.request.speaker !== "我" && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="truncate max-w-[80px] text-muted-foreground/60" title={job.request.speaker}>
              {job.request.speaker}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

// ═══════════════════ Empty State ═══════════════════
// 离线提示已由顶部全局 OfflineBar 统一承担,这里只保留产品价值文案。
// ═══════════════════ Home（问候 + 创作概览 + 启动器 composer）═══════════════════
// 对齐 Claude 桌面端首页：右侧问候标题 + Overview 卡 + 底部 composer。
// 概览数据全部来自本地 historicalJobs（磁盘成品），真实可算，不造假。

function parseScore(s?: string): number | null {
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*\d+/)
  return m ? parseFloat(m[1]) : null
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function HomeView({ historicalJobs, onCreate, healthOffline, defaultProfileName }: {
  historicalJobs: EngineJob[]
  onCreate: () => void
  healthOffline: boolean
  defaultProfileName: string | null
}) {
  const stats = useMemo(() => {
    const posts = historicalJobs.filter(j => j.kind === "historical")
    const dates = posts.map(p => p.created_at).filter(Boolean)
    const activeDays = new Set(dates.map(d => d.slice(0, 10))).size
    const now = Date.now()
    const last30 = posts.filter(p => {
      const t = Date.parse(p.created_at)
      return !isNaN(t) && now - t <= 30 * 864e5
    }).length
    const scores = posts.map(p => parseScore(p.pass_score)).filter((n): n is number => n != null)
    const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null
    const drafts = posts.filter(p => p.is_draft).length
    const routingCount = new Map<string, number>()
    posts.forEach(p => routingCount.set(p.request.routing, (routingCount.get(p.request.routing) ?? 0) + 1))
    const topRouting = [...routingCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
    const perDay = new Map<string, number>()
    posts.forEach(p => { const k = p.created_at.slice(0, 10); if (k) perDay.set(k, (perDay.get(k) ?? 0) + 1) })
    return { total: posts.length, activeDays, last30, avgScore, drafts, formal: posts.length - drafts, topRouting, perDay }
  }, [historicalJobs])

  return (
    <div className="app-main flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-3xl mx-auto px-8 pt-16 pb-8">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight mb-8">
            <Sparkle className="size-6 text-primary" />
            接下来，写点什么？
          </h1>

          <div className="rounded-2xl border bg-card/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">创作概览</span>
              {defaultProfileName && (
                <Badge variant="outline" className="text-[10px] font-mono">默认档 · {defaultProfileName}</Badge>
              )}
            </div>
            {stats.total === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">还没有成品。开始第一篇改写，这里会长出你的创作轨迹。</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCell label="成品" value={String(stats.total)} />
                  <StatCell label="活跃天数" value={String(stats.activeDays)} />
                  <StatCell label="近 30 天" value={String(stats.last30)} />
                  <StatCell label="平均质检" value={stats.avgScore != null ? `${stats.avgScore.toFixed(0)}/60` : "—"} />
                  <StatCell label="常用路由" value={stats.topRouting} mono />
                  <StatCell label="正式 / 草稿" value={`${stats.formal} / ${stats.drafts}`} />
                </div>
                <Heatmap perDay={stats.perDay} />
                <p className="text-xs text-muted-foreground/70 mt-3">
                  你已写下 <b className="text-foreground">{stats.total}</b> 篇署名博文，覆盖 {stats.activeDays} 个创作日。
                </p>
              </>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* 底部 composer（启动器式）—— 点击展开 CreateForm */}
      <div className="shrink-0 border-t bg-background/80 px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={onCreate}
            disabled={healthOffline}
            className="group w-full rounded-2xl border bg-card hover:border-primary/40 transition-colors p-4 flex items-center gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="size-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Plus className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground">开始一篇改写…</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                选一段转录稿 / 文字稿，AI 清洗·提炼·搭骨架·改写·质检，落盘成署名博文
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              {defaultProfileName && <Badge variant="outline" className="text-[10px] font-mono">{defaultProfileName}</Badge>}
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono text-muted-foreground">⌘N</kbd>
            </div>
          </button>
          {healthOffline && (
            <p className="text-xs text-destructive/80 mt-2 text-center">后端离线，请先 <code className="text-[11px]">make server</code> 启动</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold mt-0.5 truncate", mono && "font-mono text-base")}>{value}</div>
    </div>
  )
}

// 博文活动热力图 —— 近 10 周每天产出篇数，珊瑚色阶；自绘 CSS grid，不引图表库。
function Heatmap({ perDay }: { perDay: Map<string, number> }) {
  const weeks = 10
  const today = new Date()
  const cells: { key: string; count: number }[] = []
  const start = new Date(today)
  start.setDate(start.getDate() - (weeks * 7 - 1))
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const k = dayKey(d)
    cells.push({ key: k, count: perDay.get(k) ?? 0 })
  }
  const tone = (c: number) =>
    c === 0 ? "bg-muted/60"
    : c === 1 ? "bg-primary/35"
    : c === 2 ? "bg-primary/60"
    : "bg-primary/90"
  return (
    <div className="mt-4 flex gap-[3px]">
      {Array.from({ length: weeks }).map((_, w) => (
        <div key={w} className="flex flex-col gap-[3px]">
          {cells.slice(w * 7, w * 7 + 7).map(cell => (
            <div
              key={cell.key}
              title={`${cell.key} · ${cell.count} 篇`}
              className={cn("size-2.5 rounded-[3px]", tone(cell.count))}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════ Job Workspace ═══════════════════
interface JobWorkspaceProps {
  job: EngineJob
  activeTab: "console" | "outline" | "review" | "final" | "artifacts"
  setActiveTab: (v: "console" | "outline" | "review" | "final" | "artifacts") => void
  logs: string[]
  currentStep: number | null
  pausedAt: "outline" | "review" | null
  outlineText: string
  setOutlineText: (v: string) => void
  outlineViewMode: "edit" | "preview" | "split"
  setOutlineViewMode: (v: "edit" | "preview" | "split") => void
  draftContent: string
  reviewJson: ReviewJson | null
  isSubmittingOutline: boolean
  isSubmittingDraft: boolean
  onApproveOutline: () => void
  onApproveDraft: (accept: boolean) => void
  onRefresh: () => void
  onCopy: (text: string) => void
  onCancel: () => void
  onOpenInOS: (path: string, mode: "finder" | "editor") => void
  onRetry: (job: EngineJob, modelOverride?: string) => void
  healthOffline: boolean
  sseStatus: "idle" | "connecting" | "connected" | "reconnecting" | "terminal"
  lastEventAt: number | null
  outlineDraftRestoredTs: number | null
  onReloadOutlineOriginal: () => void
  setDraftContent: (v: string) => void
  draftViewMode: "edit" | "preview" | "split"
  setDraftViewMode: (v: "edit" | "preview" | "split") => void
  draftEditRestoredTs: number | null
  onReloadDraftOriginal: () => void
  onOpenSettings: () => void
}

function JobWorkspace(props: JobWorkspaceProps) {
  const { job, activeTab, setActiveTab, logs, currentStep, pausedAt } = props
  const isHistorical = job.kind === "historical"
  const isFailed = job.status === "failed"
  // SSE 指示器只在"还可能在跑"的任务上显示;历史归档 / 已 succeeded / 已 failed 都不要
  const showSseIndicator = !isHistorical && job.status !== "succeeded" && job.status !== "failed"
  // 失败自动归因 —— hook 内部已经做去重,每个 job.id 只跑一次
  const { diagnosis, isDiagnosing } = useFailureDiagnosis(isFailed ? job : null)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-2 border-b">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2 flex-wrap">
              <span className="truncate">{job.stem}</span>
              {!isHistorical && (
                <code className="text-xs font-mono text-muted-foreground font-normal">
                  ({job.id.substring(0, 8)})
                </code>
              )}
              <StatusBadge status={job.status} />
              {isHistorical && job.pass_score && (
                <Badge variant="outline" className="text-xs">{job.pass_score}</Badge>
              )}
            </h2>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1"><User className="size-3" /> {job.request.speaker}</span>
              <span>路由 <code className="text-xs">{job.request.routing}</code></span>
              <span>模式 <code className="text-xs">{job.request.mode}</code></span>
              {/* 模型 / API Base —— 失败任务定位根因最关键的两个字段,顶到 Header 而不是埋在表单里 */}
              <span title={job.request.model || "未指定,后端走环境变量默认"}>
                模型 <code className={cn("text-xs", !job.request.model && "text-muted-foreground/60")}>
                  {job.request.model || "环境默认"}
                </code>
              </span>
              {job.request.api_base && (
                <span title={job.request.api_base}>
                  API <code className="text-xs">{shortApiBase(job.request.api_base)}</code>
                </span>
              )}
              <span className="truncate max-w-[300px]">源 <code className="text-xs">{job.request.source}</code></span>
              {(job.input_tokens > 0 || job.output_tokens > 0) && (
                <span className="flex items-center gap-1.5 ml-auto">
                  <span className="flex items-center gap-1">
                    <DollarSign className="size-3 text-emerald-500" />
                    <span className="font-mono text-emerald-400">${job.estimated_cost_usd.toFixed(4)}</span>
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="font-mono">
                    {(job.input_tokens / 1000).toFixed(1)}k in / {(job.output_tokens / 1000).toFixed(1)}k out
                  </span>
                </span>
              )}
            </div>
          </div>
          {!isHistorical && (
            <div className="flex items-center gap-2 shrink-0">
              {showSseIndicator && (
                <SseStatusIndicator status={props.sseStatus} lastEventAt={props.lastEventAt} />
              )}
              {(job.status === "running" || job.status === "queued" || job.status === "paused") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={props.onCancel}
                      disabled={props.healthOffline}
                      className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <XCircle />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {props.healthOffline ? "后端离线,无法取消" : "取消任务(引擎会在下一个 checkpoint 退出)"}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={props.onRefresh} className="size-8">
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">刷新状态与日志</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Step progress bar — 历史归档直接全绿(已成品)*/}
        <StepProgress
          mode={job.request.mode as "full" | "quick"}
          jobStatus={isHistorical ? "succeeded" : job.status}
          currentStep={isHistorical ? 8 : currentStep}
          pausedAt={pausedAt}
          hasTranscription={/\.(mp4|mov|m4v|mkv|webm|flv|avi)$/i.test(job.request.source || "")}
          onJump={target => {
            // 历史归档只允许跳 final;非历史可任意跳
            if (isHistorical && target !== "final") return
            setActiveTab(target)
          }}
        />

        {/* 失败 Banner —— 让 job.error 不再藏在日志深处,并嵌一份自动诊断 + 一键换模型重跑 */}
        {isFailed && (
          <FailureBanner
            error={job.error || "未知错误(后端未返回 error 字段)"}
            diagnosis={diagnosis}
            isDiagnosing={isDiagnosing}
            currentModel={job.request.model}
            onCopy={props.onCopy}
            onRetry={() => props.onRetry(job)}
            onRetryWithModel={(m) => props.onRetry(job, m)}
            onOpenSettings={props.onOpenSettings}
          />
        )}
      </div>

      {/* Tabs — 历史归档只暴露"成品及报告"tab(没日志、没暂停产物)*/}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "console" | "outline" | "review" | "final" | "artifacts")} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-3">
          <TabsList>
            {!isHistorical && (
              <TabsTrigger value="console">
                <Layers data-icon="inline-start" />
                运行日志
              </TabsTrigger>
            )}
            {/* tab 切换器用 paused_state 而非看磁盘内容 —— 旧 draft_v* 残留时
                outlineText/draftContent 启发式会让 outline tab 不出现、review
                tab 出现，把用户卡在错误的审批界面无法继续。5/28 撞过两次。 */}
            {!isHistorical && job.status === "paused" && job.paused_state === "WAITING_USER_OUTLINE" && (
              <TabsTrigger value="outline">
                <ListTree data-icon="inline-start" />
                骨架大纲审批
              </TabsTrigger>
            )}
            {!isHistorical && job.status === "paused" && job.paused_state === "WAITING_USER_REVIEW" && (
              <TabsTrigger value="review">
                <Edit data-icon="inline-start" />
                草稿与质检
              </TabsTrigger>
            )}
            {(isHistorical || job.status === "succeeded") && (
              <TabsTrigger value="final">
                <Award data-icon="inline-start" />
                {isHistorical ? "成品归档" : "成品及报告"}
              </TabsTrigger>
            )}
            {!isHistorical && (
              <TabsTrigger value="artifacts">
                <FolderOpen data-icon="inline-start" />
                过程产物
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden px-6 py-4">
          <TabsContent value="console" className="h-full m-0">
            {/* 历史归档不渲染 LogConsole；这里把 jobStatus 传下去让日志事件按 job 整体态降级历史 step / paused */}
            <LogConsole logs={logs} jobStatus={isHistorical ? "succeeded" : job.status} className="h-full" />
          </TabsContent>

          <TabsContent value="outline" className="h-full m-0">
            <OutlineView {...props} />
          </TabsContent>

          <TabsContent value="review" className="h-full m-0">
            <DraftReviewView {...props} />
          </TabsContent>

          <TabsContent value="final" className="h-full m-0">
            <FinalView job={job} onCopy={props.onCopy} onOpenInOS={props.onOpenInOS} />
          </TabsContent>

          <TabsContent value="artifacts" className="h-full m-0">
            <ArtifactsView job={job} onCopy={props.onCopy} onOpenInOS={props.onOpenInOS} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// ═══════════════════ Outline Edit View ═══════════════════
function OutlineView({ outlineText, setOutlineText, outlineViewMode, setOutlineViewMode, isSubmittingOutline, onApproveOutline, job, healthOffline, outlineDraftRestoredTs, onReloadOutlineOriginal }: JobWorkspaceProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {outlineDraftRestoredTs && (
        <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
          <RotateCw className="text-amber-500" />
          <AlertTitle className="flex items-center justify-between gap-2 text-sm">
            <span>已恢复 {formatRelativeTime(outlineDraftRestoredTs)}的本地编辑</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReloadOutlineOriginal}
              className="h-7 text-xs"
            >
              <X data-icon="inline-start" />
              丢弃,载入后端原始
            </Button>
          </AlertTitle>
        </Alert>
      )}
      <Alert className="border-primary/30 bg-primary/5">
        <ListTree className="text-primary" />
        <AlertTitle className="flex items-center justify-between">
          <span>Step 5 · 骨架大纲审批</span>
          <Button onClick={onApproveOutline} disabled={isSubmittingOutline || healthOffline} size="sm" title={healthOffline ? "后端离线,无法提交" : undefined}>
            {isSubmittingOutline ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
            批准大纲并开始撰写
          </Button>
        </AlertTitle>
        <AlertDescription>
          AI 已生成博文骨架,审查后批准会进入 Step 6 全文撰写。改了就改了,这是你的最后一次结构性干预。
        </AlertDescription>
      </Alert>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="py-2.5 px-4 border-b flex-row items-center justify-between space-y-0">
          <code className="text-xs text-muted-foreground">work/{job.stem}/outline.md</code>
          <div className="flex items-center gap-1">
            <Button
              variant={outlineViewMode === "edit" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOutlineViewMode("edit")}
              className="h-7 text-xs"
            >
              源码
            </Button>
            <Button
              variant={outlineViewMode === "split" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOutlineViewMode("split")}
              className="h-7 text-xs"
            >
              分屏
            </Button>
            <Button
              variant={outlineViewMode === "preview" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setOutlineViewMode("preview")}
              className="h-7 text-xs"
            >
              预览
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
          {outlineViewMode === "split" ? (
            <div className="grid grid-cols-2 h-full divide-x">
              <textarea
                value={outlineText}
                onChange={e => setOutlineText(e.target.value)}
                className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                spellCheck={false}
              />
              <ScrollArea className="h-full">
                <div className="p-6">
                  <MarkdownView source={outlineText} />
                </div>
              </ScrollArea>
            </div>
          ) : outlineViewMode === "edit" ? (
            <textarea
              value={outlineText}
              onChange={e => setOutlineText(e.target.value)}
              className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
              spellCheck={false}
            />
          ) : (
            <ScrollArea className="h-full">
              <div className="px-6 py-5 max-w-[70ch] mx-auto">
                <MarkdownView source={outlineText} />
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════ Draft + Review View ═══════════════════
function DraftReviewView({ draftContent, setDraftContent, reviewJson, isSubmittingDraft, onApproveDraft, healthOffline, draftViewMode, setDraftViewMode, draftEditRestoredTs, onReloadDraftOriginal }: JobWorkspaceProps) {
  const parseFailed = reviewJson?.parse_failed === true
  const offlineTitle = healthOffline ? "后端离线,无法提交" : undefined

  return (
    <div className="flex flex-col h-full gap-4">
      {/* 草稿编辑恢复 Banner —— 跟 OutlineView 同款 */}
      {draftEditRestoredTs && (
        <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
          <RotateCw className="text-amber-500" />
          <AlertTitle className="flex items-center justify-between gap-2 text-sm">
            <span>已恢复 {formatRelativeTime(draftEditRestoredTs)}的本地编辑</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReloadDraftOriginal}
              className="h-7 text-xs"
            >
              <X data-icon="inline-start" />
              丢弃,载入后端原始
            </Button>
          </AlertTitle>
        </Alert>
      )}

      {/* Banner — 区分 parse_failed 和正常 REVIEW */}
      {parseFailed ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 质检系统失效,请人工裁判</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-emerald-600 hover:bg-emerald-500">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受并以 DRAFT 落盘
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            LLM 没按合同输出评分表,引擎跳过了自修正,把决定权交给你。读右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受"会一并回写后端。
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <Award className="text-amber-500" />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 · 质检人工审批</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-emerald-600 hover:bg-emerald-500">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受为草稿 (DRAFT)
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            博文初稿已生成,但未达到自动发布阈值。看一眼右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受为草稿"会一并回写后端;也可弃用重跑。
          </AlertDescription>
        </Alert>
      )}

      {/* Score card (左) + Draft preview (右) */}
      <div className="flex-1 grid grid-cols-3 gap-4 overflow-hidden">
        {/* Score card */}
        <Card className="col-span-1 overflow-hidden flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>质检得分</span>
              <span className={cn("text-2xl font-bold tabular-nums", parseFailed ? "text-destructive" : "text-amber-400")}>
                {reviewJson?.total ?? "—"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
            {reviewJson && !parseFailed && Object.entries(reviewJson.scores || {}).length > 0 && (
              <div className="flex flex-col gap-2.5">
                {Object.entries(reviewJson.scores).map(([dim, score]) => (
                  <ScoreBar key={dim} dim={dim} score={score} />
                ))}
              </div>
            )}
            <Separator />
            <div className="flex-1 overflow-hidden flex flex-col">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Re-Brief 改进建议
              </h4>
              <ScrollArea className="flex-1 min-h-0">
                <div className="text-xs text-foreground/80 leading-relaxed pr-2 whitespace-pre-wrap">
                  {reviewJson?.rebrief?.trim() || (
                    <span className="text-muted-foreground italic">无具体反馈。可能 LLM 直接给了 PASS,或质检解析失败正在加载详细原因。</span>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        {/* Draft 编辑/预览 —— 三档切换,改完接受时一并回写后端 */}
        <Card className="col-span-2 overflow-hidden flex flex-col">
          <CardHeader className="py-2.5 px-4 border-b flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle className="text-sm font-normal text-muted-foreground">草稿</CardTitle>
              <code className="text-[10px] text-muted-foreground/60 truncate">draft_v{reviewJson?.version ?? 1}.md</code>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant={draftViewMode === "edit" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setDraftViewMode("edit")}
                className="h-7 text-xs"
              >
                源码
              </Button>
              <Button
                variant={draftViewMode === "split" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setDraftViewMode("split")}
                className="h-7 text-xs"
              >
                分屏
              </Button>
              <Button
                variant={draftViewMode === "preview" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setDraftViewMode("preview")}
                className="h-7 text-xs"
              >
                预览
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            {!draftContent ? (
              <div className="px-6 py-5 text-muted-foreground italic text-sm">正在加载初稿...</div>
            ) : draftViewMode === "split" ? (
              <div className="grid grid-cols-2 h-full divide-x">
                <textarea
                  value={draftContent}
                  onChange={e => setDraftContent(e.target.value)}
                  className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                  spellCheck={false}
                />
                <ScrollArea className="h-full">
                  <div className="px-6 py-5">
                    <MarkdownView source={draftContent} />
                  </div>
                </ScrollArea>
              </div>
            ) : draftViewMode === "edit" ? (
              <textarea
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                spellCheck={false}
              />
            ) : (
              <ScrollArea className="h-full">
                <div className="px-6 py-5 max-w-[70ch] mx-auto">
                  <MarkdownView source={draftContent} />
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ScoreBar({ dim, score }: { dim: string; score: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-foreground/80 shrink-0 w-20">{dim}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            score >= 8 ? "bg-emerald-500" : score >= 5 ? "bg-amber-500" : "bg-destructive",
          )}
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </div>
      <span className="font-semibold tabular-nums w-5 text-right">{score}</span>
    </div>
  )
}

// 去掉 markdown 顶部 YAML frontmatter，只渲染正文（阅读视图）。
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/)
  return m ? md.slice(m[0].length).replace(/^\s+/, "") : md
}

// ═══════════════════ Final View（artifact 文档阅读器）═══════════════════
// 成品博文是主角：居中阅读列渲染整篇文档；元信息（路径/质检/成本）降为次级。
function FinalView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  const isHistorical = job.kind === "historical"
  const isDraft = job.is_draft === true || job.status === "draft"
  const path = job.final_post_path
  const [content, setContent] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setContent(null); return }
    setContent(null); setLoadErr(null)
    fetch(apiUrl(`/file?path=${encodeURIComponent(path)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setContent(stripFrontmatter(d.content ?? "")))
      .catch(e => setLoadErr(String(e)))
  }, [path])

  return (
    <ScrollArea className="h-full">
      {/* 顶部 meta 条（sticky）—— 状态 + 质检 + 操作 */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur border-b px-6 py-2.5 flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            isDraft ? "border-amber-500/40 text-amber-500" : "border-emerald-500/40 text-emerald-500",
          )}
        >
          {isDraft ? "DRAFT 归档" : isHistorical ? "成品归档" : "博文成品"}
        </Badge>
        {job.pass_score && <Badge variant="outline" className="text-[10px] font-mono">质检 {job.pass_score}</Badge>}
        {!isHistorical && job.estimated_cost_usd > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono">${job.estimated_cost_usd.toFixed(4)}</Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => content && onCopy(content)} disabled={!content}>
          <Copy data-icon="inline-start" /> 复制全文
        </Button>
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "finder")} title="在 Finder 显示">
            <FolderOpen />
          </Button>
        )}
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "editor")} title="用默认编辑器打开">
            <ExternalLink />
          </Button>
        )}
      </div>

      {/* 文档阅读列 —— 成品是主角 */}
      <div className="px-6 py-8 max-w-[72ch] mx-auto">
        {loadErr ? (
          <Alert variant="destructive" className="py-2">
            <AlertCircle />
            <AlertTitle className="text-sm">成品载入失败</AlertTitle>
            <AlertDescription className="text-xs break-all">{loadErr}</AlertDescription>
          </Alert>
        ) : content == null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="animate-spin size-4" /> 正在载入成品…
          </div>
        ) : (
          <MarkdownView source={content} />
        )}

        {/* 次级详情 —— 路径 / frontmatter / 成本，降权放在文末 */}
        <Separator className="my-8" />
        <div className="flex flex-col gap-3">
          <PathRow label="成品路径" path={job.final_post_path} onCopy={onCopy} onOpenInOS={onOpenInOS} />
          <PathRow label="质检报告" path={job.review_path} onCopy={onCopy} onOpenInOS={onOpenInOS} />
          {isHistorical ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs pt-1">
              <InfoRow label="发布日期" value={job.created_at} />
              <InfoRow label="演讲人" value={job.request.speaker} />
              <InfoRow label="路由" value={job.request.routing} />
              <InfoRow label="质检得分" value={job.pass_score} mono />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-xs pt-1">
              <InfoRow label="预估成本" value={`$${job.estimated_cost_usd.toFixed(5)}`} mono />
              <InfoRow label="输入 Token" value={job.input_tokens.toLocaleString()} mono />
              <InfoRow label="输出 Token" value={job.output_tokens.toLocaleString()} mono />
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

// ═══════════════════ 过程产物面板 ═══════════════════
// 列 work/<stem>/ 下所有中间产物，点开经 /file 查看；跑的过程中也能刷新看逐步生成。
interface WorkFile {
  name: string
  path: string
  size: number
  kind: string
  mtime: number
}
const ARTIFACT_META: Record<string, { label: string; order: number }> = {
  transcript: { label: "原始转录", order: 0 },
  subtitle: { label: "字幕", order: 1 },
  meta: { label: "转录元数据", order: 2 },
  clean: { label: "清洗稿", order: 3 },
  insights: { label: "观点提炼", order: 4 },
  outline: { label: "大纲", order: 5 },
  draft: { label: "草稿", order: 6 },
  review: { label: "质检", order: 7 },
  log: { label: "转录日志", order: 8 },
  state: { label: "状态机", order: 9 },
  events: { label: "事件流", order: 10 },
  other: { label: "其它", order: 11 },
}
function artifactBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ArtifactsView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  const [files, setFiles] = useState<WorkFile[]>([])
  const [listErr, setListErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentErr, setContentErr] = useState<string | null>(null)
  const stem = job.stem

  const loadList = useMemo(() => () => {
    setListErr(null)
    fetch(apiUrl(`/work-files?stem=${encodeURIComponent(stem)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<WorkFile[]> })
      .then(list => {
        list.sort((a, b) => (ARTIFACT_META[a.kind]?.order ?? 99) - (ARTIFACT_META[b.kind]?.order ?? 99) || a.name.localeCompare(b.name))
        setFiles(list)
        setSelected(prev => (prev && list.some(f => f.path === prev) ? prev : list[0]?.path ?? null))
      })
      .catch(e => setListErr(String(e)))
  }, [stem])

  useEffect(() => { loadList() }, [loadList])

  // 运行中自动刷新文件列表（每 5s）——逐步生成的产物即时出现；终态即停。
  // 只刷列表，不自动重拉正在看的文件内容，避免阅读被打断（要看最新内容点 🔄 或重选）。
  useEffect(() => {
    if (job.status !== "running" && job.status !== "queued") return
    const t = window.setInterval(loadList, 5000)
    return () => window.clearInterval(t)
  }, [job.status, loadList])

  // 选中文件 → 读内容
  useEffect(() => {
    if (!selected) { setContent(null); return }
    setContent(null); setContentErr(null)
    fetch(apiUrl(`/file?path=${encodeURIComponent(selected)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setContent(d.content ?? ""))
      .catch(e => setContentErr(String(e)))
  }, [selected])

  const selFile = files.find(f => f.path === selected)
  const ext = (selFile?.name.split(".").pop() ?? "").toLowerCase()

  let viewer: React.ReactNode
  if (contentErr) {
    viewer = <Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{contentErr}</AlertDescription></Alert>
  } else if (content === null) {
    viewer = <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="animate-spin size-4" /> 载入中…</div>
  } else if (ext === "md") {
    viewer = <div className="max-w-[72ch] mx-auto"><MarkdownView source={content} /></div>
  } else {
    let text = content
    if (ext === "json") { try { text = JSON.stringify(JSON.parse(content), null, 2) } catch { /* 原文 */ } }
    viewer = <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">{text}</pre>
  }

  return (
    <div className="flex h-full gap-3 min-h-0">
      {/* 左：文件列表 */}
      <div className="w-56 shrink-0 flex flex-col min-h-0 border rounded-lg bg-card/40">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">work/{stem}/</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={loadList} title="刷新（运行中可随时看最新产物）" className="size-6">
            <RotateCw className="size-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-1.5 flex flex-col gap-0.5">
            {listErr && <div className="text-xs text-destructive p-2">{listErr}</div>}
            {!listErr && files.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">还没有产物。任务开始后这里会逐步出现。</div>}
            {files.map(f => (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f.path)}
                className={cn(
                  "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                  f.path === selected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                )}
              >
                <div className="text-xs font-medium truncate">{ARTIFACT_META[f.kind]?.label ?? f.kind}</div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground font-mono truncate">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">{artifactBytes(f.size)}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* 右：查看器 */}
      <div className="flex-1 flex flex-col min-h-0 border rounded-lg bg-card/40">
        {selFile && (
          <div className="flex items-center gap-2 px-4 py-2 border-b">
            <span className="text-sm font-medium">{ARTIFACT_META[selFile.kind]?.label ?? selFile.kind}</span>
            <code className="text-[11px] text-muted-foreground">{selFile.name}</code>
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" disabled={content === null} onClick={() => content && onCopy(content)} title="复制内容">
              <Copy className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInOS(selFile.path, "editor")} title="用编辑器打开">
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
        )}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4">
            {selected ? viewer : <div className="text-sm text-muted-foreground py-10 text-center">从左侧选一个产物查看</div>}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <code className={cn("text-foreground/90", mono && "font-mono")}>{value || "—"}</code>
    </div>
  )
}

function PathRow({ label, path, onCopy, onOpenInOS }: { label: string; path?: string; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  if (!path) return null
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded border text-xs">
        <code className="text-primary truncate select-all">{path}</code>
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onCopy(path)}>
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">复制路径</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "finder")}>
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">在 Finder 中显示</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "editor")}>
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">用默认应用打开</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
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

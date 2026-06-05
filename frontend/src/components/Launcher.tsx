import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { Ref } from "react"
import { FileAudio, FileText, Film, Loader2, MoreHorizontal, Plus, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Checkbox, TextInput } from "@/components/form-primitives"
import { SourcePicker, pushRecentSource } from "@/components/SourcePicker"
import { LauncherChip } from "@/components/LauncherChip"
import { cn } from "@/lib/utils"
import { API_BASE } from "@/lib/api"
import { parseLauncherCommand, type LauncherSubmitPayload } from "@/lib/launcher-command"
import type { LlmProfile } from "@/lib/settings-store"

// 路由自动建议（按文件名启发式）。从旧 CreateForm 搬过来，原样保留。
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|mkv|webm|flv|avi)$/i
function suggestRouting(source: string): string {
  const s = source.toLowerCase()
  if (/对谈|访谈|对话|嘉宾|播客|dialogue|interview|podcast/.test(s)) return "/dialogue"
  if (/录屏|演示|教程|walkthrough|screencast|demo|tutorial/.test(s)) return "/screencast"
  if (/会议|复盘|纪要|meeting|standup/.test(s)) return "/meeting"
  if (/讲座|课|分享|talk|lecture|keynote/.test(s)) return "/lecture"
  return ""
}
function sourceKind(source: string): "video" | "transcript" | "text" | "" {
  const s = source.toLowerCase()
  if (VIDEO_EXT_RE.test(s) || s.includes("input/video/")) return "video"
  if (/raw\.txt$|\.srt$|\.vtt$/.test(s) || s.includes("/work/")) return "transcript"
  if (s.includes("input/text/") || /\.(md|txt)$/.test(s)) return "text"
  return ""
}

// 父级用 ref 操控的命令式 API
export interface LauncherHandle {
  injectSource: (path: string) => void
  // 父级（HomeView）整页拖拽接管时，把 File 转给 Launcher 走统一 upload 通道
  uploadFile: (file: File) => Promise<void>
  // 一次性把所有字段灌进来（重跑场景用）。会触发 inline expand。
  prefill: (payload: LauncherSubmitPayload) => void
  open: () => void
  collapse: () => void
}

export interface LauncherProps {
  variant: "inline" | "overlay"
  open?: boolean              // overlay 专用受控开关
  onClose?: () => void        // overlay 专用关闭回调
  apiBase?: string            // 默认 API_BASE，可覆盖（测试用）
  transcriptionAvailable: boolean
  profileOptions: LlmProfile[]
  defaultProfileId: string | null
  healthOffline: boolean
  onSubmit: (p: LauncherSubmitPayload) => Promise<boolean>  // 返回 true=成功，由父级决定是否清表单
  onOpenSettings: () => void
  ref?: Ref<LauncherHandle>
}

const DEFAULT_SPEAKER_STORE_KEY = "v2b_last_speaker"

export function Launcher(props: LauncherProps) {
  const apiBase = props.apiBase ?? API_BASE

  // ── 必填层 state ──
  const [source, setSource] = useState("")
  const [routing, setRouting] = useState("/lecture")
  const [routingAutoSuggested, setRoutingAutoSuggested] = useState(false)
  const [routingTouched, setRoutingTouched] = useState(false)
  const [speaker, setSpeaker] = useState(
    () => localStorage.getItem(DEFAULT_SPEAKER_STORE_KEY) || "我",
  )
  const [pauseOnOutline, setPauseOnOutline] = useState(true)

  // 演讲人识别：detectedSpeaker 是后端返回的最新识别值（用于跟当前 speaker 不一致时显示 dot）
  const [detectedSpeaker, setDetectedSpeaker] = useState<string | null>(null)
  const [detectingSpeaker, setDetectingSpeaker] = useState(false)
  const speakerTouchedRef = useRef(false)

  // ── 高级层 state（默认收在 ⋯ popover 里） ──
  const [maxRetries, setMaxRetries] = useState(1)
  const [force, setForce] = useState(false)
  const [rewriteStrategy, setRewriteStrategy] = useState<"single" | "sectioned">("single")
  const [trueQuick, setTrueQuick] = useState(false)
  const [profileId, setProfileId] = useState("")
  const [transcribeEngine, setTranscribeEngine] = useState<"default" | "whisper-cpp" | "mlx">("default")

  // ── inline 折叠/展开（overlay 由父级控制 open） ──
  const [innerExpanded, setInnerExpanded] = useState(false)
  const expanded = props.variant === "overlay" ? !!props.open : innerExpanded

  // ── 提交中 / 拖拽态 / 上传中 ──
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 浮层 / inline 用同一份字段重置
  const resetFields = () => {
    setSource("")
    setRouting("/lecture")
    setRoutingAutoSuggested(false)
    setRoutingTouched(false)
    setPauseOnOutline(true)
    setMaxRetries(1)
    setForce(false)
    setRewriteStrategy("single")
    setTrueQuick(false)
    setProfileId("")
    setTranscribeEngine("default")
    setDetectedSpeaker(null)
    speakerTouchedRef.current = false
    setUploadErr(null)
  }

  // 父级命令式 API（uploadFile 在下面 uploadFile 定义后通过 ref 闭包指过来）
  const uploadFileRef = useRef<(file: File) => Promise<void>>(async () => {})
  useImperativeHandle(props.ref, () => ({
    injectSource: (path: string) => {
      setSource(path)
      if (props.variant === "inline") setInnerExpanded(true)
    },
    uploadFile: (file: File) => uploadFileRef.current(file),
    prefill: (p: LauncherSubmitPayload) => {
      setSource(p.source)
      setSpeaker(p.speaker || "我")
      setRouting(p.routing)
      setRoutingTouched(true)  // 重跑场景 routing 已是用户意图，不再让 source-suggest 覆盖
      speakerTouchedRef.current = true
      setPauseOnOutline(p.pause_on_outline)
      setMaxRetries(p.max_retries ?? 1)
      setForce(p.force ?? false)
      setRewriteStrategy(p.rewrite_strategy ?? "single")
      setProfileId(p.profile_id ?? "")
      setTranscribeEngine(p.transcribe_engine ?? "default")
      setTrueQuick(p.mode === "quick")
      if (props.variant === "inline") setInnerExpanded(true)
    },
    open: () => {
      if (props.variant === "inline") setInnerExpanded(true)
    },
    collapse: () => {
      if (props.variant === "inline") setInnerExpanded(false)
    },
  }), [props.variant])

  // 源变化 → 路由自动建议（用户没手动改过才覆盖）
  useEffect(() => {
    if (!source) { setRoutingAutoSuggested(false); return }
    if (routingTouched) return
    const sug = suggestRouting(source)
    if (sug) {
      setRouting(sug)
      setRoutingAutoSuggested(true)
    } else {
      setRoutingAutoSuggested(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // 源变化 → 启发式识别演讲人（不打扰，只填 detectedSpeaker；不一致时 chip 出 dot）
  useEffect(() => {
    if (!source.trim() || props.healthOffline) {
      setDetectedSpeaker(null)
      return
    }
    let cancelled = false
    fetch(apiBase + "/api/detect-speaker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, use_llm: false }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { speaker: string | null } | null) => {
        if (cancelled || !d) return
        if (d.speaker) {
          setDetectedSpeaker(d.speaker)
          // 用户没手动改 + 当前值还是默认"我" → 直接采纳（不弹 banner，chip 即更新）
          if (!speakerTouchedRef.current && speaker.trim() === "我") {
            setSpeaker(d.speaker)
          }
        }
      })
      .catch(() => { /* 静默：识别不上不阻塞主流程 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, props.healthOffline])

  // AI 识别按钮（chip popover 里）
  const detectSpeakerAI = async () => {
    if (!source.trim() || props.healthOffline) return
    setDetectingSpeaker(true)
    try {
      const r = await fetch(apiBase + "/api/detect-speaker", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, profile_id: profileId || undefined, use_llm: true }),
      })
      const d: { speaker: string | null } = await r.json()
      if (d.speaker) {
        setDetectedSpeaker(d.speaker)
        setSpeaker(d.speaker)
        speakerTouchedRef.current = false
      }
    } catch { /* 静默 */ }
    finally { setDetectingSpeaker(false) }
  }

  const handleSpeakerChange = (v: string) => {
    speakerTouchedRef.current = true
    setSpeaker(v)
  }
  const handleRoutingChange = (v: string) => {
    setRoutingTouched(true)
    setRouting(v)
  }

  // 上传：跟旧 CreateForm 同款，落 input/Video|Text 由后端按扩展名定
  const uploadFile = async (file: File) => {
    setUploading(true); setUploadErr(null)
    try {
      const res = await fetch(apiBase + `/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST", body: file,
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { const j = await res.json(); if (typeof j?.detail === "string") detail = j.detail } catch { /* */ }
        throw new Error(detail)
      }
      const data: { path: string } = await res.json()
      setSource(data.path)
      if (props.variant === "inline") setInnerExpanded(true)
    } catch (e) {
      setUploadErr(`上传失败：${e instanceof Error ? e.message : String(e)}`)
    } finally { setUploading(false) }
  }
  // 暴露给 ref.uploadFile 用（避免 stale closure）
  uploadFileRef.current = uploadFile

  // 命令式输入：源 picker 之外允许直接打字 → Enter 触发解析
  const [cmdLine, setCmdLine] = useState("")
  const tryCommand = () => {
    const parsed = parseLauncherCommand(cmdLine, props.profileOptions)
    if (!parsed) return false
    if (parsed.source) setSource(parsed.source)
    if (parsed.routing) { setRouting(parsed.routing); setRoutingTouched(true) }
    if (parsed.profile_id) setProfileId(parsed.profile_id)
    if (parsed.force !== undefined) setForce(parsed.force)
    if (parsed.rewrite_strategy) setRewriteStrategy(parsed.rewrite_strategy)
    if (parsed.transcribe_engine) setTranscribeEngine(parsed.transcribe_engine)
    if (parsed.mode === "quick") setTrueQuick(true)
    if (parsed.max_retries !== undefined) setMaxRetries(parsed.max_retries)
    setCmdLine("")
    if (props.variant === "inline") setInnerExpanded(true)
    return true
  }

  // 提交
  const submit = async () => {
    if (!source.trim() || submitting || props.healthOffline) return
    setSubmitting(true)
    try {
      const payload: LauncherSubmitPayload = {
        source: source.trim(),
        speaker: speaker.trim() || "我",
        routing,
        pause_on_outline: pauseOnOutline,
      }
      if (maxRetries !== 1) payload.max_retries = maxRetries
      if (force) payload.force = true
      if (rewriteStrategy !== "single") payload.rewrite_strategy = rewriteStrategy
      if (profileId) payload.profile_id = profileId
      if (transcribeEngine !== "default") payload.transcribe_engine = transcribeEngine
      if (trueQuick) payload.mode = "quick"
      const ok = await props.onSubmit(payload)
      if (ok) {
        pushRecentSource(source)
        localStorage.setItem(DEFAULT_SPEAKER_STORE_KEY, speaker.trim() || "我")
        resetFields()
        if (props.variant === "inline") setInnerExpanded(false)
        else props.onClose?.()
      }
    } finally { setSubmitting(false) }
  }

  // ⌘↵ 提交 + Esc 折叠 inline（overlay 的 Esc 由外层 div onKeyDown 处理）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault(); submit(); return
    }
    if (e.key === "Escape" && props.variant === "inline") {
      e.preventDefault()
      setInnerExpanded(false)
      // 字段保留 —— 用户重展开还能看到上次填的；只清"识别失败"等瞬态视觉
      setUploadErr(null)
    }
  }

  const kind = sourceKind(source)
  const defaultProfile = useMemo(
    () => props.profileOptions.find(p => p.id === (profileId || props.defaultProfileId)),
    [profileId, props.defaultProfileId, props.profileOptions],
  )
  const hasMultiProfile = props.profileOptions.filter(p => p.enabled).length > 1

  // ── 主体：源行 + chip 行 + 操作 ──
  // 拖拽：overlay 模式自己接（浮层之外没有父级能接管）；inline 模式由父级（HomeView）整页接管并调 ref.uploadFile。
  const isOverlay = props.variant === "overlay"
  const dragHandlers = isOverlay ? {
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); dragDepth.current += 1; setDragOver(true) },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragOver(false) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); dragDepth.current = 0; setDragOver(false)
      const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f)
    },
  } : {}
  const Body = (
    <div
      className="flex flex-col gap-2.5"
      onKeyDown={handleKeyDown}
      {...dragHandlers}
    >
      {/* 源选择行 —— 没源时用 SourcePicker，已选用 chip + 命令式输入入口 */}
      {!source ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SourcePicker
              value={source}
              onChange={(v) => { setSource(v); if (props.variant === "inline") setInnerExpanded(true) }}
              apiBase={apiBase}
              transcriptionAvailable={props.transcriptionAvailable}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 min-w-0 rounded-md border bg-card px-3 py-2">
            {kind === "video" ? <Film className="size-4 shrink-0 text-foreground/70" />
              : kind === "transcript" ? <FileAudio className="size-4 shrink-0 text-foreground/70" />
              : <FileText className="size-4 shrink-0 text-foreground/70" />}
            <span className="truncate text-sm">{source.split("/").pop()}</span>
            <Badge variant="secondary" className="shrink-0 text-caption-sm font-normal">
              {kind === "video" ? "视频" : kind === "transcript" ? "转录稿" : kind === "text" ? "文字稿" : "文件"}
            </Badge>
            <button
              type="button"
              onClick={() => { setSource(""); setRoutingTouched(false) }}
              className="ml-auto shrink-0 text-foreground/50 hover:text-foreground transition-colors"
              aria-label="清除已选源"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* 视频源 + 转录可用时的提示 */}
      {source && kind === "video" && (
        props.transcriptionAvailable ? (
          <span className="text-xs text-muted-foreground">提交后先自动转录，再改写</span>
        ) : (
          <span className="text-xs text-destructive">打包版未内置转录引擎 · 请改用文字稿 / 字幕</span>
        )
      )}
      {uploadErr && <span className="text-xs text-destructive">{uploadErr}</span>}
      {uploading && (
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="animate-spin size-3.5" /> 上传中…
        </span>
      )}

      {/* 命令式输入条 —— 只在没源时露 */}
      {!source && (
        <div className="flex items-center gap-2">
          <TextInput
            type="text"
            value={cmdLine}
            onChange={e => setCmdLine(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (!tryCommand()) {
                  // 解析失败 —— 当裸路径处理（仍然走后端校验）
                  const t = cmdLine.trim()
                  if (t) { setSource(t); setCmdLine("") }
                }
              }
            }}
            placeholder="或粘路径 / 命令：dialogue work/2025-06/raw.txt"
            className="flex-1 font-mono"
          />
        </div>
      )}

      {/* chip 行 */}
      <div className="flex flex-wrap items-center gap-2">
        <LauncherChip
          routing={routing}
          onRoutingChange={handleRoutingChange}
          speaker={speaker}
          onSpeakerChange={handleSpeakerChange}
          detectedSpeaker={detectedSpeaker}
          routingAutoSuggested={routingAutoSuggested}
          onDetectSpeakerAI={detectSpeakerAI}
          detectingSpeaker={detectingSpeaker}
        />
        <PauseToggle value={pauseOnOutline} onChange={setPauseOnOutline} />
        {/* 多档时 profile 变 chip；单档/默认档时只是信息 badge */}
        {hasMultiProfile ? (
          <ProfilePicker
            profileOptions={props.profileOptions}
            profileId={profileId}
            defaultProfileId={props.defaultProfileId}
            onChange={setProfileId}
          />
        ) : defaultProfile ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="font-mono text-caption-sm cursor-default">
                {defaultProfile.name}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>默认配置档 · 在 Settings 切换</TooltipContent>
          </Tooltip>
        ) : null}
        <AdvancedPopover
          maxRetries={maxRetries} setMaxRetries={setMaxRetries}
          force={force} setForce={setForce}
          rewriteStrategy={rewriteStrategy} setRewriteStrategy={setRewriteStrategy}
          trueQuick={trueQuick} setTrueQuick={setTrueQuick}
          transcribeEngine={transcribeEngine} setTranscribeEngine={setTranscribeEngine}
          showTranscribe={kind === "video" && props.transcriptionAvailable}
          pauseOnOutline={pauseOnOutline}
        />
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="上传文件作为源"
        >
          <Upload data-icon="inline-start" /> 上传
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={!source.trim() || submitting || props.healthOffline}
          title={props.healthOffline ? "后端离线" : "提交 (⌘↵)"}
        >
          {submitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          开始
          <kbd className="ml-2 hidden sm:inline px-1 rounded text-caption-sm font-mono opacity-70">⌘↵</kbd>
        </Button>
      </div>

      {/* 0 个 profile 时的友好兜底 */}
      {props.profileOptions.length === 0 && (
        <div className="text-xs text-muted-foreground">
          还没有配置档。<button type="button" onClick={props.onOpenSettings} className="text-primary hover:underline">去 Settings 添加</button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept={props.transcriptionAvailable
          ? ".mp4,.mov,.mkv,.m4v,.webm,.flv,.avi,.txt,.md,.srt,.vtt,video/*"
          : ".txt,.md,.srt,.vtt"}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = "" }}
      />

      {dragOver && (
        <div className="absolute inset-0 z-20 rounded-xl border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <Upload className="size-5" /> 松手上传，作为本次改写的源
          </div>
        </div>
      )}
    </div>
  )

  // ── inline 容器：折叠态是 composer，展开态是 Body ──
  if (props.variant === "inline") {
    if (!expanded) {
      return (
        <button
          type="button"
          onClick={() => setInnerExpanded(true)}
          disabled={props.healthOffline}
          className={cn(
            "group w-full rounded-xl border bg-card hover:border-primary/40 transition-colors p-4 flex items-center gap-3 text-left",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <div className="size-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/15 transition-colors">
            <Plus className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground">开始一篇改写…</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              选源 / 拖入文件 / 粘贴路径 · AI 自动配好其它
            </div>
          </div>
          {defaultProfile && (
            <Badge variant="outline" className="font-mono text-caption-sm shrink-0 hidden sm:inline">
              {defaultProfile.name}
            </Badge>
          )}
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-caption-sm font-mono text-muted-foreground hidden sm:inline">
            ⌘N
          </kbd>
        </button>
      )
    }
    return (
      <div className="relative rounded-xl border bg-card/80 p-3.5">
        {Body}
      </div>
    )
  }

  // ── overlay 容器：玻璃浮层，居中略上 ──
  if (!expanded) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-foreground/15 backdrop-blur-md animate-in fade-in duration-150"
      onClick={() => props.onClose?.()}
      onKeyDown={e => { if (e.key === "Escape") props.onClose?.() }}
    >
      <div
        className="relative w-full max-w-[640px] mx-4 rounded-xl border bg-popover/95 ring-1 ring-foreground/10 shadow-2xl p-4"
        onClick={e => e.stopPropagation()}
      >
        {Body}
      </div>
    </div>
  )
}

// ─── 子组件：⏸ 大纲后审批 toggle ────────────────────────────────────────
function PauseToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm transition-colors",
        value
          ? "bg-foreground/[0.08] border-foreground/15 text-foreground"
          : "text-foreground/70 hover:bg-foreground/[0.05]",
      )}
      title={value ? "大纲生成后会暂停，等你审批" : "不暂停，一气呵成跑完"}
    >
      <span className={cn("text-base leading-none", value ? "opacity-100" : "opacity-40")}>⏸</span>
      <span>{value ? "大纲后审批" : "一气呵成"}</span>
    </button>
  )
}

// ─── 子组件：profile chip（仅多档时） ───────────────────────────────────
function ProfilePicker({ profileOptions, profileId, defaultProfileId, onChange }: {
  profileOptions: LlmProfile[]
  profileId: string
  defaultProfileId: string | null
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = profileOptions.find(p => p.id === (profileId || defaultProfileId))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm transition-colors",
            "text-foreground/85 hover:bg-foreground/[0.05]",
            open && "bg-foreground/[0.08] border-foreground/15",
          )}
        >
          <span className="font-mono text-caption-sm">{current?.name ?? "默认档"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="text-xs font-medium text-muted-foreground px-1 pb-1">配置档</div>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false) }}
            className={cn(
              "text-left px-2 py-1.5 rounded-md text-sm transition-colors",
              !profileId ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]",
            )}
          >
            跟随默认{(() => {
              const d = profileOptions.find(p => p.id === defaultProfileId)
              return d ? `（${d.name}）` : ""
            })()}
          </button>
          {profileOptions.filter(p => p.enabled).map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false) }}
              className={cn(
                "text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2",
                profileId === p.id ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]",
              )}
            >
              <span className="flex-1 truncate">{p.name}</span>
              {!p.has_key && <span className="text-caption-sm text-warning">未配 Key</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── 子组件：⋯ 高级 popover ─────────────────────────────────────────────
function AdvancedPopover(props: {
  maxRetries: number; setMaxRetries: (v: number) => void
  force: boolean; setForce: (v: boolean) => void
  rewriteStrategy: "single" | "sectioned"; setRewriteStrategy: (v: "single" | "sectioned") => void
  trueQuick: boolean; setTrueQuick: (v: boolean) => void
  transcribeEngine: "default" | "whisper-cpp" | "mlx"; setTranscribeEngine: (v: "default" | "whisper-cpp" | "mlx") => void
  showTranscribe: boolean
  pauseOnOutline: boolean
}) {
  const [open, setOpen] = useState(false)
  const dirty = props.maxRetries !== 1 || props.force || props.rewriteStrategy !== "single"
    || props.trueQuick || props.transcribeEngine !== "default"
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="高级选项"
          className={cn(
            "inline-flex items-center justify-center size-7 rounded-full border transition-colors",
            "text-foreground/70 hover:bg-foreground/[0.05]",
            (open || dirty) && "bg-foreground/[0.08] border-foreground/15 text-foreground",
          )}
          title="高级选项"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">自修正最大重试</div>
            <TextInput
              type="number" min={0} max={3} value={props.maxRetries}
              onChange={e => props.setMaxRetries(parseInt(e.target.value) || 0)}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox label="强制重跑（忽略缓存）" checked={props.force} onChange={props.setForce} />
            <Checkbox
              label="长稿按节滚动改写（§9-C）"
              checked={props.rewriteStrategy === "sectioned"}
              onChange={v => props.setRewriteStrategy(v ? "sectioned" : "single")}
              hint="按 outline 拆节调用 LLM，长稿避免撞窗"
            />
            <Checkbox
              label="跳过中间步骤（纯 quick 模式）"
              checked={props.trueQuick}
              onChange={props.setTrueQuick}
              hint="不做清洗 / 提炼 / 骨架，直接重写 + 质检"
            />
          </div>
          {props.showTranscribe && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">转录引擎</div>
              <div className="flex gap-1">
                {(["default", "whisper-cpp", "mlx"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => props.setTranscribeEngine(opt)}
                    className={cn(
                      "flex-1 px-2 py-1 rounded-md border text-xs transition-colors",
                      props.transcribeEngine === opt
                        ? "bg-foreground/[0.08] border-foreground/15 text-foreground"
                        : "text-foreground/70 hover:bg-foreground/[0.05]",
                    )}
                  >
                    {opt === "default" ? "默认" : opt === "mlx" ? "mlx · Apple" : "whisper.cpp"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

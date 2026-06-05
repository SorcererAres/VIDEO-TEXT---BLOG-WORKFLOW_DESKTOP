import { useState, useEffect, useMemo, useRef } from 'react'
import { useTheme } from 'next-themes'
import { emit } from '@tauri-apps/api/event'
import {
  ArrowLeft,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  KeyRound,
  Trash2,
  Star,
  ChevronDown,
  GripVertical,
  Download,
  HardDrive,
  Palette,
  Info,
  ChevronsUpDown,
  FileText,
  MoreHorizontal,
  Copy,
  Eye,
  Code as CodeIcon,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { ConfirmDialogHost, confirmAction } from '@/components/ConfirmDialog'
import { confirmHistoricalDelete, HistoricalDeleteDialogHost } from '@/components/HistoricalDeleteDialog'
import { purgePostChain } from '@/lib/job-actions'
import { Segmented, FormField, TextInput, FilterChip } from '@/components/form-primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { API_BASE, apiUrl } from '@/lib/api'
import { uploadExample, deleteExample } from '@/lib/examples-actions'
import {
  PROVIDER_PRESETS,
  inferProviderId,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  deleteProfileKey,
  readLegacyKey,
  clearLegacyKey,
  listKnowledgeFiles,
  readKnowledgeFile,
  saveKnowledgeFile,
  type ProviderId,
  type LlmProfile,
  type ProfilesSnapshot,
  type LlmProfilePatch,
  type TestLLMResult,
  type KnowledgeGroup,
  type KnowledgeItem,
} from '@/lib/settings-store'

// ═══════════════════ Settings：LLM 配置档管理器（master-detail）═══════════════════
const THINKING_LABEL: Record<string, string> = { default: "默认设置", on: "开启", off: "关闭" }
const MAX_TOKENS_OPTIONS = [512, 1024, 2048, 4096, 8192]

// 小开关（无 shadcn Switch，自己拼一个 role=switch 的按钮）
function MiniSwitch({ checked, onChange, title }: { checked: boolean; onChange: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  )
}

// ── 本地转录模型管理（设置 → 本地模型）──────────────────────────
interface LocalModel {
  name: string
  label: string
  size_mb: number
  downloaded: boolean
  local_mb: number
  is_default: boolean
  status?: string | null
  percent?: number | null
  error?: string | null
}

type Engine = "whisper-cpp" | "mlx"

function ModelRow({ m, onDownload, onRemove }: {
  m: LocalModel
  onDownload: () => void
  onRemove: () => void
}) {
  const downloading = m.status === "downloading"
  return (
    <div className="flex items-center gap-3 border rounded-lg p-3">
      <HardDrive className={cn("size-4 shrink-0", m.downloaded ? "text-primary" : "text-muted-foreground/40")} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-2">
          {m.label}
          {m.is_default && <Badge variant="secondary" className="text-caption-sm">默认</Badge>}
        </div>
        <div className="text-caption-sm text-muted-foreground">
          {downloading ? `下载中${m.percent != null ? ` ${m.percent}%` : "…"}`
            : m.status === "error" ? <span className="text-destructive">下载失败：{m.error}</span>
            : m.downloaded ? `已下载 · ${m.local_mb} MB`
            : `约 ${m.size_mb} MB`}
        </div>
      </div>
      {downloading ? (
        <div className="w-28 shrink-0">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${m.percent ?? 5}%` }} />
          </div>
        </div>
      ) : m.downloaded ? (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive shrink-0" onClick={onRemove}>
          <Trash2 data-icon="inline-start" /> 删除
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onDownload}>
          <Download data-icon="inline-start" /> 下载
        </Button>
      )}
    </div>
  )
}

function LocalModelsPanel() {
  const [data, setData] = useState<{ whisper_cpp: LocalModel[]; mlx: LocalModel[] }>({ whisper_cpp: [], mlx: [] })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const r = await fetch(apiUrl("/api/local-models"))
      if (r.ok) {
        const d = await r.json()
        setData({ whisper_cpp: d.whisper_cpp || [], mlx: d.mlx || [] })
      }
    } catch { /* 离线时静默 */ }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 1500)  // 轮询下载进度
    return () => clearInterval(t)
  }, [])

  const download = async (name: string, engine: Engine) => {
    try {
      await fetch(apiUrl("/api/local-models/download"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, engine }),
      })
      load()
    } catch (e) { toast.error("启动下载失败", { description: String(e) }) }
  }

  const remove = async (m: LocalModel, engine: Engine) => {
    const ok = await confirmAction({
      title: `删除 ${m.label}？`,
      description: `将删除本地模型（${m.local_mb} MB）。需要时可重新下载。`,
      confirmText: "删除", variant: "destructive",
    })
    if (!ok) return
    try {
      await fetch(apiUrl("/api/local-models/delete"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: m.name, engine }),
      })
      load()
    } catch (e) { toast.error("删除失败", { description: String(e) }) }
  }

  const empty = data.whisper_cpp.length === 0 && data.mlx.length === 0
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 flex flex-col gap-6">
        {loading && empty ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            <Loader2 className="size-4 animate-spin inline mr-1.5" />加载…
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-2.5">
              <div>
                <h3 className="text-sm font-semibold">whisper.cpp</h3>
                <p className="text-caption-sm text-muted-foreground mt-0.5">
                  默认引擎 · Metal 加速 · 模型单文件。首次转录会自动下载默认档。
                </p>
              </div>
              {data.whisper_cpp.map(m => (
                <ModelRow key={m.name} m={m}
                  onDownload={() => download(m.name, "whisper-cpp")}
                  onRemove={() => remove(m, "whisper-cpp")} />
              ))}
            </section>
            <section className="flex flex-col gap-2.5">
              <div>
                <h3 className="text-sm font-semibold">mlx · Apple 原生</h3>
                <p className="text-caption-sm text-muted-foreground mt-0.5">
                  Apple Silicon 原生，质量略优。模型从 HuggingFace 下载到系统缓存。
                </p>
              </div>
              {data.mlx.map(m => (
                <ModelRow key={m.name} m={m}
                  onDownload={() => download(m.name, "mlx")}
                  onRemove={() => remove(m, "mlx")} />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// 设置 = 模型/Key 配置 + 本地转录模型管理。写作知识库已归位到「风格」场所（IA ⑤）。
type SettingsTab = "llm" | "models" | "appearance" | "maintenance" | "about"

const SETTINGS_NAV: Array<{ key: SettingsTab; label: string; icon: LucideIcon }> = [
  { key: "llm", label: "模型与 API", icon: KeyRound },
  { key: "models", label: "本地转录模型", icon: HardDrive },
  { key: "appearance", label: "外观", icon: Palette },
  { key: "maintenance", label: "维护", icon: Wrench },
  { key: "about", label: "关于", icon: Info },
]

export function SettingsPanel({ onProfilesChanged, chrome }: { onProfilesChanged?: () => void; chrome?: boolean }) {
  const [tab, setTab] = useState<SettingsTab>("llm")
  return (
    <div className="flex-1 flex min-h-0">
      {/* 左竖 nav（参考 Claude Desktop）：顶部「设置」标题 + 中性灰底 active（不抢色，
          对齐 STYLE 表2 选中态）；icon 选中态也中性，珊瑚/黑只留给真正的 CTA。
          chrome=独立 overlay 设置窗：nav 顶部留一行容纳浮入的交通灯并可拖拽窗口。 */}
      <nav className="w-[210px] shrink-0 border-r bg-muted/30 flex flex-col gap-0.5 p-3 overflow-y-auto">
        {chrome && <div className="h-7 -mx-3 -mt-3 shrink-0" data-tauri-drag-region />}
        <div className="px-2.5 pt-1 pb-3 text-heading-sm font-semibold font-heading">设置</div>
        {SETTINGS_NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-caption-sm text-left transition-colors",
                active
                  ? "bg-foreground/[0.08] text-foreground font-medium"
                  : "text-foreground/80 hover:bg-foreground/[0.05]",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
              {label}
            </button>
          )
        })}
      </nav>
      {/* 右内容区 —— 子面板各自管自己的滚动/内边距 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "llm" && <SettingsForm onProfilesChanged={onProfilesChanged} embedded />}
        {tab === "models" && <LocalModelsPanel />}
        {tab === "appearance" && <AppearanceSection />}
        {tab === "maintenance" && <MaintenanceSection />}
        {tab === "about" && <AboutSection />}
      </div>
    </div>
  )
}

// 维护区（DECOUPLE Round 3 收尾）：作品「整链清除」的显式高危入口。
// 日常删作品走回收站（30 天可恢复）；这里是连 work/ 评分 / 索引 / 指纹一并清的彻底清除，
// 复用 HistoricalDeleteDialog 的 5 选面板 + lib/job-actions.purgePostChain（POST /api/maintenance/purge）。
interface MaintPost {
  final_post_path: string | null
  stem: string
  is_draft?: boolean
}

function MaintenanceSection() {
  const [posts, setPosts] = useState<MaintPost[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await fetch(API_BASE + "/api/posts")
      if (res.ok) setPosts(await res.json())
    } catch (e) {
      console.error("加载作品列表失败", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const handlePurge = async (p: MaintPost) => {
    if (!p.final_post_path) {
      toast.error("无法清除", { description: "该作品缺少 final_post_path" })
      return
    }
    // 复用归档 5 选面板让用户挑要清的产物类别
    const sel = await confirmHistoricalDelete({ stem: p.stem, postPath: p.final_post_path })
    if (!sel) return
    try {
      const result = await purgePostChain({ post_path: p.final_post_path, ...sel })
      const msg = result.deleted.length ? `已清除 ${result.deleted.length} 项` : "无内容被清除"
      const errs = result.errors.length ? ` · ${result.errors.length} 项失败` : ""
      toast.success("彻底清除完成", { description: msg + errs })
      void reload()
    } catch (e) {
      toast.error("清除失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <ScrollArea className="flex-1">
      {/* 命令式 5 选面板的挂载点 —— 仅维护 tab 激活时存在 */}
      <HistoricalDeleteDialogHost />
      <div className="p-6 max-w-2xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">维护</h2>
          <p className="mt-1 text-caption-sm text-muted-foreground">
            作品的「整链清除」—— 连同评分 / 中间产物 / 索引 / 指纹一并删除。
          </p>
        </div>

        <Alert>
          <AlertTitle>先想清楚再动手</AlertTitle>
          <AlertDescription>
            日常删作品请用作品集卡片的删除（移 30 天回收站，可还原）。这里是维护用的彻底清除：
            post 之外的 work/ 评分 / 索引 / 指纹删了 <b>不可恢复</b>。
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="py-8 text-center text-caption-sm text-muted-foreground">加载中…</div>
        ) : posts.length === 0 ? (
          <div className="py-8 text-center text-caption-sm text-muted-foreground">没有可清除的作品。</div>
        ) : (
          <div className="flex flex-col gap-1">
            {posts.map((p) => (
              <div
                key={p.final_post_path ?? p.stem}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-caption-sm font-medium">{p.stem}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {p.final_post_path}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive hover:bg-destructive/10"
                  onClick={() => void handlePurge(p)}
                >
                  <Trash2 className="size-3.5" />
                  彻底清除
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// 写作知识库编辑器（方案 B）：左分组文件列表 + 右 Markdown 编辑/预览/分屏 + 保存即校验
// STYLE_GUIDE 是纯编号列表，可无损 parse/serialize 成表单（方案 A 首块）
const STYLE_GUIDE_PATH = "knowledge/STYLE_GUIDE.md"
function parseStyleGuide(md: string): { preamble: string; rules: string[] } {
  const lines = md.split("\n")
  const firstRule = lines.findIndex(l => /^\s*\d+\.\s+/.test(l))
  if (firstRule === -1) return { preamble: md.replace(/\s+$/, ""), rules: [] }
  const preamble = lines.slice(0, firstRule).join("\n").replace(/\s+$/, "")
  const rules: string[] = []
  for (const l of lines.slice(firstRule)) {
    const m = l.match(/^\s*\d+\.\s+(.*)$/)
    if (m) rules.push(m[1].trim())
  }
  return { preamble, rules }
}
function serializeStyleGuide(preamble: string, rules: string[]): string {
  const body = rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
  return (preamble ? preamble + "\n\n" : "") + body + "\n"
}

function StyleGuideForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { preamble, rules } = useMemo(() => parseStyleGuide(value), [value])
  const update = (next: string[]) => onChange(serializeStyleGuide(preamble, next))
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    const a = [...rules]; const [m] = a.splice(from, 1); a.splice(to, 0, m); update(a)
  }
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-1 py-4 flex flex-col gap-2">
        <p className="text-sm text-muted-foreground mb-1">风格硬规则（优先级高于范文）。逐条编辑 · 增删 · 拖手柄排序；保存即写回 STYLE_GUIDE.md。</p>
        {rules.map((r, i) => (
          // 增项列表行（同禁用套话样式）：拖拽手柄 + 编号 + 编辑框 + hover 删除；拖手柄实时重排，编号随之刷新。
          <div
            key={i}
            onDragEnter={() => { if (dragIdx !== null && dragIdx !== i) { move(dragIdx, i); setDragIdx(i) } }}
            onDragOver={e => e.preventDefault()}
            className={cn("group flex items-center gap-2 rounded-lg border px-3 h-11", dragIdx === i && "opacity-50")}
          >
            <button
              type="button"
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => setDragIdx(null)}
              title="拖拽排序"
              aria-label="拖拽排序"
              className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <GripVertical className="size-4" />
            </button>
            <span className="shrink-0 w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <input
              value={r}
              onChange={e => { const n = [...rules]; n[i] = e.target.value; update(n) }}
              placeholder="一条风格规则"
              autoFocus={r === ""}
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => update(rules.filter((_, j) => j !== i))}
              title="删除"
              aria-label="删除"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={() => update([...rules, ""])}><Plus data-icon="inline-start" /> 添加规则</Button>
      </div>
    </ScrollArea>
  )
}

const PREFERENCES_PATH = "memory/PREFERENCES.md"
// PREFERENCES 是 prose-under-headings，不是干净 schema。只把最"列表化、高影响"的
// 「禁用套话」小节做成表单；用定向 splice 仅替换该小节的 bullet，其余字节不动；
// 找不到该小节就回退（不破坏文件）。其余偏好走源码模式编辑。
const BANNED_SECTION_RE = /(^##[^\n]*禁用套话[^\n]*\n)([\s\S]*?)(?=^##\s|$(?![\s\S]))/m
function parseBanned(md: string): string[] | null {
  const m = md.match(BANNED_SECTION_RE)
  if (!m) return null
  return m[2].split("\n").map(l => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x)
}
// 列表用：每个 `- ` 行 = 一条（保留空行，新增/清空不丢行）—— 源码一行 ↔ 列表一条。
function bannedItems(md: string): string[] | null {
  const m = md.match(BANNED_SECTION_RE)
  if (!m) return null
  return m[2].split("\n").filter(l => /^\s*[-*]\s/.test(l)).map(l => l.replace(/^\s*[-*]\s/, "").trim())
}
// 回写：一条一行 `- xxx`（引擎只当 prose 读，格式自由）。
function spliceBanned(md: string, items: string[]): string {
  const body = "\n" + items.map(b => `- ${b}`).join("\n") + "\n\n"
  return md.replace(BANNED_SECTION_RE, (_m, heading) => heading + body)
}

// 语言/人称/长度/版式 各取该小节的「**加粗关键值**」做字段。定向 splice 只替换那段加粗值，
// 周围 prose 与全文其余字节不动；找不到的字段不渲染（结构改动走源码模式）。
// 每个字段给一组常用档位做 select 选项；用户现有值若不在档位里，会在渲染时并入，
// 保证不丢任意自定义值（onChange 仍走 setPrefField 写任意字符串）。
const PREF_FIELDS: { key: string; label: string; options: string[] }[] = [
  { key: "正文语言", label: "正文语言", options: ["简体中文", "繁体中文", "English"] },
  { key: "叙述人称", label: "叙述人称（文章里的「我」）", options: ["演讲人第一人称「我」", "作者第一人称「我」", "第三人称转述"] },
  { key: "目标字数", label: "目标字数", options: ["800–1500 字", "1500–3000 字", "3000–5000 字", "不限"] },
  { key: "输出格式", label: "输出格式", options: ["Obsidian Markdown", "通用 Markdown", "纯文本"] },
]
const prefFieldRE = (k: string) => new RegExp(`(${k}[：:]\\s*\\*\\*)([^*]+?)(\\*\\*)`)
function getPrefField(md: string, key: string): string | null {
  const m = md.match(prefFieldRE(key))
  return m ? m[2].trim() : null
}
function setPrefField(md: string, key: string, val: string): string {
  return md.replace(prefFieldRE(key), (_m, a, _b, c) => a + val + c)
}

// 一行：label 左 + select 右（套 STYLE appearance-none + ChevronsUpDown 范式）。
// 现有值不在档位里时并入选项，确保不丢自定义值。
function PrefSelectRow({ label, value, options, onChange }: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const opts = options.includes(value) ? options : [value, ...options]
  return (
    // 对齐设计稿 Figma 428:1015：label 左（14px 中性）+ 控件右（固定 280、h-40、圆角 8、单 ChevronDown）
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="relative w-[280px] shrink-0">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-card border rounded-lg h-10 pl-3 pr-9 text-sm text-foreground focus:border-primary outline-none transition-colors"
        >
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 shrink-0 opacity-50" />
      </div>
    </div>
  )
}

// 禁用套话 = 增项列表：源码每个 `- ` 行 ↔ 列表一条（可编辑 + hover 删除），顶部「添加」追加新行。
function BannedList({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = useMemo(() => bannedItems(value), [value])
  if (items === null) return null
  const commit = (next: string[]) => onChange(spliceBanned(value, next))
  return (
    <div className="flex flex-col gap-3 border-t pt-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold">禁用套话</div>
          <div className="text-sm text-muted-foreground mt-0.5">改写时须删除的口播套话 / 求互动话术 · 一行一条</div>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => commit([...items, ""])}>
          <Plus data-icon="inline-start" /> 添加
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 italic">（暂无，点「添加」新增一条）</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="group flex items-center gap-2 rounded-lg border px-3 h-11">
              <input
                value={it}
                onChange={e => { const n = [...items]; n[i] = e.target.value.replace(/\n/g, " "); commit(n) }}
                placeholder="一条要删除的套话，如 大家好"
                autoFocus={it === ""}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => commit(items.filter((_, j) => j !== i))}
                title="删除"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PreferencesForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bullets = useMemo(() => parseBanned(value), [value])
  const fields = PREF_FIELDS
    .map(f => ({ ...f, val: getPrefField(value, f.key) }))
    .filter((f): f is { key: string; label: string; options: string[]; val: string } => f.val !== null)

  if (fields.length === 0 && bullets === null) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-sm text-muted-foreground">
        没识别到可表单化的字段（语言 / 人称 / 长度 / 版式 / 禁用套话）。请切「源码」模式编辑。
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-1 py-4 flex flex-col gap-7">
        {/* B2 · 核心偏好：规整的 label 左 + select 右行（无分隔线，靠行内 padding 留间距） */}
        {fields.length > 0 && (
          <div className="flex flex-col">
            {fields.map(f => (
              <PrefSelectRow
                key={f.key}
                label={f.label}
                value={f.val}
                options={f.options}
                onChange={v => onChange(setPrefField(value, f.key, v))}
              />
            ))}
          </div>
        )}

        {/* B3 · 禁用套话 → 增项列表（每条一行，可编辑/删除，顶部添加） */}
        {bullets !== null && <BannedList value={value} onChange={onChange} />}

        <p className="text-caption-sm text-muted-foreground/70">
          更细的偏好（受众 / 语气 / 视角约束 / 版式细节 / 专有名词）请切「源码」模式编辑。
        </p>
      </div>
    </ScrollArea>
  )
}

// ── Figma 导出的精确矢量图标（viewBox 0 0 16 16，stroke 跟随文字色）──────────
// 写作偏好
function IconWritingPref({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M14 11.3333L12.5627 10.088C12.5152 10.043 12.4554 10.0129 12.391 10.0016C12.3265 9.99027 12.2601 9.99818 12.2001 10.0243C12.1401 10.0505 12.0891 10.0938 12.0535 10.1487C12.0179 10.2037 11.9993 10.2679 12 10.3333V10.6667C12 10.8435 11.9298 11.0131 11.8047 11.1381C11.6797 11.2631 11.5101 11.3333 11.3333 11.3333H10C9.82319 11.3333 9.65362 11.2631 9.5286 11.1381C9.40357 11.0131 9.33333 10.8435 9.33333 10.6667C9.33333 8.97001 6.67267 8.02001 3.66667 8.00001C3.22464 8.00001 2.80072 8.17561 2.48816 8.48817C2.17559 8.80073 2 9.22465 2 9.66668C2 10.1087 2.17559 10.5326 2.48816 10.8452C2.80072 11.1577 3.22464 11.3333 3.66667 11.3333C6.43533 11.3333 6.83 3.80334 7.472 2.33334C7.58045 2.08521 7.74773 1.86723 7.95937 1.69828C8.17101 1.52934 8.42062 1.4145 8.68662 1.36372C8.95262 1.31293 9.22698 1.32773 9.48598 1.40683C9.74497 1.48592 9.98079 1.62694 10.173 1.81766C10.3653 2.00839 10.5081 2.24309 10.5893 2.50146C10.6704 2.75982 10.6874 3.03406 10.6387 3.30045C10.59 3.56684 10.4771 3.81735 10.3099 4.03031C10.1426 4.24328 9.92594 4.41227 9.67867 4.52268" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 14H14" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// 风格指南
function IconStyleGuide({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M7.33333 11.3333C7.33333 12.0406 7.05238 12.7189 6.55229 13.219C6.05219 13.719 5.37391 14 4.66667 14C3.95942 14 3.28115 13.719 2.78105 13.219C2.28095 12.7189 2 12.0406 2 11.3333V3.33333C2 2.97971 2.14048 2.64057 2.39052 2.39052C2.64057 2.14048 2.97971 2 3.33333 2H6C6.35362 2 6.69276 2.14048 6.94281 2.39052C7.19286 2.64057 7.33333 2.97971 7.33333 3.33333V11.3333Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11.1333 8.66667H12.6667C13.0203 8.66667 13.3594 8.80714 13.6095 9.05719C13.8595 9.30724 14 9.64638 14 10V12.6667C14 13.0203 13.8595 13.3594 13.6095 13.6095C13.3594 13.8595 13.0203 14 12.6667 14H4.66667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.66667 11.3333H4.67333" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.33333 5.33336L8.86666 3.80003C9.01553 3.65064 9.19247 3.53216 9.38729 3.45139C9.58211 3.37063 9.79098 3.32918 10.0019 3.32943C10.2128 3.32968 10.4216 3.37162 10.6162 3.45284C10.8108 3.53406 10.9875 3.65296 11.136 3.8027L12.4 5.0667C12.5537 5.21457 12.6763 5.39169 12.7606 5.58764C12.8449 5.78359 12.8892 5.99441 12.8908 6.20771C12.8924 6.42101 12.8513 6.63248 12.77 6.82969C12.6887 7.02689 12.5688 7.20585 12.4173 7.35603L6.6 13.2" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// 参考范文
function IconReferences({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M6.66667 10V8" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.33333 10V8" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 10V8" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M1.33333 5.33333V2.66667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14.6667 4H1.33333" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14.6667 5.33333V2.66667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 10V8" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.3333 8H2.66667C1.93029 8 1.33333 8.59695 1.33333 9.33333V12C1.33333 12.7364 1.93029 13.3333 2.66667 13.3333H13.3333C14.0697 13.3333 14.6667 12.7364 14.6667 12V9.33333C14.6667 8.59695 14.0697 8 13.3333 8Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// 步骤提示词（Step 3-8）
function IconStep({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 12C8.36819 12 8.66667 11.7015 8.66667 11.3333C8.66667 10.9651 8.36819 10.6667 8 10.6667C7.63181 10.6667 7.33333 10.9651 7.33333 11.3333C7.33333 11.7015 7.63181 12 8 12Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 4.66667V8.66667H10" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 11.3333C2 9.74203 2.63214 8.21591 3.75736 7.09069C4.88258 5.96547 6.4087 5.33333 8 5.33333C9.47659 5.33484 10.9008 5.88077 12 6.86667L14 8.66667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// 文件项图标：核心文件按 path 精确配，步骤提示词（.cursor/skills/…）统一用流程图标，范文兜底文档图标。
function knowledgeIcon(path: string): React.ComponentType<{ className?: string }> {
  if (path === PREFERENCES_PATH) return IconWritingPref         // 写作偏好
  if (path === STYLE_GUIDE_PATH) return IconStyleGuide          // 风格指南
  if (path.startsWith(".cursor/skills/")) return IconStep       // Step 3-8 提示词
  return FileText                                               // 参考范文 / 运行合同等
}

// 知识库左栏：单个文件项（单行，带 danger 标记 + 类型图标）。
// 平铺用：常用区 flatMap、advanced 折叠区 flatMap 都复用它，去掉组标题（对齐 Figma）。
function NavFileItem({ item, selected, onSelect }: { item: KnowledgeItem; selected: string | null; onSelect: (p: string) => void }) {
  const Icon = knowledgeIcon(item.path)
  const active = item.path === selected
  return (
    <button
      type="button"
      onClick={() => onSelect(item.path)}
      disabled={!item.exists}
      title={item.desc}
      className={cn(
        // 对齐设计稿 Figma 462:152：行高固定 32px（h-8 + items-center → 16px 内容上下各 8px）
        "w-full text-left rounded-md h-8 px-2.5 transition-colors flex items-center gap-2.5",
        // STYLE 表2 唯一选中态（中性玻璃高亮）
        active ? "bg-foreground/[0.08] text-foreground" : "hover:bg-foreground/[0.05]",
        !item.exists && "opacity-40 cursor-not-allowed",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      {/* 设计稿 Figma 462:152 标签 13px（用户指定；STYLE.md 表4 默认禁 13px，此处按用户决策破例） */}
      <span className="min-w-0 flex-1 text-[13px] font-medium truncate flex items-center gap-1">
        {item.danger && <AlertCircle className="size-3 text-warning shrink-0" />}
        {item.label}
      </span>
    </button>
  )
}

// 参考范文：左 nav 收成单入口，点开后在右侧区域内部再分两栏（中=列表 / 右=选中内容）。
// 这个 sentinel 代表外层 selected 处于"范文态"——让左 nav「参考范文」持续高亮。
const REFERENCES_VIEW = "__references__"

// 参考范文组 = 常用组里「既不含写作偏好、也不含风格指南」的那组（纯范文集）。
// 不能用 group 名 includes("范文") —— "风格与范文"组名也含"范文"，会被误判成第二个参考范文。
const isRefGroup = (g: KnowledgeGroup) =>
  !g.advanced && !g.items.some(i => i.path === STYLE_GUIDE_PATH || i.path === PREFERENCES_PATH)

// 极简 YAML frontmatter 解析 —— 范文 meta 行需要 title/date/source 三件套。
// 只解析 `^---\n` 与 `\n---\n` 之间的 `key: value` 行；不引 yaml 库。
function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return {}
  const rest = text.replace(/^---\r?\n/, "")
  const end = rest.search(/\r?\n---\r?\n/)
  if (end < 0) return {}
  const block = rest.slice(0, end)
  const out: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/)
    if (m) {
      // 去成对引号
      const v = m[2].replace(/^["']|["']$/g, "")
      out[m[1]] = v
    }
  }
  return out
}

// 上传范文 Modal —— 点选/拖拽/纯粘贴三通道：
//   - 拖文件进面板：自动读 text + 填 filename（去后缀）
//   - 点选 file picker：同样读 + 填
//   - 纯粘贴正文：手填 filename + 粘贴内容
function UploadExampleDialog({ open, onOpenChange, onUploaded }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onUploaded: () => void
}) {
  const [filename, setFilename] = useState("")
  const [content, setContent] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 每次开 dialog 重置
  useEffect(() => {
    if (open) { setFilename(""); setContent(""); setSubmitting(false) }
  }, [open])

  const readFile = async (f: File) => {
    const text = await f.text()
    setContent(text)
    // 文件名去后缀作 filename 默认值
    if (!filename) {
      const base = f.name.replace(/\.(md|txt|markdown)$/i, "")
      setFilename(base)
    }
  }

  const submit = async () => {
    if (!filename.trim() || !content.trim() || submitting) return
    setSubmitting(true)
    try {
      await uploadExample(filename.trim(), content)
      toast.success("范文已上传", { description: filename.trim() })
      onUploaded()
      onOpenChange(false)
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      const msg = e instanceof Error ? e.message : String(e)
      if (status === 409) toast.error("同名范文已存在", { description: "改个文件名或先删旧的" })
      else if (status === 400) toast.error("非法输入", { description: msg })
      else toast.error("上传失败", { description: msg })
    } finally { setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>上传参考范文</DialogTitle>
          <DialogDescription>
            把一篇你认可的范文落到 <code className="text-xs">knowledge/Examples/</code>，
            后续改写会拿它锚定文风。支持拖入文件 / 点选 / 直接粘贴正文。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FormField label="文件名" hint="自动加 .md 后缀；中英文 / 数字 / - · 空格均可">
            <TextInput
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              placeholder="例如：我的-2025-年-总结"
              className="w-full"
              autoFocus
            />
          </FormField>

          <FormField label="正文 Markdown">
            <div
              className={cn(
                "relative rounded-md border bg-card",
                dragOver && "border-primary bg-primary/5",
              )}
              onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
              onDragOver={e => { e.preventDefault() }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
              onDrop={async e => {
                e.preventDefault(); setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) await readFile(f)
              }}
            >
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="拖文件进这里 / 点下方按钮选 / 或直接粘贴正文…"
                spellCheck={false}
                className="block w-full h-48 bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none resize-none"
              />
              {dragOver && (
                <div className="absolute inset-0 rounded-md flex items-center justify-center pointer-events-none text-primary font-medium gap-2">
                  <Upload className="size-5" /> 松手读入文件
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.markdown"
              hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = "" }}
            />
            <div className="flex items-center gap-2 text-caption-sm text-muted-foreground">
              <button type="button" onClick={() => fileRef.current?.click()} className="text-primary hover:underline">
                选文件…
              </button>
              <span>·</span>
              <span>{content ? `${content.replace(/\s+/g, "").length} 字` : "正文为空"}</span>
            </div>
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!filename.trim() || !content.trim() || submitting}
          >
            {submitting && <Loader2 className="animate-spin" data-icon="inline-start" />}
            上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 范文中栏：标题「参考范文」+「+」上传 + 可点选列表（选中态走 STYLE 中性高亮）。
function ReferenceMasterList({ items, selected, onSelect, onAddClick }: {
  items: KnowledgeItem[]
  selected: string | null
  onSelect: (p: string) => void
  onAddClick: () => void
}) {
  return (
    <div className="w-72 shrink-0 border-r flex flex-col min-h-0">
      <div className="px-4 pt-5 pb-3 shrink-0 flex items-center justify-between gap-2">
        <h2 className="text-heading-sm font-semibold font-heading">参考范文</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onAddClick}
          title="上传范文"
          aria-label="上传范文"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {/* [&_[data-slot=scroll-area-viewport]>div]:!block —— 覆盖 Radix viewport 内 inline
          `display:table` 的 wrapper（会按内容宽度撑开，使长文件名下的 truncate 失效）；
          配 !w-full 让内容回到容器宽度，flex-1 truncate 才能正常出省略号。同 App.tsx 任务列表。 */}
      <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
        <div className="px-2 pb-3 flex flex-col gap-0.5">
          {items.length === 0 && (
            <p className="px-2.5 py-2 text-caption-sm text-muted-foreground">暂无范文。</p>
          )}
          {items.map(it => {
            const active = it.path === selected
            return (
              <button
                key={it.path}
                type="button"
                onClick={() => onSelect(it.path)}
                disabled={!it.exists}
                title={it.desc}
                className={cn(
                  "w-full text-left rounded-md px-2.5 py-1.5 transition-colors flex items-center gap-2.5",
                  active ? "bg-foreground/[0.08] text-foreground" : "hover:bg-foreground/[0.05]",
                  !it.exists && "opacity-40 cursor-not-allowed",
                )}
              >
                <FileText className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 text-xs font-medium truncate">{it.label}</span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

// 范文右栏：标题 + frontmatter meta + 内容卡（边框 + 顶部工具：预览/源码 + 复制）+ ⋯ menu 删除。
// 自管 original/draft/view 生命周期（外层 selected 保持 REFERENCES_VIEW，不污染主编辑状态机）；
// 读/存复用 readKnowledgeFile / saveKnowledgeFile；删除走 deleteExample（PR #7）。
function ReferenceDetail({ item, onDeleted }: { item: KnowledgeItem; onDeleted: () => void }) {
  const [original, setOriginal] = useState("")
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; errors: string[] } | null>(null)
  // 内容卡顶部 toggle：preview = Markdown 渲染；source = 原始 md 文本
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview")
  const [moreOpen, setMoreOpen] = useState(false)

  // 切换选中范文时重新读取，复位编辑态
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadErr(null); setSaveResult(null); setEditing(false); setViewMode("preview")
    readKnowledgeFile(item.path)
      .then(c => { if (!cancelled) { setOriginal(c); setDraft(c) } })
      .catch(e => { if (!cancelled) setLoadErr(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item.path])

  const dirty = draft !== original
  // frontmatter meta —— 仅对真正的范文（knowledge/Examples/）有效
  const isExample = item.path.startsWith("knowledge/Examples/")
  const fm = useMemo(() => isExample ? parseFrontmatter(original) : {}, [isExample, original])
  const fmTitle = fm.title || item.label
  const fmDate = fm.date || ""
  const fmSource = fm.source || item.path

  const handleSave = async () => {
    setSaving(true); setSaveResult(null)
    try {
      const r = await saveKnowledgeFile(item.path, draft)
      setOriginal(draft)
      setSaveResult({ ok: r.ok, errors: r.errors })
      setEditing(false)
      toast.success(r.ok ? "已保存并通过校验" : "已保存（有校验提醒）")
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!isExample) return
    setMoreOpen(false)
    const name = item.path.split("/").pop() || ""
    const ok = await confirmAction({
      title: `删除范文 "${fmTitle}"？`,
      description: <>该操作<b>不可恢复</b>。文件 <code className="text-xs">{name}</code> 将从 <code className="text-xs">knowledge/Examples/</code> 移除。</>,
      confirmText: "删除",
      cancelText: "取消",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await deleteExample(name)
      toast.success("范文已删除", { description: name })
      onDeleted()
    } catch (e) {
      toast.error("删除失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      toast.success("已复制全文")
    } catch (e) {
      toast.error("复制失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 标题栏：H1 + 编辑/保存/撤销 + ⋯ menu —— 不带底分隔线，与 Skill 头部视觉一致。 */}
      <div className="px-6 py-3 flex items-center gap-2 shrink-0">
        <h2 className="text-heading-sm font-semibold font-heading truncate min-w-0">{fmTitle}</h2>
        <div className="flex-1" />
        {editing ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => { setDraft(original); setEditing(false) }} disabled={saving}>撤销</Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}保存
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" disabled={loading || !!loadErr} onClick={() => { setSaveResult(null); setEditing(true) }}>编辑</Button>
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="更多操作" title="更多操作">
                  <MoreHorizontal className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-32 p-1">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!isExample}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                    isExample
                      ? "text-destructive hover:bg-destructive/10"
                      : "opacity-40 cursor-not-allowed",
                  )}
                  title={isExample ? undefined : "该文件不在 knowledge/Examples/，不可删"}
                >
                  <Trash2 className="size-4 shrink-0" />
                  <span>删除</span>
                </button>
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      {/* frontmatter meta 行（仅范文）—— 分隔线与下方内容卡同宽（外层 px-6 内 inner wrapper 满宽）；
          grid 自己再 max-w-3xl 收住文字宽度。 */}
      {isExample && !loading && !loadErr && (
        <div className="px-6 py-3 shrink-0 text-xs leading-relaxed">
          <div className="border-b pb-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 max-w-3xl">
              <span className="text-muted-foreground">title:</span>
              <span className="text-foreground truncate">{fmTitle}</span>
              <span className="text-muted-foreground">date:</span>
              <span className="text-foreground font-mono">{fmDate || "—"}</span>
              <span className="text-muted-foreground">source:</span>
              <span className="text-foreground font-mono truncate">{fmSource}</span>
            </div>
          </div>
        </div>
      )}

      {/* 内容卡（边框 + 圆角 + 顶部工具：预览/源码 toggle + 复制全文） */}
      <div className="flex-1 min-h-0 px-6 py-4">
        <div className="h-full rounded-2xl border bg-card/40 flex flex-col overflow-hidden">
          {!loading && !loadErr && !editing && (
            <div className="shrink-0 px-3 py-2 flex items-center justify-end gap-1.5">
              <div className="inline-flex rounded-md border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("preview")}
                  title="预览（Markdown 渲染）"
                  aria-label="预览"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    viewMode === "preview" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  <Eye className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("source")}
                  title="源码（原始 Markdown）"
                  aria-label="源码"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    viewMode === "source" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  <CodeIcon className="size-3.5" />
                </button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
                title="复制全文"
                aria-label="复制全文"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          )}
          <div className="flex-1 min-h-0">
            {loadErr ? (
              <div className="p-6"><Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{loadErr}</AlertDescription></Alert></div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground h-full"><Loader2 className="animate-spin size-4" /> 载入中…</div>
            ) : editing ? (
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                spellCheck={false}
                className="h-full w-full bg-transparent p-6 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
              />
            ) : viewMode === "source" ? (
              <ScrollArea className="h-full min-h-0">
                <pre className="px-6 py-5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">{draft}</pre>
              </ScrollArea>
            ) : (
              <ScrollArea className="h-full min-h-0">
                <div className="px-6 py-5 max-w-[72ch] mx-auto"><MarkdownView source={draft} /></div>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>

      {/* 保存结果提示（与主编辑器一致的语气） */}
      {saveResult && !editing && (
        <div className="border-t px-6 py-2.5 shrink-0">
          {saveResult.ok
            ? <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="size-3.5" /> 已保存并通过校验</span>
            : <span className="text-xs text-warning flex items-center gap-1.5 min-w-0"><AlertCircle className="size-3.5 shrink-0" /><span className="truncate">已保存 · {saveResult.errors.length} 条校验提醒：{saveResult.errors[0]}</span></span>}
        </div>
      )}
    </div>
  )
}

// 范文区（中栏列表 + 右栏内容）。中栏选中走内部 state，不污染外层 selected。
// onRefresh 让上传/删除后能拉一遍 listKnowledgeFiles 重建左 nav + 中栏列表。
function ReferencesPane({ items, onRefresh }: { items: KnowledgeItem[]; onRefresh: () => void }) {
  const [refSelected, setRefSelected] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const selItem = items.find(i => i.path === refSelected) ?? null
  // 删除后清掉选中（不然右栏还指向已删项）
  const handleDeleted = () => { setRefSelected(null); onRefresh() }
  // 上传成功后刷新列表 + 选中新上传的（按文件名后缀匹配）
  const handleUploaded = () => { onRefresh() }
  return (
    <div className="flex-1 flex min-h-0">
      <ReferenceMasterList
        items={items}
        selected={refSelected}
        onSelect={setRefSelected}
        onAddClick={() => setUploadOpen(true)}
      />
      {selItem ? (
        <ReferenceDetail key={selItem.path} item={selItem} onDeleted={handleDeleted} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">从中间选一篇范文</div>
      )}
      <UploadExampleDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={handleUploaded}
      />
    </div>
  )
}

// Skill 顶部「⋯」popover 里的单项 ——
// 复制路径 / 在 Finder 打开 / 重置 / 取消编辑 复用同一形态。
// destructive 暂未用到（取消编辑虽然有"丢弃"语义但确认走 ConfirmDialog），先留口。
function SkillMenuItem({ label, icon: Icon, onSelect, disabled, destructive }: {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled && (destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-foreground/[0.05]"),
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span>{label}</span>
    </button>
  )
}

export function KnowledgeEditor() {
  const [groups, setGroups] = useState<KnowledgeGroup[]>([])
  const [listErr, setListErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [original, setOriginal] = useState("")
  const [draft, setDraft] = useState("")
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<"edit" | "preview" | "form">("edit")
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; errors: string[] } | null>(null)
  // Skill 文件（步骤提示词）专用：默认只读，点「编辑」才进入可改态。
  // 切文件 / 保存成功后自动归零。
  const [isEditing, setIsEditing] = useState(false)
  // 默认展开「步骤提示词」——与设计稿 Figma 462:152 一致
  const [showAdvanced, setShowAdvanced] = useState(true)

  // 拉左 nav + 范文列表。范文上传/删除后让 ReferencesPane 调一遍。
  const refreshGroups = () => {
    listKnowledgeFiles()
      .then(g => { setGroups(g); setSelected(prev => prev ?? g[0]?.items.find(i => i.exists)?.path ?? null) })
      .catch(e => setListErr(String(e)))
  }
  useEffect(() => { refreshGroups() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  useEffect(() => {
    if (!selected) return
    // 范文列表态：无单文件可读；清空 draft/original 让 dirty=false（避免点开某篇时误提示放弃）
    if (selected === REFERENCES_VIEW) { setDraft(""); setOriginal(""); setLoadErr(null); setSaveResult(null); return }
    setLoading(true); setLoadErr(null); setSaveResult(null)
    setIsEditing(false)
    // STYLE_GUIDE / PREFERENCES 默认进表单视图；Skill 默认 preview；其余进 edit。
    const nextView = selected === STYLE_GUIDE_PATH || selected === PREFERENCES_PATH
      ? "form"
      : selected.startsWith(".cursor/skills/")
      ? "preview"
      : "edit"
    setView(nextView)
    readKnowledgeFile(selected)
      .then(c => { setOriginal(c); setDraft(c) })
      .catch(e => setLoadErr(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  const formCapable = selected === STYLE_GUIDE_PATH || selected === PREFERENCES_PATH
  // Skill 文件（步骤提示词）= 路径前缀 .cursor/skills/。用前缀判断比 advanced flag 准——
  // 不会被未来「运行合同也变 advanced」之类边界打到。
  const isSkill = !!selected && selected.startsWith(".cursor/skills/")
  // Skill frontmatter（name/description）→ metadata strip；body = frontmatter 之后的正文。
  // 没 frontmatter 或不闭合时 fm={} / body=draft 安全回退。
  const skillFm = useMemo(() => isSkill ? parseFrontmatter(draft) : null, [isSkill, draft])
  const skillBody = useMemo(() => {
    if (!isSkill) return ""
    if (!draft.startsWith("---")) return draft
    const m = draft.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
    return m ? draft.slice(m[0].length) : draft
  }, [isSkill, draft])
  const dirty = draft !== original
  const allItems = groups.flatMap(g => g.items)
  const selItem = allItems.find(i => i.path === selected)
  // 参考范文组（左 nav 收成单入口）：用它的所有 path 判断"列表态 / 正在编辑某篇范文"
  const refGroup = groups.find(isRefGroup)
  const refPaths = new Set(refGroup?.items.map(i => i.path) ?? [])
  const onReferencesList = selected === REFERENCES_VIEW
  const editingReference = selected != null && refPaths.has(selected)

  const selectFile = async (path: string) => {
    if (path === selected) return
    if (dirty) {
      const ok = await confirmAction({ title: "放弃未保存的更改？", description: "切换文件会丢弃当前编辑。", confirmText: "放弃并切换", cancelText: "留下", variant: "destructive" })
      if (!ok) return
    }
    setSelected(path)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true); setSaveResult(null)
    try {
      const r = await saveKnowledgeFile(selected, draft)
      setOriginal(draft)
      setSaveResult({ ok: r.ok, errors: r.errors })
      toast.success(r.ok ? "已保存并通过校验" : "已保存（有校验提醒）")
      // Skill 文件保存成功后自动退出编辑态回到只读 preview，对齐 Figma 范式。
      if (isSkill) {
        setIsEditing(false)
        setView("preview")
      }
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally { setSaving(false) }
  }

  // Skill 顶栏「⋯」菜单的辅助动作 —— 复制路径 / 在 Finder 打开。
  // 不走 App.tsx 的 openInOS（未导出），直接 POST 同一个 /open 端点。
  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(
      () => toast.success("已复制路径"),
      () => toast.error("复制失败"),
    )
  }
  const handleOpenInFinder = async (path: string) => {
    try {
      const res = await fetch(API_BASE + "/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, mode: "finder" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error("打开失败", { description: err.detail || "" })
      }
    } catch (e) {
      toast.error("网络错误", { description: String(e) })
    }
  }
  // 退出编辑：脏 → 确认；干净 → 直接退。
  const handleExitEdit = async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: "放弃未保存的更改？",
        description: "退出编辑会丢弃当前改动。",
        confirmText: "放弃并退出",
        cancelText: "继续编辑",
        variant: "destructive",
      })
      if (!ok) return
      setDraft(original)
    }
    setIsEditing(false)
    setView("preview")
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r flex flex-col min-h-0">
        {/* viewport 覆盖同 App.tsx：防长文件名撑破 Radix table wrapper 致 truncate 失效 */}
        <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
          <div className="p-2 flex flex-col gap-2">
            {listErr && <div className="text-xs text-destructive p-2">{listErr}</div>}
            {/* 常用区平铺（去组标题）：写作偏好 / 风格指南 单文件直出；
                参考范文收成单入口（点开右侧 = 中栏列表 + 右栏内容）。顺序与 Figma 一致。 */}
            <div className="flex flex-col gap-0.5">
              {groups.filter(g => !g.advanced).flatMap(g => {
                if (isRefGroup(g)) {
                  const active = onReferencesList || editingReference
                  return [(
                    <button
                      key={g.group}
                      type="button"
                      onClick={() => selectFile(REFERENCES_VIEW)}
                      className={cn(
                        // 对齐设计稿 Figma 462:152：参考范文左 nav 入口同为 32px 行高
                        "w-full text-left rounded-md h-8 px-2.5 transition-colors flex items-center gap-2.5",
                        active ? "bg-foreground/[0.08] text-foreground" : "hover:bg-foreground/[0.05]",
                      )}
                    >
                      <IconReferences className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1 text-[13px] font-medium truncate">参考范文</span>
                    </button>
                  )]
                }
                return g.items.map(it => (
                  <NavFileItem key={it.path} item={it} selected={selected} onSelect={selectFile} />
                ))
              })}
            </div>
            {/* 步骤提示词：折叠组 header 已显示组名，内部去重复子组标题，直接平铺 Step 3-8。
                运行合同 WORKFLOW.md 已彻底不在 UI 暴露，过滤掉。 */}
            {groups.some(g => g.advanced && !g.group.includes("运行合同")) && (
              <div className="mt-1 pt-2 border-t border-border/60">
                {/* 对齐设计稿 Figma 462:152：标题左、disclosure 箭头在最右；去掉「改前看一眼」；
                    中性 muted、不大写/不加粗（11px 在 STYLE 下取最小 caption-sm=12）。 */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="w-full flex items-center justify-between px-2 py-1 text-caption-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>步骤提示词</span>
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", !showAdvanced && "-rotate-90")} />
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-0.5 mt-1">
                    {groups.filter(g => g.advanced && !g.group.includes("运行合同")).flatMap(g =>
                      g.items.map(it => (
                        <NavFileItem key={it.path} item={it} selected={selected} onSelect={selectFile} />
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {onReferencesList ? (
          <ReferencesPane items={refGroup?.items ?? []} onRefresh={refreshGroups} />
        ) : !selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">从左侧选一个文件编辑</div>
        ) : isSkill ? (
          // ─── Skill（步骤提示词）专用布局，对齐 Figma 521:333 ───
          // 默认只读 preview；点「编辑」才能改；保存后自动退出。
          // metadata strip 抽 name/description/source 到标题下方；
          // 底栏砍掉，撤销/重置/取消编辑全收进顶部「⋯」菜单。
          <div className="flex-1 min-h-0 flex flex-col w-full max-w-6xl mx-auto px-6 py-3 gap-3">
            {/* 顶栏：标题 + 编辑/保存 + ⋯ */}
            <div className="shrink-0 flex items-center gap-2">
              <h2 className="text-base font-semibold truncate">{selItem?.label}</h2>
              <div className="flex-1" />
              {loadErr || loading ? null : isEditing ? (
                // 编辑态对齐 Figma 524:665：[取消] [保存] 两个一级按钮，无 ⋯。
                // 取消 = 退出编辑（脏 → confirmAction）；要再来一遍重新点「编辑」即可——
                // 比埋在 ⋯ 里的「重置」少一层认知。
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleExitEdit}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    title={!dirty ? "没有改动" : undefined}
                  >
                    {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                    保存
                  </Button>
                </>
              ) : (
                // 只读态对齐 Figma 521:333：[编辑] + [⋯]（含复制路径 / 在 Finder 打开）。
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => { setIsEditing(true); setView("edit") }}
                  >
                    编辑
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="更多操作"
                        className="size-7"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-44 p-1">
                      <SkillMenuItem
                        label="复制路径"
                        icon={Copy}
                        onSelect={() => handleCopyPath(selected)}
                      />
                      <SkillMenuItem
                        label="在 Finder 打开"
                        onSelect={() => handleOpenInFinder(selected)}
                      />
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </div>

            {/* metadata strip —— name / source 两列，description 整行；解析失败则字段显 "—" */}
            {loadErr ? (
              <div className="flex-1 min-h-0 p-1"><Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{loadErr}</AlertDescription></Alert></div>
            ) : loading ? (
              <div className="flex-1 min-h-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin size-4" /> 载入中…</div>
            ) : (
              <>
                <div className="shrink-0 grid grid-cols-2 gap-x-6 gap-y-3 pb-4 border-b">
                  <div className="min-w-0">
                    <div className="text-caption-sm text-muted-foreground mb-0.5">name:</div>
                    <div className="text-sm font-mono break-all">{skillFm?.name || "—"}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-caption-sm text-muted-foreground mb-0.5">source:</div>
                    <div className="text-sm font-mono break-all">{selected}</div>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <div className="text-caption-sm text-muted-foreground mb-0.5">description:</div>
                    <div className="text-sm">{skillFm?.description || "—"}</div>
                  </div>
                </div>

                {/* 内容卡 —— 卡片头永远显示 [👁 / <>] 视图切换 + 复制 三件套（对齐 Figma 521:509）。
                    view-only 态下也允许切到 Markdown 源码（readOnly textarea），便于查看原始格式。 */}
                <div className="flex-1 min-h-0 flex flex-col border rounded-xl overflow-hidden bg-card">
                  <div className="shrink-0 h-[52px] px-4 flex items-center gap-2">
                    <div className="flex-1" />
                    {/* 视图切换 —— icon Segmented：眼睛=预览渲染，<>=Markdown 源码 */}
                    <div className="inline-flex rounded-md border bg-card p-0.5">
                      <button
                        type="button"
                        title="预览（Markdown 渲染）"
                        aria-label="预览"
                        aria-pressed={view === "preview"}
                        onClick={() => setView("preview")}
                        className={cn(
                          "size-6 rounded-[4px] flex items-center justify-center transition-colors",
                          view === "preview"
                            ? "bg-foreground/[0.08] text-foreground"
                            : "text-foreground/70 hover:bg-foreground/[0.05]",
                        )}
                      >
                        <Eye className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Markdown（原始源码）"
                        aria-label="Markdown 源码"
                        aria-pressed={view === "edit"}
                        onClick={() => setView("edit")}
                        className={cn(
                          "size-6 rounded-[4px] flex items-center justify-center transition-colors",
                          view === "edit"
                            ? "bg-foreground/[0.08] text-foreground"
                            : "text-foreground/70 hover:bg-foreground/[0.05]",
                        )}
                      >
                        <CodeIcon className="size-3.5" />
                      </button>
                    </div>
                    {/* 复制正文（去 frontmatter 后的 body）—— 把 prompt 抓走粘到别处的高频需求 */}
                    <button
                      type="button"
                      title="复制正文 Markdown"
                      aria-label="复制正文"
                      onClick={() => {
                        navigator.clipboard.writeText(skillBody).then(
                          () => toast.success("已复制正文"),
                          () => toast.error("复制失败"),
                        )
                      }}
                      className="size-7 rounded-md flex items-center justify-center text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground transition-colors"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    {view === "preview" ? (
                      <ScrollArea className="h-full min-h-0">
                        <div className="px-5 py-4 max-w-[72ch] mx-auto"><MarkdownView source={skillBody} /></div>
                      </ScrollArea>
                    ) : (
                      // 编辑态用 textarea 操作整段 draft（含 frontmatter），
                      // metadata strip 跟随 parseFrontmatter(draft) 实时更新；
                      // view-only 态切到源码视图时 readOnly，仅供阅读。
                      <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        readOnly={!isEditing}
                        spellCheck={false}
                        className={cn(
                          "h-full w-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none",
                          !isEditing && "cursor-default",
                        )}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* 对齐设计稿 Figma 470:148：居中 1152px 列（≈max-w-6xl）；
                两层 toggle 守 STYLE 复用 Segmented（不用深色实底）；颜色走中性 token。
                此分支专给 PREFERENCES / STYLE_GUIDE / 范文，Skill 走上方独立分支。 */}
            <div className="flex-1 min-h-0 flex flex-col w-full max-w-6xl mx-auto px-6 py-3 gap-3">
              {/* 顶栏：文件名（15px≈base semibold）+ 路径（保留）+ 外层 表单/源码 */}
              <div className="shrink-0 flex items-center gap-2">
                {editingReference && (
                  <button
                    type="button"
                    onClick={() => selectFile(REFERENCES_VIEW)}
                    className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="size-3.5" /> 参考范文
                  </button>
                )}
                <span className="text-base font-semibold shrink-0">{selItem?.label}</span>
                <code className="text-caption-sm text-muted-foreground truncate">{selected}</code>
                <div className="flex-1" />
                {formCapable && (
                  <Segmented
                    value={view === "form" ? "form" : "source"}
                    onChange={(v) => setView(v === "form" ? "form" : "edit")}
                    options={[{ value: "form", label: "表单" }, { value: "source", label: "源码" }]}
                  />
                )}
              </div>

              {/* 内容区：表单模式直接铺字段（无卡片、无「博主偏好」标题，对齐 428:1015/469:134）；
                  源码模式才套「文档 H1 + 预览/Markdown」头的圆角卡片（对齐 470:148）。 */}
              {loadErr ? (
                <div className="flex-1 min-h-0 p-1"><Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{loadErr}</AlertDescription></Alert></div>
              ) : loading ? (
                <div className="flex-1 min-h-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin size-4" /> 载入中…</div>
              ) : view === "form" ? (
                <div className="flex-1 min-h-0">
                  {selected === PREFERENCES_PATH
                    ? <PreferencesForm value={draft} onChange={setDraft} />
                    : <StyleGuideForm value={draft} onChange={setDraft} />}
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col border rounded-xl overflow-hidden bg-card">
                  {/* 卡片头：文档 H1 + 内层 预览/Markdown */}
                  <div className="shrink-0 h-[52px] px-4 flex items-center gap-2">
                    <span className="text-sm font-semibold text-muted-foreground truncate">
                      {draft.match(/^#\s+(.+?)\s*$/m)?.[1] || selItem?.label}
                    </span>
                    <div className="flex-1" />
                    <Segmented
                      value={view === "preview" ? "preview" : "edit"}
                      onChange={setView}
                      options={[{ value: "preview", label: "预览" }, { value: "edit", label: "Markdown" }]}
                    />
                  </div>
                  <div className="flex-1 min-h-0">
                    {view === "preview" ? (
                      <ScrollArea className="h-full min-h-0">
                        <div className="px-5 py-4 max-w-[72ch] mx-auto"><MarkdownView source={draft} /></div>
                      </ScrollArea>
                    ) : (
                      <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        spellCheck={false}
                        className="h-full w-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 保存栏（设计稿未画，功能必需，保留） */}
              <div className="shrink-0 flex items-center gap-3">
                {saveResult ? (
                  saveResult.ok
                    ? <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="size-3.5" /> 已保存并通过校验</span>
                    : <span className="text-xs text-warning flex items-center gap-1.5 min-w-0"><AlertCircle className="size-3.5 shrink-0" /><span className="truncate">已保存 · {saveResult.errors.length} 条校验提醒：{saveResult.errors[0]}</span></span>
                ) : (
                  <span className="text-xs text-muted-foreground truncate">{dirty ? "有未保存的更改" : "改动即刻影响后续任务（合同指纹失效旧缓存）"}</span>
                )}
                <div className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft(original)} disabled={!dirty}>撤销</Button>
                <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>{saving && <Loader2 className="animate-spin" data-icon="inline-start" />}保存</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsForm({ onProfilesChanged, embedded }: { onCancel?: () => void; onProfilesChanged?: () => void; embedded?: boolean }) {
  const [snap, setSnap] = useState<ProfilesSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [legacyKey, setLegacyKey] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // 右侧详情的可编辑草稿（enabled 由列表行的开关即时持久化，不放这里）
  const [name, setName] = useState("")
  const [provider, setProvider] = useState<ProviderId>("deepseek")
  const [apiBase, setApiBase] = useState("")
  const [model, setModel] = useState("")
  const [temperature, setTemperature] = useState(0)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [thinking, setThinking] = useState<"default" | "on" | "off">("default")
  const [keyInput, setKeyInput] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestLLMResult | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const selected = snap?.profiles.find(p => p.id === selectedId) ?? null

  const applySnapshot = (s: ProfilesSnapshot, preferId?: string | null) => {
    setSnap(s)
    onProfilesChanged?.()
    const target =
      (preferId && s.profiles.some(p => p.id === preferId) && preferId) ||
      (selectedId && s.profiles.some(p => p.id === selectedId) && selectedId) ||
      s.defaultProfileId ||
      (s.profiles[0]?.id ?? null)
    setSelectedId(target)
  }

  // 把某档的值灌进右侧草稿
  const loadDraft = (p: LlmProfile | null) => {
    setTestResult(null)
    setKeyInput("")
    if (!p) return
    setName(p.name)
    setProvider((p.provider as ProviderId) || inferProviderId(p.api_base))
    setApiBase(p.api_base)
    setModel(p.model)
    setTemperature(p.temperature)
    setMaxTokens(p.max_tokens)
    setThinking(p.thinking)
  }

  // 选中档变化 → 重灌草稿。**只**依赖 selectedId：snapshot 刷新（如切换别档开关）不应
  // 重灌当前正在编辑的草稿，否则会冲掉未保存的改动。
  useEffect(() => {
    loadDraft(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 首次加载
  useEffect(() => {
    setLegacyKey(readLegacyKey())
    listProfiles()
      .then(s => applySnapshot(s))
      .catch(e => setLoadError(String(e)))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const presetModels = PROVIDER_PRESETS[provider].models

  const dirty = !!selected && (
    !!keyInput.trim() ||
    name.trim() !== selected.name ||
    provider !== ((selected.provider as ProviderId) || inferProviderId(selected.api_base)) ||
    apiBase.trim() !== selected.api_base ||
    model.trim() !== selected.model ||
    temperature !== selected.temperature ||
    maxTokens !== selected.max_tokens ||
    thinking !== selected.thinking
  )

  const selectProfile = async (id: string) => {
    if (id === selectedId) return
    if (dirty) {
      const ok = await confirmAction({
        title: "放弃未保存的更改？",
        description: "当前配置档有未保存的改动，切换将丢弃它们。",
        confirmText: "放弃并切换",
        cancelText: "留在当前",
        variant: "destructive",
      })
      if (!ok) return
    }
    setSelectedId(id)
  }

  const onPickProvider = (id: ProviderId) => {
    setProvider(id)
    const preset = PROVIDER_PRESETS[id]
    if (id !== "custom") {
      setApiBase(preset.apiBase)
      if (!(preset.models as readonly string[]).includes(model.trim())) setModel(preset.models[0])
    }
  }

  // 新建档（从预设）
  const addFromPreset = async (id: ProviderId) => {
    setAddMenuOpen(false)
    const preset = PROVIDER_PRESETS[id]
    const baseName = preset.label
    const n = (snap?.profiles.filter(p => p.name.startsWith(baseName)).length ?? 0)
    try {
      const s = await createProfile({
        name: n > 0 ? `${baseName} ${n + 1}` : baseName,
        provider: id,
        api_base: preset.apiBase,
        model: preset.models[0] ?? "",
      })
      applySnapshot(s, s.created_id)
    } catch (e) {
      toast.error("新建失败", { description: String(e) })
    }
  }

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!selected) return
    setIsSaving(true)
    try {
      const patch: LlmProfilePatch = {
        name: name.trim() || "未命名",
        provider, api_base: apiBase.trim(), model: model.trim(),
        temperature, max_tokens: maxTokens, thinking,
      }
      if (keyInput.trim()) patch.api_key = keyInput.trim()
      const s = await updateProfile(selected.id, patch)
      applySnapshot(s, selected.id)
      setKeyInput("")
      toast.success("已保存", {
        description: patch.api_key ? "API Key 已存入 macOS 系统钥匙串" : undefined,
      })
    } catch (err) {
      toast.error("保存失败", { description: String(err) })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleEnabled = async (p: LlmProfile) => {
    try {
      applySnapshot(await updateProfile(p.id, { enabled: !p.enabled }), p.id)
    } catch (e) {
      toast.error("操作失败", { description: String(e) })
    }
  }

  const makeDefault = async (id: string) => {
    try { applySnapshot(await setDefaultProfile(id), id) }
    catch (e) { toast.error("设默认失败", { description: String(e) }) }
  }

  const removeProfile = async (p: LlmProfile) => {
    const ok = await confirmAction({
      title: `删除配置档「${p.name}」？`,
      description: "将同时从系统钥匙串移除该档的 API Key，此操作不可撤销。",
      confirmText: "删除",
      cancelText: "取消",
      variant: "destructive",
    })
    if (!ok) return
    try {
      const s = await deleteProfile(p.id)
      setSelectedId(null)
      applySnapshot(s)
      toast.success("已删除配置档")
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  const removeKey = async () => {
    if (!selected) return
    try {
      const s = await deleteProfileKey(selected.id)
      applySnapshot(s, selected.id)
      toast.success("已清除该档的 Key", s.message ? { description: s.message } : undefined)
    } catch (e) {
      toast.error("清除失败", { description: String(e) })
    }
  }

  const runTest = async () => {
    if (!selected) return
    setIsTesting(true); setTestResult(null)
    try {
      const res = await fetch(apiUrl("/api/test-llm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: selected.id,
          api_key: keyInput.trim() || undefined,
          api_base: apiBase.trim() || undefined,
          model: model.trim() || undefined,
        }),
      })
      if (res.status === 404) {
        setTestResult({ ok: false, error: "后端服务版本过旧 · /api/test-llm 端点未注册。\n请重启 scripts/run_engine_server.py 后再试。" })
        return
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { const d = await res.json(); if (typeof d?.error === "string") detail = d.error; else if (typeof d?.detail === "string") detail = d.detail } catch { /* */ }
        setTestResult({ ok: false, error: detail })
        return
      }
      setTestResult(await res.json())
    } catch (e) {
      setTestResult({ ok: false, error: `无法连接到本地后端 (${API_BASE.replace(/^https?:\/\//, "")}): ${String(e)}` })
    } finally {
      setIsTesting(false)
    }
  }

  const migrateLegacy = async () => {
    const legacy = readLegacyKey()
    if (!legacy) { setLegacyKey(null); return }
    try {
      const s = await createProfile({ name: "导入的 Key", provider, api_base: apiBase.trim() || PROVIDER_PRESETS[provider].apiBase, model: model.trim() || PROVIDER_PRESETS[provider].models[0], api_key: legacy })
      clearLegacyKey(); setLegacyKey(null)
      applySnapshot(s, s.created_id)
      toast.success("已迁移到 Keychain", { description: "浏览器里残留的明文 Key 已清除" })
    } catch (e) {
      toast.error("迁移失败", { description: String(e) })
    }
  }

  // 列表行的状态徽章
  const statusBadge = (p: LlmProfile) => {
    if (p.provider === "custom" && !p.api_base && !p.has_key) return null
    if (p.has_key) {
      return (
        <Badge variant="outline" className="text-caption-sm font-mono">
          {p.key_source === "env" ? "环境变量" : `已配 ····${p.key_suffix}`}
        </Badge>
      )
    }
    return <Badge variant="outline" className="text-caption-sm border-warning/40 text-warning">未配 Key</Badge>
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部标题（embedded=在 SettingsPanel 分区里时，标题栏由外层提供，这里省略） */}
      {!embedded && (
        <div className="px-6 pt-6 pb-3 border-b flex items-start justify-between gap-4">
          <div>
            <h2 className="text-heading-sm font-semibold font-heading">LLM API 全局配置</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              配置一个或多个模型服务；任务默认用「默认 ★」档，也可在建任务时按需切换。
              Key 存入 <b className="text-foreground">macOS 系统钥匙串</b>，不入磁盘/浏览器明文。
            </p>
          </div>
          <AppearanceSwitch />
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin size-4" /> 正在读取配置档…
        </div>
      ) : (
      <div className="flex-1 flex min-h-0">
        {/* ── 左：配置档列表 ── */}
        <div className="w-64 shrink-0 border-r flex flex-col min-h-0">
          <ScrollArea className="flex-1 min-h-0">
            {/* pt-6 与右侧 detail 的 p-6 顶距对齐，避免「默认」卡片贴顶、左右不齐 */}
            <div className="px-2 pb-2 pt-6 flex flex-col gap-1">
              {snap?.profiles.length === 0 && (
                <div className="text-xs text-muted-foreground p-4 text-center leading-relaxed">
                  还没有配置档。<br />点下方「添加」从预设新建。
                </div>
              )}
              {snap?.profiles.map(p => (
                // 用 div[role=button] 而非 <button>：行内含 MiniSwitch（也是 button），
                // 嵌套 button 是非法 DOM。这里手动补键盘可达性。
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectProfile(p.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectProfile(p.id) } }}
                  className={cn(
                    "w-full text-left rounded-lg px-2.5 py-2 border transition-colors flex items-center gap-2 cursor-default outline-none",
                    // STYLE 表2 唯一选中态（中性玻璃高亮）
                    p.id === selectedId
                      ? "bg-foreground/[0.08] border-transparent"
                      : "bg-transparent border-transparent hover:bg-foreground/[0.05]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {snap.defaultProfileId === p.id && <Star className="size-3 fill-primary text-primary shrink-0" />}
                      <span className={cn("text-sm font-medium truncate", !p.enabled && "text-muted-foreground line-through")}>{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {statusBadge(p)}
                    </div>
                  </div>
                  <MiniSwitch checked={p.enabled} onChange={() => toggleEnabled(p)} title={p.enabled ? "已启用（出现在建任务选择器）" : "已停用"} />
                </div>
              ))}
            </div>
          </ScrollArea>
          {/* 增删 */}
          <div className="border-t p-2 relative">
            {addMenuOpen && (
              <div className="absolute bottom-12 left-2 right-2 bg-popover border rounded-lg shadow-lg p-1 flex flex-col gap-0.5 z-10">
                {(Object.keys(PROVIDER_PRESETS) as ProviderId[]).map(id => (
                  <button key={id} type="button" onClick={() => addFromPreset(id)}
                    className="text-left text-sm px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors">
                    {PROVIDER_PRESETS[id].label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setAddMenuOpen(v => !v)}>
                <Plus data-icon="inline-start" /> 添加
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!selected} onClick={() => selected && removeProfile(selected)} title="删除选中配置档">
                <Trash2 />
              </Button>
            </div>
          </div>
        </div>

        {/* ── 右：详情 ── */}
        <div className="flex-1 flex flex-col min-h-0">
          {loadError ? (
            <div className="p-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>读取配置失败</AlertTitle><AlertDescription className="break-all">{loadError}</AlertDescription></Alert></div>
          ) : !selected ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-sm">
                <KeyRound className="size-10 mx-auto text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">从左侧选择一个配置档，或新建一个。</p>
                <div className="flex items-center justify-center gap-1.5 mt-4">
                  {(Object.keys(PROVIDER_PRESETS) as ProviderId[]).map(id => (
                    <Button key={id} type="button" variant="outline" size="sm" onClick={() => addFromPreset(id)}>
                      <Plus data-icon="inline-start" /> {PROVIDER_PRESETS[id].label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSave} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.currentTarget.requestSubmit() } }} className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6 max-w-2xl flex flex-col gap-5">
                {snap && snap.env_key_present && (
                  <Alert className="border-warning/30 bg-warning/5 py-2">
                    <AlertCircle className="text-warning" />
                    <AlertTitle className="text-sm">环境变量 Key 已生效</AlertTitle>
                    <AlertDescription className="text-xs">检测到 <code>VIDEO2BLOG_API_KEY</code>，它会<b className="text-foreground">覆盖所有配置档</b>的 Key（优先级最高）。</AlertDescription>
                  </Alert>
                )}
                {snap && !snap.keyring_available && (
                  <Alert className="border-warning/30 bg-warning/5 py-2">
                    <AlertCircle className="text-warning" />
                    <AlertTitle className="text-sm">系统钥匙串不可用</AlertTitle>
                    <AlertDescription className="text-xs">无法安全存储 Key，请改用环境变量 <code>VIDEO2BLOG_API_KEY</code>。</AlertDescription>
                  </Alert>
                )}
                {legacyKey && (
                  <Alert className="border-warning/30 bg-warning/5 py-2">
                    <AlertCircle className="text-warning" />
                    <AlertTitle className="text-sm flex items-center gap-2 flex-wrap"><span>浏览器里有残留明文 Key</span><Badge variant="outline" className="text-caption-sm font-mono">····{legacyKey.slice(-4)}</Badge></AlertTitle>
                    <AlertDescription className="text-xs flex flex-col gap-2">
                      早期版本把 Key 明文存在了浏览器。建议导入为配置档（写入钥匙串）并清除明文。
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="default" onClick={migrateLegacy}><KeyRound data-icon="inline-start" /> 导入并清除</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => { clearLegacyKey(); setLegacyKey(null) }}>仅清除明文</Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* ① 身份 */}
                <SectionLabel n="①" title="身份" />
                <FormField label="配置档名称" hint="给这套配置起个好记的名字，比如「DeepSeek·主力」「GPT-4o·精修」">
                  <TextInput type="text" value={name} onChange={e => setName(e.target.value)} placeholder="未命名"
                    className="w-full" />
                </FormField>
                <FormField label="Provider" hint="选预设自动填 Base URL 与推荐模型；Claude 等走「自定义」+ 自有 OpenAI 兼容网关">
                  <Segmented
                    value={provider}
                    onChange={onPickProvider}
                    options={(Object.keys(PROVIDER_PRESETS) as ProviderId[]).map(id => ({ value: id, label: PROVIDER_PRESETS[id].label }))}
                  />
                </FormField>

                {/* ② 连接 */}
                <SectionLabel n="②" title="连接" />
                <FormField label="API Key" hint="存于 macOS 系统钥匙串 · 不入磁盘/浏览器明文 · 不会同步到任何外部服务">
                  {selected.has_key && !keyInput && (
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
                      <Badge variant="outline" className="text-caption-sm font-mono inline-flex items-center gap-1"><KeyRound className="size-3" /> 已保存 ····{selected.key_suffix}</Badge>
                      <span>来源：{selected.key_source === "env" ? "环境变量 VIDEO2BLOG_API_KEY" : "系统钥匙串"}</span>
                    </div>
                  )}
                  <TextInput type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                    placeholder={selected.has_key ? "已保存，留空则不修改；输入则覆盖" : "sk-..."}
                    className="w-full font-mono" />
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={runTest} disabled={isTesting} title="ping 一次 LLM，验证该档可用（key 留空则用已存的）">
                      {isTesting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Zap data-icon="inline-start" />}
                      {isTesting ? "测试中…" : "测试连接"}
                    </Button>
                    {selected.key_source === "keychain" && !keyInput && (
                      <button type="button" onClick={removeKey} className="text-xs text-destructive hover:underline inline-flex items-center gap-1">
                        <Trash2 className="size-3" /> 清除此档的 Key
                      </button>
                    )}
                    {selected.key_source === "env" && (
                      <span className="text-xs text-muted-foreground">该档当前由环境变量提供，UI 无法删除。</span>
                    )}
                  </div>
                  {testResult && (
                    <div className="pt-1">
                      {testResult.ok ? (
                        <Alert className="border-success/40 bg-success/5 py-2">
                          <CheckCircle2 className="text-success" />
                          <AlertTitle className="text-sm flex items-center gap-2 flex-wrap">
                            <span>连接成功</span>
                            {testResult.latency_ms != null && <Badge variant="outline" className="text-caption-sm font-mono">{testResult.latency_ms}ms</Badge>}
                            {testResult.model && <Badge variant="outline" className="text-caption-sm font-mono">{testResult.model}</Badge>}
                          </AlertTitle>
                          {testResult.sample && <AlertDescription className="text-xs font-mono break-all">回包: {testResult.sample}</AlertDescription>}
                        </Alert>
                      ) : (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle />
                          <AlertTitle className="text-sm">连接失败</AlertTitle>
                          <AlertDescription className="text-xs whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">{testResult.error || "未知错误"}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </FormField>
                <FormField label="API Base URL" hint="OpenAI 兼容端点。DeepSeek: https://api.deepseek.com/v1 · OpenAI: https://api.openai.com/v1">
                  <TextInput type="text" value={apiBase} onChange={e => { setApiBase(e.target.value); setProvider(inferProviderId(e.target.value)) }}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full font-mono" />
                </FormField>

                {/* ③ 模型 */}
                <SectionLabel n="③" title="模型" />
                <FormField label="模型" hint="点下方推荐模型一键填入，或手动填任意 OpenAI 兼容 model 名">
                  <TextInput type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={presetModels[0] ?? "deepseek-chat"}
                    className="w-full font-mono" />
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    {presetModels.map(m => (
                      <FilterChip key={m} active={model.trim() === m} onClick={() => setModel(m)} className="px-2 text-caption-sm font-mono">
                        {m}
                      </FilterChip>
                    ))}
                  </div>
                </FormField>

                {/* ④ 生成参数（折叠） */}
                <button type="button" onClick={() => setShowAdvanced(v => !v)} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors self-start">
                  <span className={cn("transition-transform", showAdvanced && "rotate-90")}>▸</span> 生成参数（温度 / 最大 token / 深度思考）
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-5 pl-4 border-l-2 border-border/50">
                    <FormField label="温度" hint="0 最确定、最保守；越高越随机有创意。翻译/改写类建议 0–0.3。">
                      <TextInput type="number" step="0.1" min="0" max="2" value={temperature} onChange={e => setTemperature(Number(e.target.value))}
                        className="w-32 font-mono" />
                    </FormField>
                    <FormField label="最大输出 token 数" hint="限制单次返回的最大 token 数。">
                      <div className="relative w-40">
                        <select value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))}
                          className="w-full appearance-none bg-card border rounded-md py-2 pl-3 pr-9 text-sm focus:border-primary outline-none transition-colors">
                          {MAX_TOKENS_OPTIONS.map(t => <option key={t} value={t}>{t} tokens</option>)}
                        </select>
                        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 shrink-0 opacity-50" />
                      </div>
                    </FormField>
                    <FormField label="深度思考" hint="仅部分模型支持（如同时支持思考/非思考模式的模型）。">
                      <div className="relative w-40">
                        <select value={thinking} onChange={e => setThinking(e.target.value as "default" | "on" | "off")}
                          className="w-full appearance-none bg-card border rounded-md py-2 pl-3 pr-9 text-sm focus:border-primary outline-none transition-colors">
                          {Object.entries(THINKING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 shrink-0 opacity-50" />
                      </div>
                    </FormField>
                  </div>
                )}

                {/* ⑤ 危险区 */}
                <Separator />
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {snap?.defaultProfileId === selected.id ? (
                    <Badge variant="outline" className="text-xs border-primary/40 text-primary inline-flex items-center gap-1"><Star className="size-3 fill-primary" /> 当前默认档</Badge>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => makeDefault(selected.id)}><Star data-icon="inline-start" /> 设为默认</Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeProfile(selected)}>
                    <Trash2 data-icon="inline-start" /> 删除此配置档
                  </Button>
                </div>
              </div>
            </ScrollArea>

            {/* sticky 底部 */}
            <div className="border-t px-6 py-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{dirty ? "有未保存的更改" : "已是最新"}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => loadDraft(selected)} disabled={!dirty}>撤销</Button>
                <Button type="submit" disabled={!dirty || isSaving} title="保存 (Cmd/Ctrl + Enter)">
                  {isSaving && <Loader2 className="animate-spin" data-icon="inline-start" />}保存
                </Button>
              </div>
            </div>
          </form>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

// 独立「设置」窗口的根组件（Tauri 第二窗口加载 index.html?window=settings 时渲染）。
// 复用同一个 SettingsForm；关闭=关窗；改了配置档→广播 profiles:changed 让主窗口回灌。
export function SettingsWindow() {
  return (
    <TooltipProvider>
      <Toaster position="top-right" theme="system" />
      <ConfirmDialogHost />
      <div className="app-root flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
        <div className="flex-1 min-h-0 flex">
          <SettingsPanel
            chrome
            onProfilesChanged={() => { emit("profiles:changed").catch(() => {}) }}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

// 详情分组小标题
function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90 -mb-1">
      <span className="text-primary">{n}</span> {title}
    </div>
  )
}

// 外观切换（系统 / 浅色 / 深色）—— 复用 Segmented，跟随 / 覆盖系统 appearance
function AppearanceSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="shrink-0">
      <Segmented
        value={theme ?? "system"}
        onChange={setTheme}
        options={[
          { value: "system", label: "系统" },
          { value: "light", label: "浅色" },
          { value: "dark", label: "深色" },
        ]}
      />
    </div>
  )
}

// 「外观」分区：把原来塞在右上角的 AppearanceSwitch 提升为独立设置项（macOS 系统设置那样
// 一行 label + 右侧控件，即改即生效，无保存按钮）。
function AppearanceSection() {
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-8 py-7 flex flex-col gap-6">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">外观</h2>
          <p className="text-caption-sm text-muted-foreground mt-1">浅色 / 深色主题，或跟随系统自动切换。</p>
        </div>
        <div className="flex items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-sm font-medium">主题</div>
            <div className="text-xs text-muted-foreground mt-0.5">「系统」会随 macOS 外观自动在浅 / 深之间切换。</div>
          </div>
          <AppearanceSwitch />
        </div>
      </div>
    </ScrollArea>
  )
}

// 「关于」分区：应用名 + 版本号 + 检查更新（自动更新链路尚未接通，先放占位提示）。
function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(m => m.getVersion())
      .then(v => { if (!cancelled) setVersion(v) })
      .catch(() => { /* 浏览器降级 / 非 Tauri：不显示版本 */ })
    return () => { cancelled = true }
  }, [])
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-8 py-7 flex flex-col gap-6">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">关于</h2>
          <p className="text-caption-sm text-muted-foreground mt-1">把你讲过的，变成你署名写下的。</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 border-b pb-3">
            <div className="text-sm font-medium">应用</div>
            <div className="text-sm text-muted-foreground">Video2Blog</div>
          </div>
          <div className="flex items-center justify-between gap-4 border-b pb-3">
            <div className="text-sm font-medium">版本</div>
            <div className="text-sm text-muted-foreground font-mono">{version ? `v${version}` : "—"}</div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">检查更新</div>
              <div className="text-xs text-muted-foreground mt-0.5">自动更新尚未启用，当前请手动替换 .app。</div>
            </div>
            <Button variant="outline" size="sm" disabled>检查更新</Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

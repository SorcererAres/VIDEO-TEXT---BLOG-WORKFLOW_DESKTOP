import { useState, useEffect, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { emit } from '@tauri-apps/api/event'
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  KeyRound,
  Trash2,
  Star,
  ChevronUp,
  ChevronDown,
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
import { Segmented, FormField } from '@/components/form-primitives'
import { apiUrl } from '@/lib/api'
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

// 设置 = 纯模型/Key 配置。写作知识库（文风合同）已归位到「你的声音」场所（IA ⑤）。
export function SettingsPanel({ onProfilesChanged }: { onProfilesChanged?: () => void }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-5 pb-3 border-b flex items-center justify-between gap-4">
        <span className="text-sm font-medium">模型配置</span>
        <AppearanceSwitch />
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <SettingsForm onProfilesChanged={onProfilesChanged} embedded />
      </div>
    </div>
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
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-6 py-4 max-w-2xl mx-auto flex flex-col gap-2">
        <p className="text-xs text-muted-foreground mb-1">风格硬规则（优先级高于范文）。逐条编辑 · 增删 · 调序；保存即写回 STYLE_GUIDE.md。</p>
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}.</span>
            <input
              type="text"
              value={r}
              onChange={e => { const n = [...rules]; n[i] = e.target.value; update(n) }}
              className="flex-1 bg-card border rounded-md py-1.5 px-2.5 text-sm outline-none focus:border-primary"
            />
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => { const n = [...rules];[n[i - 1], n[i]] = [n[i], n[i - 1]]; update(n) }} title="上移"><ChevronUp className="size-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === rules.length - 1} onClick={() => { const n = [...rules];[n[i + 1], n[i]] = [n[i], n[i + 1]]; update(n) }} title="下移"><ChevronDown className="size-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => update(rules.filter((_, j) => j !== i))} title="删除"><Trash2 className="size-3.5 text-destructive" /></Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={() => update([...rules, "新规则"])}><Plus data-icon="inline-start" /> 添加规则</Button>
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
function spliceBanned(md: string, bullets: string[]): string {
  const body = "\n" + bullets.map(b => `- ${b}`).join("\n") + "\n\n"
  return md.replace(BANNED_SECTION_RE, (_m, heading) => heading + body)
}

// 语言/人称/长度/版式 各取该小节的「**加粗关键值**」做字段。定向 splice 只替换那段加粗值，
// 周围 prose 与全文其余字节不动；找不到的字段不渲染（结构改动走源码模式）。
const PREF_FIELDS: { key: string; label: string }[] = [
  { key: "正文语言", label: "正文语言" },
  { key: "叙述人称", label: "叙述人称（文章里的「我」）" },
  { key: "目标字数", label: "目标字数" },
  { key: "输出格式", label: "输出格式" },
]
const prefFieldRE = (k: string) => new RegExp(`(${k}[：:]\\s*\\*\\*)([^*]+?)(\\*\\*)`)
function getPrefField(md: string, key: string): string | null {
  const m = md.match(prefFieldRE(key))
  return m ? m[2].trim() : null
}
function setPrefField(md: string, key: string, val: string): string {
  return md.replace(prefFieldRE(key), (_m, a, _b, c) => a + val + c)
}

function PreferencesForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bullets = useMemo(() => parseBanned(value), [value])
  const fields = PREF_FIELDS
    .map(f => ({ ...f, val: getPrefField(value, f.key) }))
    .filter((f): f is { key: string; label: string; val: string } => f.val !== null)
  const updateBanned = (next: string[]) => onChange(spliceBanned(value, next))

  if (fields.length === 0 && bullets === null) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-sm text-muted-foreground">
        没识别到可表单化的字段（语言 / 人称 / 长度 / 版式 / 禁用套话）。请切「源码」模式编辑。
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-6 py-4 max-w-2xl mx-auto flex flex-col gap-5">
        {fields.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {fields.map(f => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <input
                  type="text"
                  value={f.val}
                  onChange={e => onChange(setPrefField(value, f.key, e.target.value))}
                  className="bg-card border rounded-md py-1.5 px-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
            ))}
          </div>
        )}

        {bullets !== null && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">禁用套话（改写时须删除的口播套话 / 求互动话术）。逐条编辑 · 增删。</div>
            {bullets.map((b, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}.</span>
                <input
                  type="text"
                  value={b}
                  onChange={e => { const n = [...bullets]; n[i] = e.target.value; updateBanned(n) }}
                  className="flex-1 bg-card border rounded-md py-1.5 px-2.5 text-sm outline-none focus:border-primary"
                />
                <Button type="button" variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => updateBanned(bullets.filter((_, j) => j !== i))} title="删除"><Trash2 className="size-3.5 text-destructive" /></Button>
              </div>
            ))}
            {bullets.length === 0 && <p className="text-xs text-muted-foreground/70 italic">（暂无禁用套话）</p>}
            <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={() => updateBanned([...bullets, "新套话"])}><Plus data-icon="inline-start" /> 添加</Button>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/70 border-t pt-3">
          更细的偏好（受众 / 语气 / 视角约束 / 版式细节 / 专有名词）请切「源码」模式编辑。
        </p>
      </div>
    </ScrollArea>
  )
}

// 知识库左栏：一个分组的文件项（带 danger 标记）
function KnowledgeGroupBlock({ group, selected, onSelect }: { group: KnowledgeGroup; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{group.group}</div>
      <div className="flex flex-col gap-0.5">
        {group.items.map(it => (
          <button
            key={it.path}
            type="button"
            onClick={() => onSelect(it.path)}
            disabled={!it.exists}
            title={it.desc}
            className={cn(
              "w-full text-left rounded-md px-2.5 py-1.5 transition-colors",
              it.path === selected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
              !it.exists && "opacity-40 cursor-not-allowed",
            )}
          >
            <div className="text-xs font-medium truncate flex items-center gap-1">
              {it.danger && <AlertCircle className="size-3 text-amber-500 shrink-0" />}
              {it.label}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{it.desc}</div>
          </button>
        ))}
      </div>
    </div>
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
  const [view, setView] = useState<"edit" | "preview" | "split" | "form">("split")
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; errors: string[] } | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    listKnowledgeFiles()
      .then(g => { setGroups(g); setSelected(prev => prev ?? g[0]?.items.find(i => i.exists)?.path ?? null) })
      .catch(e => setListErr(String(e)))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true); setLoadErr(null); setSaveResult(null)
    // STYLE_GUIDE / PREFERENCES 默认进表单视图，其余进分屏
    setView(selected === STYLE_GUIDE_PATH || selected === PREFERENCES_PATH ? "form" : "split")
    readKnowledgeFile(selected)
      .then(c => { setOriginal(c); setDraft(c) })
      .catch(e => setLoadErr(String(e)))
      .finally(() => setLoading(false))
  }, [selected])

  const formCapable = selected === STYLE_GUIDE_PATH || selected === PREFERENCES_PATH
  const dirty = draft !== original
  const allItems = groups.flatMap(g => g.items)
  const selItem = allItems.find(i => i.path === selected)

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
    } catch (e) {
      toast.error("保存失败", { description: String(e) })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-60 shrink-0 border-r flex flex-col min-h-0">
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 flex flex-col gap-3">
            {listErr && <div className="text-xs text-destructive p-2">{listErr}</div>}
            {/* 常用组直出 */}
            {groups.filter(g => !g.advanced).map(g => (
              <KnowledgeGroupBlock key={g.group} group={g} selected={selected} onSelect={selectFile} />
            ))}
            {/* 高级 · 开发者：默认折叠 + 警告 */}
            {groups.some(g => g.advanced) && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold hover:text-foreground transition-colors"
                >
                  <span className={cn("transition-transform", showAdvanced && "rotate-90")}>▸</span> 高级 · 开发者
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-3 mt-1">
                    <div className="mx-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-600 leading-snug">
                      流水线契约与提示词，改错会影响产出甚至断功能。非必要勿动。
                    </div>
                    {groups.filter(g => g.advanced).map(g => (
                      <KnowledgeGroupBlock key={g.group} group={g} selected={selected} onSelect={selectFile} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">从左侧选一个文件编辑</div>
        ) : (
          <>
            <div className="px-4 py-2 border-b flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">{selItem?.label}</span>
              <code className="text-[11px] text-muted-foreground truncate">{selected}</code>
              <div className="flex-1" />
              <Segmented
                value={view}
                onChange={setView}
                options={formCapable
                  ? [{ value: "form", label: "表单" }, { value: "edit", label: "源码" }, { value: "preview", label: "预览" }]
                  : [{ value: "edit", label: "编辑" }, { value: "preview", label: "预览" }, { value: "split", label: "分屏" }]}
              />
            </div>
            <div className="flex-1 min-h-0">
              {loadErr ? (
                <div className="p-6"><Alert variant="destructive" className="py-2"><AlertCircle /><AlertTitle className="text-sm">读取失败</AlertTitle><AlertDescription className="text-xs break-all">{loadErr}</AlertDescription></Alert></div>
              ) : loading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground h-full"><Loader2 className="animate-spin size-4" /> 载入中…</div>
              ) : view === "form" ? (
                selected === PREFERENCES_PATH
                  ? <PreferencesForm value={draft} onChange={setDraft} />
                  : <StyleGuideForm value={draft} onChange={setDraft} />
              ) : (
                <div className="h-full flex min-h-0">
                  {(view === "edit" || view === "split") && (
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      spellCheck={false}
                      className={cn("h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none", view === "split" ? "w-1/2 border-r" : "w-full")}
                    />
                  )}
                  {(view === "preview" || view === "split") && (
                    <ScrollArea className={cn("h-full min-h-0", view === "split" ? "w-1/2" : "w-full")}>
                      <div className="px-5 py-4 max-w-[72ch] mx-auto"><MarkdownView source={draft} /></div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
            <div className="border-t px-4 py-2.5 flex items-center gap-3">
              {saveResult ? (
                saveResult.ok
                  ? <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="size-3.5" /> 已保存并通过校验</span>
                  : <span className="text-xs text-amber-500 flex items-center gap-1.5 min-w-0"><AlertCircle className="size-3.5 shrink-0" /><span className="truncate">已保存 · {saveResult.errors.length} 条校验提醒：{saveResult.errors[0]}</span></span>
              ) : (
                <span className="text-xs text-muted-foreground truncate">{dirty ? "有未保存的更改" : "改动即刻影响后续任务（合同指纹失效旧缓存）"}</span>
              )}
              <div className="flex-1" />
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(original)} disabled={!dirty}>撤销</Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>{saving && <Loader2 className="animate-spin" data-icon="inline-start" />}保存</Button>
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
      setTestResult({ ok: false, error: `无法连接到本地后端 (127.0.0.1:8765): ${String(e)}` })
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
        <Badge variant="outline" className="text-[10px] font-mono">
          {p.key_source === "env" ? "环境变量" : `已配 ····${p.key_suffix}`}
        </Badge>
      )
    }
    return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">未配 Key</Badge>
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶部标题（embedded=在 SettingsPanel 分区里时，标题栏由外层提供，这里省略） */}
      {!embedded && (
        <div className="px-6 pt-6 pb-3 border-b flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">LLM API 全局配置</h2>
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
            <div className="p-2 flex flex-col gap-1">
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
                    p.id === selectedId
                      ? "bg-primary/10 border-primary/40"
                      : "bg-transparent border-transparent hover:bg-muted/50",
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
                  <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
                    <AlertCircle className="text-amber-500" />
                    <AlertTitle className="text-sm">环境变量 Key 已生效</AlertTitle>
                    <AlertDescription className="text-xs">检测到 <code>VIDEO2BLOG_API_KEY</code>，它会<b className="text-foreground">覆盖所有配置档</b>的 Key（优先级最高）。</AlertDescription>
                  </Alert>
                )}
                {snap && !snap.keyring_available && (
                  <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
                    <AlertCircle className="text-amber-500" />
                    <AlertTitle className="text-sm">系统钥匙串不可用</AlertTitle>
                    <AlertDescription className="text-xs">无法安全存储 Key，请改用环境变量 <code>VIDEO2BLOG_API_KEY</code>。</AlertDescription>
                  </Alert>
                )}
                {legacyKey && (
                  <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
                    <AlertCircle className="text-amber-500" />
                    <AlertTitle className="text-sm flex items-center gap-2 flex-wrap"><span>浏览器里有残留明文 Key</span><Badge variant="outline" className="text-[10px] font-mono">····{legacyKey.slice(-4)}</Badge></AlertTitle>
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
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="未命名"
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors" />
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
                      <Badge variant="outline" className="text-[10px] font-mono inline-flex items-center gap-1"><KeyRound className="size-3" /> 已保存 ····{selected.key_suffix}</Badge>
                      <span>来源：{selected.key_source === "env" ? "环境变量 VIDEO2BLOG_API_KEY" : "系统钥匙串"}</span>
                    </div>
                  )}
                  <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                    placeholder={selected.has_key ? "已保存，留空则不修改；输入则覆盖" : "sk-..."}
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm font-mono focus:border-primary outline-none transition-colors" />
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
                        <Alert className="border-emerald-500/40 bg-emerald-500/5 py-2">
                          <CheckCircle2 className="text-emerald-500" />
                          <AlertTitle className="text-sm flex items-center gap-2 flex-wrap">
                            <span>连接成功</span>
                            {testResult.latency_ms != null && <Badge variant="outline" className="text-[10px] font-mono">{testResult.latency_ms}ms</Badge>}
                            {testResult.model && <Badge variant="outline" className="text-[10px] font-mono">{testResult.model}</Badge>}
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
                  <input type="text" value={apiBase} onChange={e => { setApiBase(e.target.value); setProvider(inferProviderId(e.target.value)) }}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm font-mono focus:border-primary outline-none transition-colors" />
                </FormField>

                {/* ③ 模型 */}
                <SectionLabel n="③" title="模型" />
                <FormField label="模型" hint="点下方推荐模型一键填入，或手动填任意 OpenAI 兼容 model 名">
                  <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={presetModels[0] ?? "deepseek-chat"}
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm font-mono focus:border-primary outline-none transition-colors" />
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    {presetModels.map(m => (
                      <button key={m} type="button" onClick={() => setModel(m)}
                        className={cn("px-2 py-0.5 text-[10px] font-mono rounded-full border transition-colors",
                          model.trim() === m ? "bg-primary/15 border-primary/40 text-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/30")}>
                        {m}
                      </button>
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
                      <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={e => setTemperature(Number(e.target.value))}
                        className="w-32 bg-card border rounded-md py-2 px-3 text-sm font-mono focus:border-primary outline-none transition-colors" />
                    </FormField>
                    <FormField label="最大输出 token 数" hint="限制单次返回的最大 token 数。">
                      <select value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))}
                        className="w-40 bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors">
                        {MAX_TOKENS_OPTIONS.map(t => <option key={t} value={t}>{t} tokens</option>)}
                      </select>
                    </FormField>
                    <FormField label="深度思考" hint="仅部分模型支持（如同时支持思考/非思考模式的模型）。">
                      <select value={thinking} onChange={e => setThinking(e.target.value as "default" | "on" | "off")}
                        className="w-40 bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors">
                        {Object.entries(THINKING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
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
      <div className="text-[10px] text-muted-foreground mb-1 text-right">外观</div>
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

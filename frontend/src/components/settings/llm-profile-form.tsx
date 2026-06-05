import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  KeyRound,
  Trash2,
  Star,
  ChevronsUpDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/ConfirmDialog'
import { Segmented, FormField, TextInput, FilterChip } from '@/components/form-primitives'
import { API_BASE, apiUrl } from '@/lib/api'
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
  type ProviderId,
  type LlmProfile,
  type ProfilesSnapshot,
  type LlmProfilePatch,
  type TestLLMResult,
} from '@/lib/settings-store'
import { MiniSwitch } from '@/components/settings/local-models-panel'

// ═══════════════════ Settings：LLM 配置档管理器（master-detail）═══════════════════
const THINKING_LABEL: Record<string, string> = { default: "默认设置", on: "开启", off: "关闭" }
const MAX_TOKENS_OPTIONS = [512, 1024, 2048, 4096, 8192]

export function SettingsForm({ onProfilesChanged, embedded }: { onCancel?: () => void; onProfilesChanged?: () => void; embedded?: boolean }) {
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

// 详情分组小标题
function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90 -mb-1">
      <span className="text-primary">{n}</span> {title}
    </div>
  )
}

// 外观切换（系统 / 浅色 / 深色）—— 复用 Segmented，跟随 / 覆盖系统 appearance
export function AppearanceSwitch() {
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

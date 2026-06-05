import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Copy,
  Eye,
  Code as CodeIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { confirmAction } from '@/components/ConfirmDialog'
import { Segmented } from '@/components/form-primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { API_BASE } from '@/lib/api'
import {
  listKnowledgeFiles,
  readKnowledgeFile,
  saveKnowledgeFile,
  type KnowledgeGroup,
  type KnowledgeItem,
} from '@/lib/settings-store'
import { STYLE_GUIDE_PATH, PREFERENCES_PATH } from '@/lib/preferences-parser'
import { PreferencesForm, StyleGuideForm } from '@/components/settings/preferences-editors'
import { parseFrontmatter, ReferencesPane } from '@/components/settings/reference-editor'

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
// 直接渲染 JSX（而非返回组件类型再 <Icon/>）——避免 react-hooks/static-components 的「render 中创建组件」误判，
// 同时映射关系与旧 knowledgeIcon 完全一致。
function KnowledgeIcon({ path, className }: { path: string; className?: string }) {
  if (path === PREFERENCES_PATH) return <IconWritingPref className={className} />  // 写作偏好
  if (path === STYLE_GUIDE_PATH) return <IconStyleGuide className={className} />   // 风格指南
  if (path.startsWith(".cursor/skills/")) return <IconStep className={className} /> // Step 3-8 提示词
  return <FileText className={className} />                                         // 参考范文 / 运行合同等
}

// 知识库左栏：单个文件项（单行，带 danger 标记 + 类型图标）。
// 平铺用：常用区 flatMap、advanced 折叠区 flatMap 都复用它，去掉组标题（对齐 Figma）。
function NavFileItem({ item, selected, onSelect }: { item: KnowledgeItem; selected: string | null; onSelect: (p: string) => void }) {
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
      <KnowledgeIcon path={item.path} className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
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

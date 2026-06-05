import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  FileText,
  MoreHorizontal,
  Copy,
  Eye,
  Code as CodeIcon,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { confirmAction } from '@/components/ConfirmDialog'
import { FormField, TextInput } from '@/components/form-primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { uploadExample, deleteExample } from '@/lib/examples-actions'
import {
  readKnowledgeFile,
  saveKnowledgeFile,
  type KnowledgeItem,
} from '@/lib/settings-store'

// 极简 YAML frontmatter 解析 —— 范文 meta 行需要 title/date/source 三件套。
// 只解析 `^---\n` 与 `\n---\n` 之间的 `key: value` 行；不引 yaml 库。
export function parseFrontmatter(text: string): Record<string, string> {
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
export function ReferencesPane({ items, onRefresh }: { items: KnowledgeItem[]; onRefresh: () => void }) {
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

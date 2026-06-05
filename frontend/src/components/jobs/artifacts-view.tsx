// 过程产物面板：列 work/<stem>/ 下中间产物，点开经 /file 查看。
// 从 jobs.tsx 原样搬出，零行为变更。
import { useState, useEffect, useMemo } from 'react'
import {
  AlertCircle,
  Loader2,
  Copy,
  RotateCw,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { apiUrl } from '@/lib/api'
import { type EngineJob } from '@/lib/job-types'

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

export function ArtifactsView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
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
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground truncate min-w-0" title={`work/${stem}/`}>work/{stem}/</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={loadList} title="刷新（运行中可随时看最新产物）" aria-label="刷新产物列表" className="size-6 shrink-0">
            <RotateCw className="size-3.5" />
          </Button>
        </div>
        {/* viewport 覆盖同 App.tsx：防长产物名撑破 Radix table wrapper 致 truncate 失效 */}
        <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
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
                  // STYLE 表2 唯一选中态（中性玻璃高亮）
                  f.path === selected ? "bg-foreground/[0.08] text-foreground" : "hover:bg-foreground/[0.05]",
                )}
              >
                <div className="text-xs font-medium truncate">{ARTIFACT_META[f.kind]?.label ?? f.kind}</div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-caption-sm text-muted-foreground font-mono truncate">{f.name}</span>
                  <span className="text-caption-sm text-muted-foreground/70 shrink-0">{artifactBytes(f.size)}</span>
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
            <code className="text-caption-sm text-muted-foreground">{selFile.name}</code>
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" disabled={content === null} onClick={() => content && onCopy(content)} title="复制内容" aria-label="复制内容">
              <Copy className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInOS(selFile.path, "editor")} title="用编辑器打开" aria-label="用编辑器打开">
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

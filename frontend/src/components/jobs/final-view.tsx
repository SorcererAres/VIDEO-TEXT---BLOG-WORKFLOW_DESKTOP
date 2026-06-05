// 成品视图（artifact 文档阅读器）+ 信息行 / 路径行小组件。
// 从 jobs.tsx 原样搬出，零行为变更。
import { useState, useEffect } from 'react'
import {
  AlertCircle,
  Loader2,
  Copy,
  FolderOpen,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FilterChip } from '@/components/form-primitives'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { apiUrl } from '@/lib/api'
import { type EngineJob } from '@/lib/job-types'

// 去掉 markdown 顶部 YAML frontmatter，只渲染正文（阅读视图）。
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/)
  return m ? md.slice(m[0].length).replace(/^\s+/, "") : md
}

// 成品处置（质量学习闭环信号）：读完标一下实际采纳程度，只存本地。
const DISPOSITIONS: { key: string; label: string }[] = [
  { key: "used", label: "👍 直接用了" },
  { key: "edited", label: "✍️ 改了改" },
  { key: "rewrote", label: "🔁 重写了" },
]

// ═══════════════════ Final View（artifact 文档阅读器）═══════════════════
// 成品博文是主角：居中阅读列渲染整篇文档；元信息（路径/质检/成本）降为次级。
export function FinalView({ job, onCopy, onOpenInOS }: { job: EngineJob; onCopy: (text: string) => void; onOpenInOS: (path: string, mode: "finder" | "editor") => void }) {
  const isHistorical = job.kind === "historical"
  const isDraft = job.is_draft === true || job.status === "draft"
  const path = job.final_post_path
  const [content, setContent] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [disposition, setDisposition] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setContent(null); return }
    setContent(null); setLoadErr(null)
    fetch(apiUrl(`/file?path=${encodeURIComponent(path)}`))
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setContent(stripFrontmatter(d.content ?? "")))
      .catch(e => setLoadErr(String(e)))
  }, [path])

  // 载入该成品已有的处置标记（按 path 查全量 map）
  useEffect(() => {
    if (!path) { setDisposition(null); return }
    fetch(apiUrl("/api/dispositions"))
      .then(r => (r.ok ? r.json() : {}))
      .then((map: Record<string, { value?: string } | undefined>) => setDisposition(map?.[path]?.value ?? null))
      .catch(() => setDisposition(null))
  }, [path])

  // 点击切换处置（再点同一个=取消）；乐观更新 + POST 落盘。
  const setDispo = (key: string) => {
    if (!path) return
    const next = disposition === key ? null : key
    setDisposition(next)
    fetch(apiUrl("/api/dispositions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, value: next }),
    }).catch(() => { /* 本地信号，失败不打断阅读 */ })
  }

  return (
    <ScrollArea className="h-full">
      {/* 顶部 meta 条（sticky）—— 状态 + 质检 + 操作 */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur border-b px-6 py-2.5 flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={cn(
            "text-caption-sm",
            isDraft ? "border-warning/40 text-warning" : "border-success/40 text-success",
          )}
        >
          {isDraft ? "DRAFT 归档" : isHistorical ? "成品归档" : "博文成品"}
        </Badge>
        {job.pass_score && <Badge variant="outline" className="text-caption-sm font-mono">质检 {job.pass_score}</Badge>}
        {!isHistorical && job.estimated_cost_usd > 0 && (
          <Badge variant="outline" className="text-caption-sm font-mono">${job.estimated_cost_usd.toFixed(4)}</Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => content && onCopy(content)} disabled={!content}>
          <Copy data-icon="inline-start" /> 复制全文
        </Button>
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "finder")} title="在 Finder 显示" aria-label="在 Finder 显示">
            <FolderOpen />
          </Button>
        )}
        {path && (
          <Button size="sm" variant="ghost" onClick={() => onOpenInOS(path, "editor")} title="用默认编辑器打开" aria-label="用默认编辑器打开">
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

        {/* 处置反馈 —— 读完标一下实际采纳，沉淀质量学习信号（只存本地） */}
        {path && content != null && (
          <div className="mt-10 flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">这篇用得怎么样？只存本地，帮工具校准质检。</div>
            <div className="flex gap-2 flex-wrap">
              {DISPOSITIONS.map(({ key, label }) => (
                <FilterChip
                  key={key}
                  active={disposition === key}
                  onClick={() => setDispo(key)}
                  className="px-3 py-1.5 text-sm"
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </div>
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
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onCopy(path)} aria-label="复制路径">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">复制路径</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "finder")} aria-label="在 Finder 中显示">
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">在 Finder 中显示</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onOpenInOS(path, "editor")} aria-label="用默认应用打开">
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

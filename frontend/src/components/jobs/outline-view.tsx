// 骨架大纲审批视图（Step 5）。
// 从 jobs.tsx 原样搬出，零行为变更。
import {
  Loader2,
  Check,
  X,
  RotateCw,
  ListTree,
  Copy,
  Eye,
  Code as CodeIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { formatRelativeTime } from '@/lib/utils'
import { type JobWorkspaceProps } from '@/components/jobs/job-workspace-types'

// ═══════════════════ Outline Edit View ═══════════════════
export function OutlineView({ outlineText, setOutlineText, outlineViewMode, setOutlineViewMode, isSubmittingOutline, onApproveOutline, job, healthOffline, outlineDraftRestoredTs, onReloadOutlineOriginal }: JobWorkspaceProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {outlineDraftRestoredTs && (
        <Alert className="border-warning/30 bg-warning/5 py-2">
          <RotateCw className="text-warning" />
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
        {/* plain div 而非 CardHeader —— 后者 grid auto-rows-min 会把子项强制分两行（同 draft 视图） */}
        <div className="pt-0 pb-2.5 px-4 flex items-center justify-between gap-2 shrink-0">
          <code className="text-xs text-muted-foreground truncate min-w-0">work/{job.stem}/outline.md</code>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="inline-flex rounded-md border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setOutlineViewMode("preview")}
                title="预览（Markdown 渲染）"
                aria-label="预览"
                className={cn(
                  "size-6 rounded flex items-center justify-center transition-colors",
                  outlineViewMode === "preview" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                )}
              >
                <Eye className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOutlineViewMode("edit")}
                title="源码（原始 Markdown，可编辑）"
                aria-label="源码"
                className={cn(
                  "size-6 rounded flex items-center justify-center transition-colors",
                  outlineViewMode === "edit" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                )}
              >
                <CodeIcon className="size-3.5" />
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(outlineText)
                  toast.success("已复制全文")
                } catch (e) {
                  toast.error("复制失败", { description: e instanceof Error ? e.message : String(e) })
                }
              }}
              title="复制全文"
              aria-label="复制全文"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
        <CardContent className="p-0 flex-1 overflow-hidden">
          {outlineViewMode === "edit" ? (
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

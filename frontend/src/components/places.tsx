// 顶层"场所"视图：作品集 Library / 你的声音 Voice。
// ④ 先立骨架（可用但简单），③ 把 Library 做成富作品墙、⑤ 把 Voice 做成文风表单 + 指纹画像。

import { Award, BookOpen, FileText, PenLine, Sparkles } from "lucide-react"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { formatRelativeOrAbsolute, type EngineJob } from "@/lib/job-types"

// ═══════════════════ 作品集 Library ═══════════════════

export function LibraryView({
  historicalJobs,
  onOpenJob,
}: {
  historicalJobs: EngineJob[]
  onOpenJob: (id: string) => void
}) {
  const posts = [...historicalJobs].sort((a, b) => {
    const ta = new Date((a.created_at || "").replace(" ", "T")).getTime() || 0
    const tb = new Date((b.created_at || "").replace(" ", "T")).getTime() || 0
    return tb - ta
  })

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          作品集
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          你攒下的全部成品 · 共 {posts.length} 篇。点开任意一篇重读。
          <span className="text-muted-foreground/60"> （筛选 / 排序 / 质检概览将在增量③ 补上）</span>
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
              <EmptyTitle>还没有成品</EmptyTitle>
              <EmptyDescription>开始第一篇改写，这里会长出你的创作轨迹。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 pb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {posts.map(job => (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpenJob(job.id)}
                className="text-left rounded-lg border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-4 flex flex-col gap-2 min-h-[7rem]"
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  {job.is_draft ? (
                    <Badge variant="outline" className="text-[10px] shrink-0">DRAFT</Badge>
                  ) : job.pass_score ? (
                    <span className="text-[10px] text-emerald-600 flex items-center gap-0.5 shrink-0">
                      <Award className="size-3" />{job.pass_score}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm font-medium leading-snug line-clamp-3 flex-1">{job.stem}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span>{formatRelativeOrAbsolute(job.created_at)}</span>
                  {job.request?.routing && <span className="text-muted-foreground/50">· {job.request.routing}</span>}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

// ═══════════════════ 你的声音 Voice ═══════════════════

export function VoiceView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-10 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <PenLine className="size-5 text-primary" />
            你的声音
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            文风指南、写作偏好、参考范文，决定改写出来像不像你本人写的。
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">这是这个工具最核心的差异点</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                别的工具写出来是"AI 的第三人称摘要"；这里写出来是"你的第一人称署名长文"。
                靠的就是这套可编辑的文风合同 + 你历史成品沉淀出的风格指纹。
              </p>
            </div>
          </div>
          <div className="pl-8">
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              <PenLine data-icon="inline-start" />
              编辑写作知识库
            </Button>
          </div>
        </div>

        <div className={cn(
          "rounded-lg border border-dashed p-5 text-sm text-muted-foreground",
          "bg-muted/20",
        )}>
          <div className="font-medium text-foreground/80 mb-1">即将到来（增量⑤）</div>
          文风/偏好/范文将在这里直接表单化编辑（不必去设置窗的裸 Markdown）；
          并把 <code className="text-xs bg-muted px-1 rounded">fingerprints.jsonl</code> 渲染成「你的文风画像」——
          句长分布、高频词、段落密度，让你一眼看见自己的写作风格。
        </div>
      </div>
    </div>
  )
}

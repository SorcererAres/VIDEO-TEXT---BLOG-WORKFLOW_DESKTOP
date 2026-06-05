// 草稿与质检审批视图（Step 7）+ 单维评分条。
// 从 jobs.tsx 原样搬出，零行为变更。
import {
  AlertCircle,
  Loader2,
  Copy,
  Check,
  X,
  Award,
  RotateCw,
  Eye,
  Code as CodeIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/MarkdownView'
import { formatRelativeTime } from '@/lib/utils'
import { type JobWorkspaceProps } from '@/components/jobs/job-workspace-types'

// ═══════════════════ Draft + Review View ═══════════════════
export function DraftReviewView({ draftContent, setDraftContent, reviewJson, isSubmittingDraft, onApproveDraft, healthOffline, draftViewMode, setDraftViewMode, draftEditRestoredTs, onReloadDraftOriginal }: JobWorkspaceProps) {
  const parseFailed = reviewJson?.parse_failed === true
  const offlineTitle = healthOffline ? "后端离线,无法提交" : undefined

  return (
    <div className="flex flex-col h-full gap-4">
      {/* 草稿编辑恢复 Banner —— 跟 OutlineView 同款 */}
      {draftEditRestoredTs && (
        <Alert className="border-warning/30 bg-warning/5 py-2">
          <RotateCw className="text-warning" />
          <AlertTitle className="flex items-center justify-between gap-2 text-sm">
            <span>已恢复 {formatRelativeTime(draftEditRestoredTs)}的本地编辑</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReloadDraftOriginal}
              className="h-7 text-xs"
            >
              <X data-icon="inline-start" />
              丢弃,载入后端原始
            </Button>
          </AlertTitle>
        </Alert>
      )}

      {/* Banner — 区分 parse_failed 和正常 REVIEW */}
      {parseFailed ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 质检系统失效,请人工裁判</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-success text-white hover:bg-success/90">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受并以 DRAFT 落盘
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            LLM 没按合同输出评分表,引擎跳过了自修正,把决定权交给你。读右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受"会一并回写后端。
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-warning/40 bg-warning/5">
          <Award className="text-warning" />
          <AlertTitle className="flex items-center justify-between">
            <span>Step 7 · 质检人工审批</span>
            <div className="flex gap-2">
              <Button onClick={() => onApproveDraft(true)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" className="bg-success text-white hover:bg-success/90">
                {isSubmittingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                接受为草稿 (DRAFT)
              </Button>
              <Button onClick={() => onApproveDraft(false)} disabled={isSubmittingDraft || healthOffline} title={offlineTitle} size="sm" variant="outline">
                <X data-icon="inline-start" />
                拒绝并中止
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription>
            博文初稿已生成,但未达到自动发布阈值。看一眼右侧草稿,
            <b className="text-foreground">需要小修可直接在编辑器里改</b>,改完点"接受为草稿"会一并回写后端;也可弃用重跑。
          </AlertDescription>
        </Alert>
      )}

      {/* Score card (左) + Draft preview (右)。
          注意：grid 不能用 overflow-hidden —— Card 用 ring-1（box-shadow 外溢 1px）当边框，
          被外层 hidden 裁掉就成了"上下边框消失"的视觉 bug。让 Card 自身 overflow-hidden 兜底内容裁剪。
          外层用 min-h-0 保证 flex-1 高度能算对。 */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {/* Score card */}
        <Card className="col-span-1 overflow-hidden flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-body-md flex items-center justify-between">
              <span>质检得分</span>
              <span className={cn("text-heading-lg font-bold tabular-nums", parseFailed ? "text-destructive" : "text-warning")}>
                {reviewJson?.total ?? "—"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
            {(() => {
              const hasScores = !!reviewJson && !parseFailed && Object.entries(reviewJson.scores || {}).length > 0
              if (hasScores) {
                return (
                  <>
                    <div className="flex flex-col gap-2.5">
                      {Object.entries(reviewJson!.scores).map(([dim, score]) => (
                        <ScoreBar key={dim} dim={dim} score={score} />
                      ))}
                    </div>
                    <Separator />
                  </>
                )
              }
              // 无评分时：去掉孤立 Separator + 给用户清晰的状态指引（不再"看似被遮住"）。
              return (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                  {parseFailed ? (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">⚠ 质检结果解析失败</div>
                      {reviewJson?.raw_markdown
                        ? "下方原始 markdown 是兜底，可以人工读一眼。"
                        : "文件存在但 JSON 无法解析，可能引擎版本不匹配。"}
                    </>
                  ) : reviewJson === null ? (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">质检结果尚未生成</div>
                      Step 7 还在跑或刚跑完，稍后会自动出现六维评分。
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-foreground/80 mb-1">本轮无六维评分</div>
                      可能 LLM 直接给 PASS / 评分字段为空，看下方 Re-Brief 与正文。
                    </>
                  )}
                </div>
              )
            })()}
            <div className="flex-1 overflow-hidden flex flex-col">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Re-Brief 改进建议
              </h4>
              <ScrollArea className="flex-1 min-h-0">
                <div className="text-xs text-foreground/80 leading-relaxed pr-2 whitespace-pre-wrap">
                  {reviewJson?.rebrief?.trim() || (parseFailed && reviewJson?.raw_markdown?.trim()) || (
                    <span className="text-muted-foreground italic">
                      {reviewJson === null ? "正在加载质检详细原因…" : "无具体反馈。"}
                    </span>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        {/* Draft 预览/源码 —— 单行 header（仿风格页范文详情）：标签 + 文件名在左，
            预览/源码 toggle + 复制全文按钮在右；改完接受时一并回写后端。 */}
        <Card className="col-span-2 overflow-hidden flex flex-col py-0">
          {/* 用 plain div 而非 CardHeader —— 后者 grid auto-rows-min 会把子项强制分两行。
              Card 自身 py-0 抹掉默认 16px 外缘，header py-3 自己控制 12px 上下气，
              视觉上卡顶 → 文字 ≈ 12px（不会让用户感觉 header 上方有大块空白）。 */}
          <div className="py-3 px-4 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-normal text-muted-foreground shrink-0">草稿</span>
              <code className="text-caption-sm text-muted-foreground/60 truncate">draft_v{reviewJson?.version ?? 1}.md</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="inline-flex rounded-md border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setDraftViewMode("preview")}
                  title="预览（Markdown 渲染）"
                  aria-label="预览"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    draftViewMode === "preview" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  <Eye className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDraftViewMode("edit")}
                  title="源码（原始 Markdown，可编辑）"
                  aria-label="源码"
                  className={cn(
                    "size-6 rounded flex items-center justify-center transition-colors",
                    draftViewMode === "edit" ? "bg-foreground/[0.08] text-foreground" : "text-foreground/60 hover:text-foreground",
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
                    await navigator.clipboard.writeText(draftContent)
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
            {!draftContent ? (
              <div className="px-6 py-5 text-muted-foreground italic text-sm">正在加载初稿...</div>
            ) : draftViewMode === "edit" ? (
              <textarea
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none resize-none"
                spellCheck={false}
              />
            ) : (
              <ScrollArea className="h-full">
                <div className="px-6 py-5 max-w-[70ch] mx-auto">
                  <MarkdownView source={draftContent} />
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ScoreBar({ dim, score }: { dim: string; score: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-foreground/80 shrink-0 w-20">{dim}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            score >= 8 ? "bg-success" : score >= 5 ? "bg-warning" : "bg-destructive",
          )}
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </div>
      <span className="font-semibold tabular-nums w-5 text-right">{score}</span>
    </div>
  )
}

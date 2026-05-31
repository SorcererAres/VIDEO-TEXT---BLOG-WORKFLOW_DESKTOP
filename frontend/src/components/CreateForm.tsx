import { useState } from 'react'
import { ChevronRight, Loader2, Plus, RotateCw, Sparkle, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { API_BASE } from '@/lib/api'
import { SourcePicker } from '@/components/SourcePicker'
import { Checkbox, FormField, Segmented } from '@/components/form-primitives'
import type { LlmProfile } from '@/lib/settings-store'

// 写作视角（路由）翻成场景人话：决定文章里的「我」是谁。ID 保留给底层/合同，
// UI 不再以 /lecture 这种黑话打头。顺序与频次对齐（讲课/分享最常见）。
const ROUTING_OPTIONS: { value: string; label: string }[] = [
  { value: "/lecture", label: "我在讲课 / 分享 · lecture" },
  { value: "/dialogue", label: "我是受访嘉宾（对谈输出观点的一方）· dialogue" },
  { value: "/screencast", label: "我在录屏讲解 · screencast" },
  { value: "/meeting", label: "我在主持 / 做决策 · meeting" },
  { value: "/default", label: "不确定，让 AI 判断 · default" },
]

// ═══════════════════ Create Form ═══════════════════
export interface CreateFormProps {
  source: string; setSource: (v: string) => void
  speaker: string; setSpeaker: (v: string) => void
  onDetectSpeaker: () => void
  speakerHint: { text: string; tone: "ok" | "warn" } | null
  detectingSpeaker: boolean
  routing: string; setRouting: (v: string) => void
  mode: "full" | "quick"; setMode: (v: "full" | "quick") => void
  maxRetries: number; setMaxRetries: (v: number) => void
  model: string; setModel: (v: string) => void
  force: boolean; setForce: (v: boolean) => void
  pauseOnOutline: boolean; setPauseOnOutline: (v: boolean) => void
  rewriteStrategy: "single" | "sectioned"; setRewriteStrategy: (v: "single" | "sectioned") => void
  profileId: string; setProfileId: (v: string) => void
  profileOptions: LlmProfile[]
  defaultProfileId: string | null
  onOpenSettings: () => void
  isSubmitting: boolean
  healthOffline: boolean
  draftRestoredTs: number | null
  onDiscardDraft: () => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

// 把秒数 / 分钟数转成"刚刚 / X 分钟前 / X 小时前 / 昨天"——给草稿恢复 banner 用
// 也被 App.tsx 的 OutlineView / DraftReviewView 复用。
export function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 30) return "刚刚"
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

export function CreateForm(props: CreateFormProps) {
  // 渐进式披露：日常只填 源/演讲人/视角/模式；其余引擎旋钮收进"高级选项"折叠区。
  // 若任务带了非默认的高级值（恢复草稿 / 重跑回填），默认展开，避免用户看不见已生效的设置。
  const hasNonDefaultAdvanced =
    props.maxRetries !== 1 ||
    props.force ||
    props.rewriteStrategy !== "single" ||
    !!props.profileId ||
    !!props.model.trim() ||
    (props.mode === "full" && !props.pauseOnOutline)
  const [showAdvanced, setShowAdvanced] = useState(hasNonDefaultAdvanced)

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        {props.draftRestoredTs && (
          <Alert className="border-primary/30 bg-primary/5">
            <RotateCw className="text-primary" />
            <AlertTitle className="flex items-center justify-between gap-2">
              <span>已恢复 {formatRelativeTime(props.draftRestoredTs)}未提交的草稿</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onDiscardDraft}
                className="h-7 text-xs"
              >
                <X data-icon="inline-start" />
                放弃恢复
              </Button>
            </AlertTitle>
            <AlertDescription>
              上次离开 CreateForm 时填的内容已自动恢复。继续编辑或点"放弃恢复"重置。
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>新建改写任务</CardTitle>
            <CardDescription>把视频转录稿、字幕或现成文字稿,改写成演讲人第一人称的可发布博文。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={props.onSubmit}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault()
                  e.currentTarget.requestSubmit()
                }
              }}
              className="flex flex-col gap-5"
            >
              <FormField label="输入源" required hint="可选 input/Video/ 里的视频(自动先转录)、work/<stem>/raw.txt 转录稿、或 input/Text/* 文字稿;也可手动粘路径">
                <SourcePicker
                  value={props.source}
                  onChange={props.setSource}
                  apiBase={API_BASE}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="演讲人主体">
                  <div className="flex gap-2">
                    <input
                      type="text" value={props.speaker}
                      onChange={e => props.setSpeaker(e.target.value)}
                      className="flex-1 min-w-0 bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors"
                    />
                    <Button
                      type="button" variant="outline" size="sm" className="shrink-0"
                      onClick={props.onDetectSpeaker}
                      disabled={props.detectingSpeaker || !props.source.trim()}
                      title="用 AI 从源文识别演讲人"
                    >
                      {props.detectingSpeaker ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkle data-icon="inline-start" />}
                      AI 识别
                    </Button>
                  </div>
                  {props.speakerHint ? (
                    <span className={cn("text-xs", props.speakerHint.tone === "ok" ? "text-emerald-600" : "text-amber-600")}>{props.speakerHint.text}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">稿件里的主讲人 / 受访者，可能不是你本人。选源后会自动识别，并记住上次输入。</span>
                  )}
                </FormField>
                <FormField label="写作视角" hint="决定文章里的「我」是谁">
                  <select
                    value={props.routing}
                    onChange={e => props.setRouting(e.target.value)}
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none"
                  >
                    {ROUTING_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField
                label="工作流模式"
                hint={props.mode === "full" ? "清洗 + 提炼 + 骨架 + 重写 + 质检" : "直接重写 + 质检，跳过中间步骤"}
              >
                <Segmented
                  value={props.mode}
                  onChange={(v) => props.setMode(v)}
                  options={[
                    { value: "full", label: "完整流程", title: "清洗 + 提炼 + 骨架 + 重写 + 质检" },
                    { value: "quick", label: "极速改写", title: "直接重写 + 质检" },
                  ]}
                />
              </FormField>

              {/* 高级选项：日常不必碰的引擎旋钮，默认折叠 */}
              <button
                type="button"
                onClick={() => setShowAdvanced(s => !s)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
              >
                <ChevronRight className={cn("size-4 transition-transform", showAdvanced && "rotate-90")} />
                高级选项{showAdvanced ? "" : "（重试 / 配置档 / 模型 / 缓存 / 审批…）"}
              </button>

              {showAdvanced && (
              <div className="flex flex-col gap-5 border-l-2 border-border/60 pl-4">
              <FormField label="自修正最大重试" hint="默认 1 轮;不需要可设 0">
                <input
                  type="number" min={0} max={3} value={props.maxRetries}
                  onChange={e => props.setMaxRetries(parseInt(e.target.value) || 0)}
                  className="w-full bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none"
                />
              </FormField>

              <FormField label="配置档" hint="用哪套 LLM 配置跑这个任务；留「跟随默认」即用 Settings 里标★的那档。">
                {props.profileOptions.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>还没有任何配置档。</span>
                    <button type="button" onClick={props.onOpenSettings} className="text-primary hover:underline">去 Settings 添加</button>
                  </div>
                ) : (
                  <select
                    value={props.profileId}
                    onChange={e => props.setProfileId(e.target.value)}
                    className="w-full bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors"
                  >
                    <option value="">
                      跟随默认{(() => { const d = props.profileOptions.find(p => p.id === props.defaultProfileId); return d ? `（${d.name}）` : "" })()}
                    </option>
                    {props.profileOptions.filter(p => p.enabled).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.has_key ? "" : " · 未配 Key"}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>

              <FormField label="指定模型(选填)" hint="留空则用所选配置档里的模型；填了则临时覆盖该档的模型,如 deepseek-chat / gpt-4o">
                <input
                  type="text" value={props.model}
                  onChange={e => props.setModel(e.target.value)}
                  placeholder="例如: deepseek-chat"
                  className="w-full bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors"
                />
              </FormField>

              <div className="flex flex-col gap-2.5">
                <Checkbox label="强制重跑(忽略缓存)" checked={props.force} onChange={props.setForce} />
                {props.mode === "full" && (
                  <Checkbox label="大纲生成后暂停审批" checked={props.pauseOnOutline} onChange={props.setPauseOnOutline} hint="关掉则直接跑完全流程,不在 Step 5 后暂停" />
                )}
                {props.mode === "full" && (
                  <Checkbox
                    label="长稿按节滚动改写(§9-C)"
                    checked={props.rewriteStrategy === "sectioned"}
                    onChange={(v) => props.setRewriteStrategy(v ? "sectioned" : "single")}
                    hint="按 Step 5 outline 拆节调用 LLM,每节附带上一节末段做承上启下,长稿避免撞窗。骨架不可解析或进入自修正循环时引擎会自动回退一次性整篇。"
                  />
                )}
              </div>
              </div>
              )}

              <Separator />

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={props.isSubmitting || props.healthOffline}
                  title={props.healthOffline ? "后端离线,无法提交" : "提交 (Cmd/Ctrl + Enter)"}
                  className="flex-1"
                >
                  {props.isSubmitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                  {props.healthOffline ? "后端离线 · 无法提交" : "提交并开始"}
                </Button>
                <Button type="button" variant="outline" onClick={props.onCancel} title="取消 (Esc)">取消</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

import { useState } from "react"
import { Check, ChevronDown, Loader2, Sparkle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TextInput } from "@/components/form-primitives"
import { cn } from "@/lib/utils"

// 视角 + 演讲人合一 chip。日常 90% 场景默认就对，用户不会展开 popover。
// 当演讲人识别结果跟当前值不一致时，chip 右侧加一个不打扰的 dot 提示。

export const ROUTING_OPTIONS: { value: string; label: string; sub: string }[] = [
  { value: "/lecture",    label: "讲课 / 分享",   sub: "我在讲课、做分享" },
  { value: "/dialogue",   label: "受访嘉宾",     sub: "对谈里输出观点的一方是我" },
  { value: "/screencast", label: "录屏讲解",     sub: "我在录屏演示" },
  { value: "/meeting",    label: "主持 / 决策",  sub: "我在主持或做决策" },
  { value: "/default",    label: "AI 判断",      sub: "不确定，让 AI 看着办" },
]

const ROUTING_SHORT: Record<string, string> = {
  "/lecture": "讲课", "/dialogue": "受访", "/screencast": "录屏",
  "/meeting": "主持", "/default": "AI 判断",
}

export interface LauncherChipProps {
  routing: string
  onRoutingChange: (v: string) => void
  speaker: string
  onSpeakerChange: (v: string) => void
  // 启发式/AI 识别出的演讲人；用于"识别到 vs 当前值不一致"的不打扰提示
  detectedSpeaker?: string | null
  // 路由是否来自 source 自动建议（决定 chip 标签里是否露"已按内容建议"）
  routingAutoSuggested?: boolean
  onDetectSpeakerAI: () => void
  detectingSpeaker: boolean
  // chip 在表单 disabled 态下也走灰
  disabled?: boolean
}

export function LauncherChip(props: LauncherChipProps) {
  const [open, setOpen] = useState(false)
  const speakerDiffers =
    !!props.detectedSpeaker &&
    props.detectedSpeaker.trim() !== props.speaker.trim()

  const chip = (
    <button
      type="button"
      disabled={props.disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm transition-colors",
        "text-foreground/85 hover:bg-foreground/[0.05] hover:border-foreground/30",
        open && "bg-foreground/[0.08] border-foreground/15 text-foreground",
        props.disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span>{ROUTING_SHORT[props.routing] ?? "AI 判断"}</span>
      <span className="text-foreground/40">·</span>
      <span className="truncate max-w-[8rem]">{props.speaker || "我"}</span>
      {speakerDiffers && (
        <span
          className="size-1.5 rounded-full bg-warning"
          aria-label={`已识别为「${props.detectedSpeaker}」，可点击切换`}
        />
      )}
      <ChevronDown className="size-3.5 opacity-60" />
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {speakerDiffers ? (
          <Tooltip>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent>
              已识别为「{props.detectedSpeaker}」· 点击切换
            </TooltipContent>
          </Tooltip>
        ) : (
          chip
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          {/* 视角 */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">写作视角 · 文章里的「我」是谁</div>
            <div className="flex flex-col gap-0.5">
              {ROUTING_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => props.onRoutingChange(opt.value)}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    props.routing === opt.value
                      ? "bg-foreground/[0.08]"
                      : "hover:bg-foreground/[0.05]",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 mt-0.5 shrink-0",
                      props.routing === opt.value ? "text-foreground" : "opacity-0",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.sub}</div>
                  </div>
                </button>
              ))}
            </div>
            {props.routingAutoSuggested && (
              <div className="text-xs text-muted-foreground mt-1">已按文件名建议 · 可改</div>
            )}
          </div>

          {/* 演讲人 */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">演讲人 · 稿件里的主讲人 / 受访者</div>
            <div className="flex gap-2">
              <TextInput
                type="text"
                value={props.speaker}
                onChange={e => props.onSpeakerChange(e.target.value)}
                placeholder="我"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onDetectSpeakerAI}
                disabled={props.detectingSpeaker}
                title="用 AI 从源文识别演讲人"
              >
                {props.detectingSpeaker
                  ? <Loader2 className="animate-spin" data-icon="inline-start" />
                  : <Sparkle data-icon="inline-start" />}
                AI 识别
              </Button>
            </div>
            {speakerDiffers && (
              <div className="text-xs text-warning mt-1">
                已识别为「{props.detectedSpeaker}」· 不一致，确认或改
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

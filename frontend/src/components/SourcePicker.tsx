import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, FileText, FileAudio, Film, Clock, Search, Upload, Loader2 } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TextInput } from "@/components/form-primitives"
import { cn } from "@/lib/utils"

interface SourceItem {
  path: string
  kind: "transcript" | "text" | "video"
  label: string
  size: number
  mtime: number
}

interface SourcePickerProps {
  value: string
  onChange: (v: string) => void
  apiBase: string
  className?: string
  // 本机能否跑视频转录（后端 /health capabilities.transcription）。
  // 打包版（frozen，未内置转录引擎）为 false：视频源禁用 + 给降级说明。
  transcriptionAvailable?: boolean
  // 两扇门过滤：video 只列待转录视频；text 列转录稿+文字稿；不传则全列。
  filterKind?: "video" | "text"
}

const RECENT_KEY = "v2b_recent_sources"
const RECENT_MAX = 5

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function pushRecentSource(path: string) {
  try {
    const cur = readRecent().filter(p => p !== path)
    cur.unshift(path)
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)))
  } catch {
    /* ignore */
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 替代手动输入路径的源选择器。
 *   - 打开时拉 /sources,列出所有可用 raw.txt + input/Text/*
 *   - 顶部"最近使用" 5 条(localStorage)
 *   - 支持搜索过滤
 *   - 仍允许用户切换到手动输入模式(粘任意路径)
 */
export function SourcePicker({ value, onChange, apiBase, className, transcriptionAvailable = true, filterKind }: SourcePickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 上传素材：原始 body POST /upload，按扩展名落 input/Video|Text；浏览器 / Tauri 通用
  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const res = await fetch(apiBase + `/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { const j = await res.json(); if (typeof j?.detail === "string") detail = j.detail } catch { /* */ }
        throw new Error(detail)
      }
      const data: { path: string } = await res.json()
      onChange(data.path)
      pushRecentSource(data.path)
      setOpen(false)
    } catch (e) {
      setError(`上传失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setRecent(readRecent())
    setLoading(true)
    setError(null)
    fetch(apiBase + "/sources")
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: SourceItem[]) => setItems(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, apiBase])

  // 已选源是否在列表里(决定显示按钮里的 label)
  const selectedItem = useMemo(
    () => items.find(it => it.path === value),
    [items, value],
  )

  // 两扇门：video 门只显示待转录视频；text 门显示转录稿+文字稿
  const showVideos = filterKind !== "text"
  const showText = filterKind !== "video"

  // 把 items 按 kind 分组
  const videos = items.filter(i => i.kind === "video")
  const transcripts = items.filter(i => i.kind === "transcript")
  const texts = items.filter(i => i.kind === "text")
  const visibleCount = (showVideos ? videos.length : 0) + (showText ? transcripts.length + texts.length : 0)
  const recentItems = recent
    .map(p => items.find(i => i.path === p))
    .filter((i): i is SourceItem => i !== undefined)
    .filter(i => (i.kind === "video" ? showVideos : showText))

  if (manualMode) {
    return (
      <div className={cn("flex gap-2", className)}>
        <TextInput
          type="text"
          required
          placeholder="默认仅支持仓库内路径,如 work/<stem>/raw.txt 或 input/Text/*.txt"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 font-mono"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setManualMode(false)}>
          <Search data-icon="inline-start" />
          浏览
        </Button>
      </div>
    )
  }

  return (
    <>
    <input
      ref={fileRef}
      type="file"
      hidden
      accept={filterKind === "text" || !transcriptionAvailable
        ? ".txt,.md,.srt,.vtt"
        : filterKind === "video"
        ? ".mp4,.mov,.mkv,.m4v,.webm,.flv,.avi,video/*"
        : ".mp4,.mov,.mkv,.m4v,.webm,.flv,.avi,.txt,.md,.srt,.vtt,video/*"}
      onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }}
    />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          {value ? (
            <span className="flex items-center gap-2 min-w-0 flex-1">
              {selectedItem?.kind === "video" ? (
                <Film className="size-4 shrink-0 text-primary" />
              ) : selectedItem?.kind === "transcript" ? (
                <FileAudio className="size-4 shrink-0 text-primary" />
              ) : (
                <FileText className="size-4 shrink-0 text-primary" />
              )}
              <span className="truncate text-left">{selectedItem?.label ?? value}</span>
              {selectedItem && (
                <Badge variant="secondary" className="shrink-0 text-caption-sm font-normal">
                  {formatSize(selectedItem.size)}
                </Badge>
              )}
            </span>
          ) : (
            <span>选择素材文件…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索素材名…" />
          <CommandList className="max-h-[420px]">
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                正在扫描 work/ 与 input/Text/…
              </div>
            )}
            {error && (
              <div className="py-6 text-center text-sm text-destructive">
                加载失败: {error}
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-2 py-4 text-sm">
                  <span className="text-muted-foreground">还没有可选素材</span>
                  <span className="text-xs text-muted-foreground">
                    把视频转录稿放到 <code>work/&lt;stem&gt;/raw.txt</code>,
                    或文字稿放到 <code>input/Text/*.{`{txt,md,srt,vtt}`}</code>
                  </span>
                </div>
              </CommandEmpty>
            )}
            {!loading && !error && items.length > 0 && visibleCount === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {filterKind === "video" ? "没有待转录的视频 · 可上传或切到「文字稿」" : "没有文字稿 · 可上传或切到「视频」"}
              </div>
            )}

            {!loading && !error && recentItems.length > 0 && (
              <>
                <CommandGroup heading="最近使用">
                  {recentItems.map(item => (
                    <SourceRow
                      key={"recent-" + item.path}
                      item={item}
                      selected={value === item.path}
                      recent
                      onSelect={() => {
                        onChange(item.path)
                        setOpen(false)
                      }}
                    />
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {showVideos && videos.length > 0 && (
              <CommandGroup
                heading={
                  transcriptionAvailable
                    ? `待转录视频 · ${videos.length}（选中会先自动转录）`
                    : `待转录视频 · ${videos.length} · 打包版不支持转录`
                }
              >
                {!transcriptionAvailable && (
                  <div className="px-2 pb-1.5 text-caption-sm text-muted-foreground leading-relaxed">
                    打包版未内置转录引擎（mlx / whisper.cpp）。请改用下方「视频转录稿 / 文字稿」，
                    或在开发版（<code>make app</code>）里把视频转成文字稿。
                  </div>
                )}
                {videos.map(item => (
                  <SourceRow
                    key={item.path}
                    item={item}
                    selected={value === item.path}
                    disabled={!transcriptionAvailable}
                    onSelect={() => {
                      if (!transcriptionAvailable) return
                      onChange(item.path)
                      setOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
            )}

            {showText && transcripts.length > 0 && (
              <>
                {showVideos && videos.length > 0 && <CommandSeparator />}
                <CommandGroup heading={`视频转录稿 · ${transcripts.length}`}>
                {transcripts.map(item => (
                  <SourceRow
                    key={item.path}
                    item={item}
                    selected={value === item.path}
                    onSelect={() => {
                      onChange(item.path)
                      setOpen(false)
                    }}
                  />
                ))}
                </CommandGroup>
              </>
            )}

            {showText && texts.length > 0 && (
              <>
                {transcripts.length > 0 && <CommandSeparator />}
                <CommandGroup heading={`文字稿 · ${texts.length}`}>
                  {texts.map(item => (
                    <SourceRow
                      key={item.path}
                      item={item}
                      selected={value === item.path}
                      onSelect={() => {
                        onChange(item.path)
                        setOpen(false)
                      }}
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>

          {/* 上传 + 手动输入 */}
          <div className="border-t p-2 flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
              {uploading ? "上传中…"
                : filterKind === "video" ? "上传视频…"
                : filterKind === "text" ? "上传文字稿 / 字幕…"
                : transcriptionAvailable ? "上传视频 / 文字稿…" : "上传文字稿 / 字幕…"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-muted-foreground"
              onClick={() => {
                setManualMode(true)
                setOpen(false)
              }}
            >
              切换到手动输入仓库内路径…
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
    </>
  )
}

function SourceRow({ item, selected, recent, disabled, onSelect }: { item: SourceItem; selected: boolean; recent?: boolean; disabled?: boolean; onSelect: () => void }) {
  const Icon = item.kind === "video" ? Film : item.kind === "transcript" ? FileAudio : FileText
  return (
    <CommandItem
      onSelect={onSelect}
      disabled={disabled}
      className={cn("gap-2", disabled && "opacity-50 cursor-not-allowed")}
      value={item.path + " " + item.label}
    >
      {recent ? (
        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-primary" />
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{item.label}</div>
        <div className="truncate text-caption-sm text-muted-foreground">{item.path}</div>
      </div>
      <Badge variant="secondary" className="shrink-0 text-caption-sm font-normal h-5">
        {formatSize(item.size)}
      </Badge>
      {selected && <Check className="size-4 shrink-0 text-primary" />}
    </CommandItem>
  )
}

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, FileText, FileAudio, Clock, Search } from "lucide-react"
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
import { cn } from "@/lib/utils"

interface SourceItem {
  path: string
  kind: "transcript" | "text"
  label: string
  size: number
  mtime: number
}

interface SourcePickerProps {
  value: string
  onChange: (v: string) => void
  apiBase: string
  className?: string
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
export function SourcePicker({ value, onChange, apiBase, className }: SourcePickerProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [recent, setRecent] = useState<string[]>([])

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

  // 把 items 按 kind 分组
  const transcripts = items.filter(i => i.kind === "transcript")
  const texts = items.filter(i => i.kind === "text")
  const recentItems = recent
    .map(p => items.find(i => i.path === p))
    .filter((i): i is SourceItem => i !== undefined)

  if (manualMode) {
    return (
      <div className={cn("flex gap-2", className)}>
        <input
          type="text"
          required
          placeholder="默认仅支持仓库内路径,如 work/<stem>/raw.txt 或 input/Text/*.txt"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 bg-card border rounded-md py-2 px-3 text-sm font-mono focus:border-primary outline-none transition-colors"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setManualMode(false)}>
          <Search data-icon="inline-start" />
          浏览
        </Button>
      </div>
    )
  }

  return (
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
              {selectedItem?.kind === "transcript" ? (
                <FileAudio className="size-4 shrink-0 text-primary" />
              ) : (
                <FileText className="size-4 shrink-0 text-primary" />
              )}
              <span className="truncate text-left">{selectedItem?.label ?? value}</span>
              {selectedItem && (
                <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
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

            {transcripts.length > 0 && (
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
            )}

            {texts.length > 0 && (
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

          {/* 手动输入逃生口 */}
          <div className="border-t p-2">
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
  )
}

function SourceRow({ item, selected, recent, onSelect }: { item: SourceItem; selected: boolean; recent?: boolean; onSelect: () => void }) {
  const Icon = item.kind === "transcript" ? FileAudio : FileText
  return (
    <CommandItem onSelect={onSelect} className="gap-2" value={item.path + " " + item.label}>
      {recent ? (
        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-primary" />
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{item.label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{item.path}</div>
      </div>
      <Badge variant="secondary" className="shrink-0 text-[10px] font-normal h-5">
        {formatSize(item.size)}
      </Badge>
      {selected && <Check className="size-4 shrink-0 text-primary" />}
    </CommandItem>
  )
}

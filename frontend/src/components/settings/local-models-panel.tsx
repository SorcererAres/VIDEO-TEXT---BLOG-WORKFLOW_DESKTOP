import { useState, useEffect } from 'react'
import { Loader2, Trash2, Download, HardDrive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/ConfirmDialog'
import { apiUrl } from '@/lib/api'

// 小开关（无 shadcn Switch，自己拼一个 role=switch 的按钮）
export function MiniSwitch({ checked, onChange, title }: { checked: boolean; onChange: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  )
}

// ── 本地转录模型管理（设置 → 本地模型）──────────────────────────
interface LocalModel {
  name: string
  label: string
  size_mb: number
  downloaded: boolean
  local_mb: number
  is_default: boolean
  status?: string | null
  percent?: number | null
  error?: string | null
}

type Engine = "whisper-cpp" | "mlx"

function ModelRow({ m, onDownload, onRemove }: {
  m: LocalModel
  onDownload: () => void
  onRemove: () => void
}) {
  const downloading = m.status === "downloading"
  return (
    <div className="flex items-center gap-3 border rounded-lg p-3">
      <HardDrive className={cn("size-4 shrink-0", m.downloaded ? "text-primary" : "text-muted-foreground/40")} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-2">
          {m.label}
          {m.is_default && <Badge variant="secondary" className="text-caption-sm">默认</Badge>}
        </div>
        <div className="text-caption-sm text-muted-foreground">
          {downloading ? `下载中${m.percent != null ? ` ${m.percent}%` : "…"}`
            : m.status === "error" ? <span className="text-destructive">下载失败：{m.error}</span>
            : m.downloaded ? `已下载 · ${m.local_mb} MB`
            : `约 ${m.size_mb} MB`}
        </div>
      </div>
      {downloading ? (
        <div className="w-28 shrink-0">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${m.percent ?? 5}%` }} />
          </div>
        </div>
      ) : m.downloaded ? (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive shrink-0" onClick={onRemove}>
          <Trash2 data-icon="inline-start" /> 删除
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onDownload}>
          <Download data-icon="inline-start" /> 下载
        </Button>
      )}
    </div>
  )
}

export function LocalModelsPanel() {
  const [data, setData] = useState<{ whisper_cpp: LocalModel[]; mlx: LocalModel[] }>({ whisper_cpp: [], mlx: [] })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const r = await fetch(apiUrl("/api/local-models"))
      if (r.ok) {
        const d = await r.json()
        setData({ whisper_cpp: d.whisper_cpp || [], mlx: d.mlx || [] })
      }
    } catch { /* 离线时静默 */ }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 1500)  // 轮询下载进度
    return () => clearInterval(t)
  }, [])

  const download = async (name: string, engine: Engine) => {
    try {
      await fetch(apiUrl("/api/local-models/download"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, engine }),
      })
      load()
    } catch (e) { toast.error("启动下载失败", { description: String(e) }) }
  }

  const remove = async (m: LocalModel, engine: Engine) => {
    const ok = await confirmAction({
      title: `删除 ${m.label}？`,
      description: `将删除本地模型（${m.local_mb} MB）。需要时可重新下载。`,
      confirmText: "删除", variant: "destructive",
    })
    if (!ok) return
    try {
      await fetch(apiUrl("/api/local-models/delete"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: m.name, engine }),
      })
      load()
    } catch (e) { toast.error("删除失败", { description: String(e) }) }
  }

  const empty = data.whisper_cpp.length === 0 && data.mlx.length === 0
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 flex flex-col gap-6">
        {loading && empty ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            <Loader2 className="size-4 animate-spin inline mr-1.5" />加载…
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-2.5">
              <div>
                <h3 className="text-sm font-semibold">whisper.cpp</h3>
                <p className="text-caption-sm text-muted-foreground mt-0.5">
                  默认引擎 · Metal 加速 · 模型单文件。首次转录会自动下载默认档。
                </p>
              </div>
              {data.whisper_cpp.map(m => (
                <ModelRow key={m.name} m={m}
                  onDownload={() => download(m.name, "whisper-cpp")}
                  onRemove={() => remove(m, "whisper-cpp")} />
              ))}
            </section>
            <section className="flex flex-col gap-2.5">
              <div>
                <h3 className="text-sm font-semibold">mlx · Apple 原生</h3>
                <p className="text-caption-sm text-muted-foreground mt-0.5">
                  Apple Silicon 原生，质量略优。模型从 HuggingFace 下载到系统缓存。
                </p>
              </div>
              {data.mlx.map(m => (
                <ModelRow key={m.name} m={m}
                  onDownload={() => download(m.name, "mlx")}
                  onRemove={() => remove(m, "mlx")} />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

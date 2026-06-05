import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { confirmHistoricalDelete, HistoricalDeleteDialogHost } from '@/components/HistoricalDeleteDialog'
import { purgePostChain } from '@/lib/job-actions'
import { API_BASE } from '@/lib/api'

// 维护区（DECOUPLE Round 3 收尾）：作品「整链清除」的显式高危入口。
// 日常删作品走回收站（30 天可恢复）；这里是连 work/ 评分 / 索引 / 指纹一并清的彻底清除，
// 复用 HistoricalDeleteDialog 的 5 选面板 + lib/job-actions.purgePostChain（POST /api/maintenance/purge）。
interface MaintPost {
  final_post_path: string | null
  stem: string
  is_draft?: boolean
}

export function MaintenanceSection() {
  const [posts, setPosts] = useState<MaintPost[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await fetch(API_BASE + "/api/posts")
      if (res.ok) setPosts(await res.json())
    } catch (e) {
      console.error("加载作品列表失败", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const handlePurge = async (p: MaintPost) => {
    if (!p.final_post_path) {
      toast.error("无法清除", { description: "该作品缺少 final_post_path" })
      return
    }
    // 复用归档 5 选面板让用户挑要清的产物类别
    const sel = await confirmHistoricalDelete({ stem: p.stem, postPath: p.final_post_path })
    if (!sel) return
    try {
      const result = await purgePostChain({ post_path: p.final_post_path, ...sel })
      const msg = result.deleted.length ? `已清除 ${result.deleted.length} 项` : "无内容被清除"
      const errs = result.errors.length ? ` · ${result.errors.length} 项失败` : ""
      toast.success("彻底清除完成", { description: msg + errs })
      void reload()
    } catch (e) {
      toast.error("清除失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <ScrollArea className="flex-1">
      {/* 命令式 5 选面板的挂载点 —— 仅维护 tab 激活时存在 */}
      <HistoricalDeleteDialogHost />
      <div className="p-6 max-w-2xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">维护</h2>
          <p className="mt-1 text-caption-sm text-muted-foreground">
            作品的「整链清除」—— 连同评分 / 中间产物 / 索引 / 指纹一并删除。
          </p>
        </div>

        <Alert>
          <AlertTitle>先想清楚再动手</AlertTitle>
          <AlertDescription>
            日常删作品请用作品集卡片的删除（移 30 天回收站，可还原）。这里是维护用的彻底清除：
            post 之外的 work/ 评分 / 索引 / 指纹删了 <b>不可恢复</b>。
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="py-8 text-center text-caption-sm text-muted-foreground">加载中…</div>
        ) : posts.length === 0 ? (
          <div className="py-8 text-center text-caption-sm text-muted-foreground">没有可清除的作品。</div>
        ) : (
          <div className="flex flex-col gap-1">
            {posts.map((p) => (
              <div
                key={p.final_post_path ?? p.stem}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-caption-sm font-medium">{p.stem}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {p.final_post_path}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive hover:bg-destructive/10"
                  onClick={() => void handlePurge(p)}
                >
                  <Trash2 className="size-3.5" />
                  彻底清除
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

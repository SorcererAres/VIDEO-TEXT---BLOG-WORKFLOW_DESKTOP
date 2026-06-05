import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/form-primitives"
import { AlertTriangle } from "lucide-react"

// 归档任务删除：5 项产物多选面板。命令式模式（跟 ConfirmDialog 同款 host）。
// 用法：
//   const sel = await confirmHistoricalDelete({ stem, postPath })
//   if (sel) { await deleteHistoricalJob({ post_path, ...sel }) }

export interface HistoricalDeleteOptions {
  /** 归档 job stem，仅做展示 */
  stem: string
  /** 待删的 post 相对路径（output/Posts/<year>/<file>.md） */
  postPath: string
}

export interface HistoricalDeleteSelection {
  posts: boolean
  reviews: boolean
  work: boolean
  history_index: boolean
  fingerprints: boolean
}

interface InternalState extends HistoricalDeleteOptions {
  open: boolean
  resolve: (v: HistoricalDeleteSelection | null) => void
}

let setStateRef: ((s: InternalState | null) => void) | null = null

export function confirmHistoricalDelete(opts: HistoricalDeleteOptions): Promise<HistoricalDeleteSelection | null> {
  return new Promise(resolve => {
    if (!setStateRef) {
      // 没挂 host：拒绝（强一致 —— 不能静默调过去删了）
      resolve(null)
      return
    }
    setStateRef({ ...opts, open: true, resolve })
  })
}

export function HistoricalDeleteDialogHost() {
  const [state, setState] = React.useState<InternalState | null>(null)

  React.useEffect(() => {
    setStateRef = setState
    return () => {
      setStateRef = null
    }
  }, [])

  const close = (result: HistoricalDeleteSelection | null) => {
    if (!state) return
    state.resolve(result)
    setState({ ...state, open: false })
    window.setTimeout(() => setState(null), 200)
  }

  // Body 拆出去单独组件 —— Host 一直挂载，但 Body 跟着 state 出现/消失而 mount/unmount。
  // 每次打开 sel state 都 fresh init 到默认值，不会带上次的勾选。
  if (!state) return null
  return <DialogBody state={state} close={close} />
}

function DialogBody({ state, close }: {
  state: InternalState
  close: (r: HistoricalDeleteSelection | null) => void
}) {
  // 默认 —— posts / reviews 不勾（用户作品 + 评分最珍贵），其余勾上
  const [sel, setSel] = React.useState<HistoricalDeleteSelection>({
    posts: false,
    reviews: false,
    work: true,
    history_index: true,
    fingerprints: true,
  })

  const nothingChecked = !sel.posts && !sel.reviews && !sel.work && !sel.history_index && !sel.fingerprints

  return (
    <Dialog
      open={state.open}
      onOpenChange={open => {
        if (!open) close(null)
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive shrink-0" />
            <span>删除归档任务</span>
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            <code className="text-xs font-mono">{state.stem}</code>
            <br />
            选择要一并删除的产物。已删的内容<b>不可恢复</b>（作品集走 30 天回收站，其它直接删）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 py-1">
          <Checkbox
            label="作品集文章（output/Posts/）"
            hint="勾上会走 30 天回收站，可恢复"
            checked={sel.posts}
            onChange={v => setSel(s => ({ ...s, posts: v }))}
          />
          <Checkbox
            label="质检评分（output/Reviews/）"
            checked={sel.reviews}
            onChange={v => setSel(s => ({ ...s, reviews: v }))}
          />
          <Checkbox
            label="中间产物（work/<stem>/）"
            hint="清洗 / 提炼 / 骨架 / 草稿等"
            checked={sel.work}
            onChange={v => setSel(s => ({ ...s, work: v }))}
          />
          <Checkbox
            label="历史索引（memory/HISTORY.md）"
            checked={sel.history_index}
            onChange={v => setSel(s => ({ ...s, history_index: v }))}
          />
          <Checkbox
            label="风格指纹（memory/fingerprints.jsonl）"
            checked={sel.fingerprints}
            onChange={v => setSel(s => ({ ...s, fingerprints: v }))}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(null)}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={nothingChecked}
            onClick={() => close(sel)}
            title={nothingChecked ? "至少勾一项" : undefined}
          >
            删除选中项
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

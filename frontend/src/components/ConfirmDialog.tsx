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
import { AlertTriangle } from "lucide-react"

// 命令式 confirm —— 替代原生 window.confirm()。
// 用法: const ok = await confirmAction({ title: "...", description: "...", variant: "destructive" })
// 必须在 App 根挂一次 <ConfirmDialogHost />,否则会回退到 window.confirm。

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
}

interface InternalState extends ConfirmOptions {
  open: boolean
  resolve: (v: boolean) => void
}

let setStateRef: ((s: InternalState | null) => void) | null = null

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    if (!setStateRef) {
      // 兜底:host 还没挂载就直接回退,避免阻塞流程
      resolve(window.confirm(opts.title))
      return
    }
    setStateRef({ ...opts, open: true, resolve })
  })
}

export function ConfirmDialogHost() {
  const [state, setState] = React.useState<InternalState | null>(null)

  React.useEffect(() => {
    setStateRef = setState
    return () => {
      setStateRef = null
    }
  }, [])

  const handleClose = (result: boolean) => {
    if (!state) return
    state.resolve(result)
    setState({ ...state, open: false })
    // 留出 close 动画时间再彻底卸载,避免内容闪烁消失
    window.setTimeout(() => setState(null), 200)
  }

  if (!state) return null

  const isDestructive = state.variant === "destructive"

  return (
    <Dialog
      open={state.open}
      onOpenChange={open => {
        if (!open) handleClose(false)
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDestructive && <AlertTriangle className="size-4 text-destructive shrink-0" />}
            <span>{state.title}</span>
          </DialogTitle>
          {state.description && (
            <DialogDescription className="text-foreground/80">
              {state.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {state.cancelText ?? "取消"}
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            onClick={() => handleClose(true)}
            autoFocus
          >
            {state.confirmText ?? "确定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AppearanceSwitch } from '@/components/settings/llm-profile-form'

// 「外观」分区：把原来塞在右上角的 AppearanceSwitch 提升为独立设置项（macOS 系统设置那样
// 一行 label + 右侧控件，即改即生效，无保存按钮）。
export function AppearanceSection() {
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-8 py-7 flex flex-col gap-6">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">外观</h2>
          <p className="text-caption-sm text-muted-foreground mt-1">浅色 / 深色主题，或跟随系统自动切换。</p>
        </div>
        <div className="flex items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-sm font-medium">主题</div>
            <div className="text-xs text-muted-foreground mt-0.5">「系统」会随 macOS 外观自动在浅 / 深之间切换。</div>
          </div>
          <AppearanceSwitch />
        </div>
      </div>
    </ScrollArea>
  )
}

// 「关于」分区：应用名 + 版本号 + 检查更新（自动更新链路尚未接通，先放占位提示）。
export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(m => m.getVersion())
      .then(v => { if (!cancelled) setVersion(v) })
      .catch(() => { /* 浏览器降级 / 非 Tauri：不显示版本 */ })
    return () => { cancelled = true }
  }, [])
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-8 py-7 flex flex-col gap-6">
        <div>
          <h2 className="text-heading-sm font-semibold font-heading">关于</h2>
          <p className="text-caption-sm text-muted-foreground mt-1">把你讲过的，变成你署名写下的。</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 border-b pb-3">
            <div className="text-sm font-medium">应用</div>
            <div className="text-sm text-muted-foreground">Video2Blog</div>
          </div>
          <div className="flex items-center justify-between gap-4 border-b pb-3">
            <div className="text-sm font-medium">版本</div>
            <div className="text-sm text-muted-foreground font-mono">{version ? `v${version}` : "—"}</div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">检查更新</div>
              <div className="text-xs text-muted-foreground mt-0.5">自动更新尚未启用，当前请手动替换 .app。</div>
            </div>
            <Button variant="outline" size="sm" disabled>检查更新</Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

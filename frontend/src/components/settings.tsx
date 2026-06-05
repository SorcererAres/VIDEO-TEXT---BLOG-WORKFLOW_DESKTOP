import { useState } from 'react'
import { emit } from '@tauri-apps/api/event'
import {
  KeyRound,
  HardDrive,
  Palette,
  Info,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'
import { LocalModelsPanel } from '@/components/settings/local-models-panel'
import { MaintenanceSection } from '@/components/settings/maintenance-section'
import { SettingsForm } from '@/components/settings/llm-profile-form'
import { AppearanceSection, AboutSection } from '@/components/settings/sections'

// KnowledgeEditor 在「风格」场所（places.tsx）消费，从 settings.tsx 继续 re-export 保持公共 API 不变。
export { KnowledgeEditor } from '@/components/settings/knowledge-editor'

// 设置 = 模型/Key 配置 + 本地转录模型管理。写作知识库已归位到「风格」场所（IA ⑤）。
type SettingsTab = "llm" | "models" | "appearance" | "maintenance" | "about"

const SETTINGS_NAV: Array<{ key: SettingsTab; label: string; icon: LucideIcon }> = [
  { key: "llm", label: "模型与 API", icon: KeyRound },
  { key: "models", label: "本地转录模型", icon: HardDrive },
  { key: "appearance", label: "外观", icon: Palette },
  { key: "maintenance", label: "维护", icon: Wrench },
  { key: "about", label: "关于", icon: Info },
]

export function SettingsPanel({ onProfilesChanged, chrome }: { onProfilesChanged?: () => void; chrome?: boolean }) {
  const [tab, setTab] = useState<SettingsTab>("llm")
  return (
    <div className="flex-1 flex min-h-0">
      {/* 左竖 nav（参考 Claude Desktop）：顶部「设置」标题 + 中性灰底 active（不抢色，
          对齐 STYLE 表2 选中态）；icon 选中态也中性，珊瑚/黑只留给真正的 CTA。
          chrome=独立 overlay 设置窗：nav 顶部留一行容纳浮入的交通灯并可拖拽窗口。 */}
      <nav className="w-[210px] shrink-0 border-r bg-muted/30 flex flex-col gap-0.5 p-3 overflow-y-auto">
        {chrome && <div className="h-7 -mx-3 -mt-3 shrink-0" data-tauri-drag-region />}
        <div className="px-2.5 pt-1 pb-3 text-heading-sm font-semibold font-heading">设置</div>
        {SETTINGS_NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-caption-sm text-left transition-colors",
                active
                  ? "bg-foreground/[0.08] text-foreground font-medium"
                  : "text-foreground/80 hover:bg-foreground/[0.05]",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
              {label}
            </button>
          )
        })}
      </nav>
      {/* 右内容区 —— 子面板各自管自己的滚动/内边距 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "llm" && <SettingsForm onProfilesChanged={onProfilesChanged} embedded />}
        {tab === "models" && <LocalModelsPanel />}
        {tab === "appearance" && <AppearanceSection />}
        {tab === "maintenance" && <MaintenanceSection />}
        {tab === "about" && <AboutSection />}
      </div>
    </div>
  )
}

// 独立「设置」窗口的根组件（Tauri 第二窗口加载 index.html?window=settings 时渲染）。
// 复用同一个 SettingsForm；关闭=关窗；改了配置档→广播 profiles:changed 让主窗口回灌。
export function SettingsWindow() {
  return (
    <TooltipProvider>
      <Toaster position="top-right" theme="system" />
      <ConfirmDialogHost />
      <div className="app-root flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
        <div className="flex-1 min-h-0 flex">
          <SettingsPanel
            chrome
            onProfilesChanged={() => { emit("profiles:changed").catch(() => {}) }}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

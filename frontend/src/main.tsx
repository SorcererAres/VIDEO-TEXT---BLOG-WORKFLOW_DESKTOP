import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.tsx'
import { SettingsWindow } from './components/settings'

// 运行在 Tauri 壳内时给 <html> 挂 .tauri，CSS 据此开启 vibrancy 透出与交通灯留白；
// 浏览器直开则不挂，保持纯色不透明（降级可用）。
if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
  document.documentElement.classList.add("tauri")
}

// 独立设置窗口由 ?window=settings 标识（见 src-tauri 的 open_settings_window）。
const isSettingsWindow = new URLSearchParams(window.location.search).get("window") === "settings"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 跟随系统外观（浅/深/自动）——macOS 规范要求 App 尊重系统 appearance。
        attribute="class" 会在 <html> 上挂 .dark/.light，对接 index.css 既有 token。 */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {isSettingsWindow ? <SettingsWindow /> : <App />}
    </ThemeProvider>
  </StrictMode>,
)

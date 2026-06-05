import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '@/lib/utils'

// 自绘 macOS 交通灯。系统三按钮已在 Rust 端隐藏（lib.rs），这里自己画并接管点击。
// 圆底色 + 符号矢量 + 符号色 全部精确取自 Figma（node 461:263 / 457:337，viewBox 14×14）：
//   close ×：M4 4L10 10 / M10 4L4 10，符号色 #802E30（深红褐）
//   min  −：M3 7H11，符号色 #7E6400（深黄褐）
//   zoom 全屏双三角（带圆角），符号色 #1A642D（深绿）
// 聚焦显彩色圆 + hover 显符号；失焦统一灰 #DADAD9 + #D0D0CF 描边（浅底也勾出轮廓）。
function Glyph({ kind, color }: { kind: 'close' | 'min' | 'zoom'; color: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className="size-full">
      {kind === 'close' && (
        <>
          <path d="M4.5 4.5L9.5 9.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M9.5 4.5L4.5 9.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === 'min' && <path d="M4 7H10" stroke={color} strokeWidth="2" strokeLinecap="round" />}
      {kind === 'zoom' && (
        <>
          <path d="M5 4H9L4 9V5C4 4.44772 4.44772 4 5 4Z" fill={color} />
          <path d="M9 10H5L10 5V9C10 9.55228 9.55228 10 9 10Z" fill={color} />
        </>
      )}
    </svg>
  )
}

export function TrafficLights() {
  const [focused, setFocused] = useState(true)

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined
    win.isFocused().then(setFocused).catch(() => {})
    win
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then(f => { unlisten = f })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  const win = getCurrentWindow()
  const lights = [
    { kind: 'close' as const, fill: '#FF736A', glyph: '#802E30', onClick: () => { void win.close() } },
    { kind: 'min' as const, fill: '#FEBC2E', glyph: '#7E6400', onClick: () => { void win.minimize() } },
    { kind: 'zoom' as const, fill: '#19C332', glyph: '#1A642D', onClick: () => { void win.toggleMaximize() } },
  ]

  return (
    <div
      className="absolute top-[18px] left-[18px] z-50 flex items-center gap-[9px] p-px group"
      data-tauri-drag-region={false}
    >
      {lights.map(({ kind, fill, glyph, onClick }) => (
        <button
          key={kind}
          type="button"
          onClick={onClick}
          data-tauri-drag-region={false}
          aria-label={kind === 'close' ? '关闭' : kind === 'min' ? '最小化' : '缩放'}
          className="relative size-[14px] rounded-full"
          style={{
            backgroundColor: focused ? fill : '#DADAD9',
            boxShadow: focused
              ? 'inset 0 0 0 0.5px rgba(0,0,0,0.1)'
              : 'inset 0 0 0 0.5px #D0D0CF',
          }}
        >
          <span
            className={cn(
              'absolute inset-0',
              focused ? 'opacity-0 group-hover:opacity-100 transition-opacity' : 'opacity-0',
            )}
          >
            <Glyph kind={kind} color={glyph} />
          </span>
        </button>
      ))}
    </div>
  )
}

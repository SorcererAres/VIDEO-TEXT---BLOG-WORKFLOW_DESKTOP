import { useState, useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// 可收起的安静侧栏（Claude recents 气质）的布局逻辑：展开态 + 宽度拖拽 + 收起态 hover-preview。
// 从 App.tsx 抽离为自定义 hook —— 完全自洽，不依赖 App 的其它状态。
// 返回 state 与 handlers 供 App 的 JSX 直接绑定；setSidebarOpen 暴露给键盘 Cmd+\ 切换用。
export function useSidebarLayout() {
  // 可收起的安静侧栏（Claude recents 气质）—— 状态持久化
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("v2b_sidebar_open") !== "0")
  useEffect(() => { localStorage.setItem("v2b_sidebar_open", sidebarOpen ? "1" : "0") }, [sidebarOpen])

  // 侧栏宽度（Claude 风格的拖拽）—— min 200 / default 256 / max 440；
  // 拖到 <180 自动 snap-collapse（松手时正式 setSidebarOpen(false)，避免拖动中抖动）。
  const SIDEBAR_WIDTH_MIN = 200
  const SIDEBAR_WIDTH_MAX = 440
  const SIDEBAR_WIDTH_DEFAULT = 256
  const SIDEBAR_COLLAPSE_THRESHOLD = 180
  const readSidebarWidth = (): number => {
    try {
      const v = parseInt(localStorage.getItem("v2b_sidebar_width") || "", 10)
      if (Number.isFinite(v) && v >= SIDEBAR_WIDTH_MIN && v <= SIDEBAR_WIDTH_MAX) return v
    } catch { /* ignore */ }
    return SIDEBAR_WIDTH_DEFAULT
  }
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)
  const sidebarRef = useRef<HTMLElement>(null)
  const collapseOnDragEndRef = useRef(false)
  useEffect(() => {
    // 只把"有效宽度"（≥ min）写回，避免存了一个会触发 auto-collapse 的小值
    if (sidebarWidth >= SIDEBAR_WIDTH_MIN) {
      localStorage.setItem("v2b_sidebar_width", String(sidebarWidth))
    }
  }, [sidebarWidth])

  const startSidebarDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    const aside = sidebarRef.current
    if (!aside) return
    const left = aside.getBoundingClientRect().left
    const widthAtStart = sidebarWidth // 缓存拖前的宽度：snap-collapse 时把它复原，下次展开恢复用户上次的舒服宽度
    collapseOnDragEndRef.current = false
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => {
      const raw = ev.clientX - left
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
        // 视觉上贴 min 不再变窄（给"再窄要 collapse"的清晰反馈），标记 collapseOnDragEnd
        collapseOnDragEndRef.current = true
        setSidebarWidth(SIDEBAR_WIDTH_MIN)
      } else {
        collapseOnDragEndRef.current = false
        setSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, raw)))
      }
    }
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      if (collapseOnDragEndRef.current) {
        // 折叠前复原宽度，避免下次展开看到一个被"挤窄"的 200px
        setSidebarWidth(widthAtStart)
        collapseSidebar()
      }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }
  const resetSidebarWidth = () => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)

  // 收起态 hover-preview（Claude Desktop 风）：!sidebarOpen 时 hover hamburger 或 sidebar
  // 自身 → sidebar 滑出 overlay 主区上方；鼠标离开 150ms 后收回（防抖避开"穿过空白闪烁"）。
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }
  const openHover = () => {
    cancelHoverClose()
    setSidebarHovered(true)
  }
  const scheduleHoverClose = () => {
    cancelHoverClose()
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setSidebarHovered(false)
      hoverCloseTimerRef.current = null
    }, 150)
  }
  // 点 hamburger 钉住 sidebar：清掉 hover 态避免 stale；pinning 完成后正常 in-flow 布局
  const pinSidebar = () => {
    cancelHoverClose()
    setSidebarHovered(false)
    setSidebarOpen(true)
  }
  // 收起 sidebar：同步清 hover state，避免点完收起鼠标停在原位 hover 又冒回来
  const collapseSidebar = () => {
    cancelHoverClose()
    setSidebarHovered(false)
    setSidebarOpen(false)
  }
  useEffect(() => cancelHoverClose, []) // unmount 清 timer

  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    sidebarRef,
    sidebarHovered,
    startSidebarDrag,
    resetSidebarWidth,
    openHover,
    scheduleHoverClose,
    pinSidebar,
    collapseSidebar,
  }
}

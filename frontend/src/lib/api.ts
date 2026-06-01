// 后端 URL 解析层。
//
// 三种来源（按优先级）：
//   1. VITE_VIDEO2BLOG_API_BASE（开发/headless 显式覆盖）
//   2. Tauri sidecar 握手：壳内 invoke get_backend_url 拿运行时端口
//      （Python 后端 --auto-port 可能落在 8765..8828 任意一位）
//   3. fallback http://127.0.0.1:8765（浏览器直开 + 不在 Tauri 的降级）
//
// `export let` 让 import 端拿 live binding；initBackendUrl() 在 Tauri 环境下
// 异步把它 override 成 Rust 协商出来的真实 URL。main.tsx 启动时 await 一次，
// 再 mount React，保证组件首次 fetch 时 API_BASE 已经是最终值。

const FALLBACK_BASE = "http://127.0.0.1:8765"
const ENV_BASE = (import.meta.env.VITE_VIDEO2BLOG_API_BASE as string | undefined)?.replace(/\/$/, "")

export let API_BASE: string = ENV_BASE ?? FALLBACK_BASE

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window
}

// 冻结后端冷启动 ~8s，prod 首次还叠加 Gatekeeper 校验，可能十几秒。
// 所以：拿到即停；首屏最多等 5s 就先放行（不让用户盯白屏）；后台续轮询
// 到 60s 上限——因为 API_BASE 是 live binding，晚 ready 也能让 App 的
// health 轮询自动切到真实端口。
export async function initBackendUrl(): Promise<void> {
  // ENV 显式覆盖最强，跳过握手
  if (ENV_BASE) return
  if (!isTauri()) return

  const { invoke } = await import("@tauri-apps/api/core")

  return new Promise<void>((resolve) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      resolve()
    }
    // 首屏兜底：5s 没拿到也先 mount，后台轮询继续
    const firstScreen = setTimeout(release, 5000)

    let tries = 0
    const tick = async () => {
      tries++
      try {
        const url = await invoke<string | null>("get_backend_url")
        if (url) {
          API_BASE = url.replace(/\/$/, "")
          clearTimeout(firstScreen)
          release()
          return // 拿到，停止轮询
        }
      } catch (e) {
        console.warn("[api] get_backend_url failed", e)
      }
      if (tries < 240) {
        setTimeout(tick, 250) // 最多 60s（240 × 250ms）
      } else {
        console.warn("[api] Tauri sidecar 60s 内未 ready，沿用 fallback", FALLBACK_BASE)
        release()
      }
    }
    void tick()
  })
}

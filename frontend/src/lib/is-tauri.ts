// 是否运行在 Tauri 壳内（决定交通灯留白 / vibrancy / 系统通知等原生壳专属处理）
export const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export const API_BASE =
  import.meta.env.VITE_VIDEO2BLOG_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8765"

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
}

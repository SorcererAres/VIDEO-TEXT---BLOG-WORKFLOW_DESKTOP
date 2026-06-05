import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 把毫秒时间戳转成「刚刚 / X 秒前 / X 分钟前 / X 小时前 / X 天前」。
// OutlineView / DraftReviewView 草稿恢复 banner 用。
// PR #3 从已废的 CreateForm.tsx 搬到这里。
export function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 30) return "刚刚"
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

import { useCallback, useState } from "react"
import { API_BASE } from "./api"
import type { EngineJob } from "./job-types"

/**
 * 作品域 store（DECOUPLE Round 2）。
 *
 * 把原先内联在 App.tsx 的 `historicalJobs` state + `fetchHistory` 抽出。数据源
 * 切到 Round 1 新增的 `/api/posts`（与旧 `/jobs/history` 返回字节一致）。
 *
 * 注：当前仍复用 EngineJob 形状（带 kind="historical" 等 legacy 旁路字段），
 * 等 Round 3 删除语义重写后再渐进收敛到 Post 原生模型。
 */
export function usePosts() {
  const [posts, setPosts] = useState<EngineJob[]>([])

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + "/api/posts")
      if (res.ok) {
        const data: EngineJob[] = await res.json()
        setPosts(data)
      }
    } catch (e) {
      console.error("Failed to fetch posts", e)
    }
  }, [])

  return { posts, setPosts, fetchPosts }
}

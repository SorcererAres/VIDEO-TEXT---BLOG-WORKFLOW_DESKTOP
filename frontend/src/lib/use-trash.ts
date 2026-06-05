import { useCallback, useState } from "react"
import { listTrashPosts, type TrashPost } from "./trash-actions"

/**
 * 回收站域 store（DECOUPLE Round 2）。
 *
 * 把原先内联在 App.tsx 的 `trashPosts` state + `fetchTrash` 抽出。
 * 端点仍是 /trash/posts —— 回收站本就是独立域，Round 1/2 不动它。
 */
export function useTrash() {
  const [trashPosts, setTrashPosts] = useState<TrashPost[]>([])

  const fetchTrash = useCallback(async () => {
    try {
      const list = await listTrashPosts()
      setTrashPosts(list)
    } catch (e) {
      console.error("Failed to fetch trash", e)
    }
  }, [])

  return { trashPosts, setTrashPosts, fetchTrash }
}

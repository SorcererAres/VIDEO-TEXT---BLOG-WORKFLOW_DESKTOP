// Launcher 命令式输入解析。把 `deepseek-v3 dialogue work/2025-06-01/raw.txt force` 这样的
// 一行 token 串拆成 Partial<LauncherSubmitPayload>。
//
// 设计原则：
//   - 纯函数，零副作用，便于单测
//   - 未识别的 token 静默忽略（不当 source）；至少识别到 source 才返回非 null
//   - 关键词中英双语；profile 名按精确匹配（避免误吞通名）
import type { LlmProfile } from "./settings-store"

export type LauncherSubmitPayload = {
  source: string
  speaker: string
  routing: string
  pause_on_outline: boolean
  max_retries?: number
  force?: boolean
  rewrite_strategy?: "single" | "sectioned"
  profile_id?: string
  transcribe_engine?: "default" | "whisper-cpp" | "mlx"
  mode?: "quick"
}

// 路由关键词（中英）。值是 WORKFLOW.md 的 routing slug。
const ROUTING_KEYWORDS: Record<string, string> = {
  lecture: "/lecture", 讲课: "/lecture", 分享: "/lecture", talk: "/lecture",
  dialogue: "/dialogue", 对谈: "/dialogue", 访谈: "/dialogue", 嘉宾: "/dialogue", interview: "/dialogue",
  screencast: "/screencast", 录屏: "/screencast", demo: "/screencast",
  meeting: "/meeting", 会议: "/meeting", 复盘: "/meeting",
  default: "/default",
}

// 看起来像路径就当 source 候选。命中任一即认。
// - 仓库内相对路径（work/... / input/...）
// - 含已知扩展名（视频 / 文字 / 字幕）
// - 含路径分隔符
const PATH_HINT_RE = /^(work\/|input\/|\.\/|\/|[a-zA-Z]:\\)/
const KNOWN_EXT_RE = /\.(mp4|mov|m4v|mkv|webm|flv|avi|txt|md|srt|vtt)$/i
function looksLikePath(tok: string): boolean {
  if (PATH_HINT_RE.test(tok)) return true
  if (KNOWN_EXT_RE.test(tok)) return true
  if (tok.includes("/") && !tok.startsWith("--")) return true
  return false
}

// 主入口：text 里按空白拆 token，按规则吃。
// 没识别到 source 时返回 null（调用方应当作普通搜索/路径输入处理）。
export function parseLauncherCommand(
  text: string,
  profiles: LlmProfile[] = [],
): Partial<LauncherSubmitPayload> | null {
  const raw = text.trim()
  if (!raw) return null
  // 单 token 且不含空格 —— 多半是手输路径或普通搜索，让上层走自己的路径处理
  if (!/\s/.test(raw)) {
    if (looksLikePath(raw)) return { source: raw }
    return null
  }

  const tokens = raw.split(/\s+/)
  const out: Partial<LauncherSubmitPayload> = {}

  // profile 精确名匹配 —— 用小写比，profile.name 通常包含 provider 信息
  const profileByName = new Map(profiles.filter(p => p.enabled).map(p => [p.name.toLowerCase(), p]))

  for (const tok of tokens) {
    const lo = tok.toLowerCase()

    // 1) 路由关键词
    if (lo in ROUTING_KEYWORDS) { out.routing = ROUTING_KEYWORDS[lo]; continue }

    // 2) profile 名（按 name 精确）
    const p = profileByName.get(lo)
    if (p) { out.profile_id = p.id; continue }

    // 3) 裸开关
    if (lo === "quick") { out.mode = "quick"; continue }
    if (lo === "force") { out.force = true; continue }
    if (lo === "sectioned") { out.rewrite_strategy = "sectioned"; continue }
    if (lo === "single") { out.rewrite_strategy = "single"; continue }
    if (lo === "mlx") { out.transcribe_engine = "mlx"; continue }
    if (lo === "whisper" || lo === "whisper-cpp") { out.transcribe_engine = "whisper-cpp"; continue }

    // 4) --retries=N / --max-retries=N
    const m = tok.match(/^--(?:max-)?retries=(\d+)$/)
    if (m) { out.max_retries = Math.max(0, Math.min(3, parseInt(m[1], 10))); continue }

    // 5) 路径候选 —— 第一个匹配的当 source
    if (!out.source && looksLikePath(tok)) {
      out.source = tok
      continue
    }
  }

  // 没识别到 source —— 命令无效，让调用方按普通搜索/输入处理
  if (!out.source) return null
  return out
}

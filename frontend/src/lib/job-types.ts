// 共享的"任务" data types + 跨视图的小工具
// App.tsx (orchestrator) 和 components/jobs.tsx 都从这里拿，避免循环依赖。

export interface EngineJobRequest {
  source: string
  speaker: string
  routing: string
  mode: string
  max_retries: number
  model?: string
  api_base?: string
  force: boolean
  pause_on_outline: boolean
  api_key?: string
  // §9-C: single (默认) | sectioned。后端会在非 full / outline 不可解析时自动回退 single。
  rewrite_strategy?: "single" | "sectioned"
}

export interface EngineJob {
  id: string
  status: string
  request: EngineJobRequest
  stem: string
  created_at: string
  updated_at: string
  final_post_path?: string
  review_path?: string
  clean_path?: string
  insights_path?: string
  outline_path?: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
  error?: string
  // status==="paused" 时进一步说明在哪个人工节点：
  //   "WAITING_USER_OUTLINE" → Step 5 大纲审批
  //   "WAITING_USER_REVIEW"  → Step 7 草稿审批
  // 不用磁盘上是否有 draft 内容反推，避免被上一轮残留文件误导（真实撞过的 UI bug）。
  paused_state?: "WAITING_USER_OUTLINE" | "WAITING_USER_REVIEW" | null
  // 历史归档专属字段 —— /jobs/history 返回的对象会有这两个
  kind?: "historical"
  pass_score?: string
  is_draft?: boolean
}

export interface QualityScores {
  [key: string]: number
}

export interface ReviewJson {
  version: number
  verdict: string
  scores: QualityScores
  total: string
  rebrief: string
  raw_markdown?: string
  parse_failed?: boolean
}

// 常用 LLM 模型 chips —— FailureBanner 的"换模型重跑"用，App.tsx 提交前 sanity check 也用
export const COMMON_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-latest",
] as const

// 给一个错误字符串归类,推断最可能的根因 + 给用户可读的提示
export type DiagnosisKind = "model_not_found" | "auth" | "forbidden" | "timeout" | "missing_key" | "rate_limit" | "unknown"
export function classifyDiagnosis(err: string): { kind: DiagnosisKind; hint: string } {
  const lower = err.toLowerCase()
  if ((lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"))) || lower.includes("invalid_model")) {
    return { kind: "model_not_found", hint: "模型名不存在 —— 检查 Settings 中的「默认模型」,改用常见模型 chip 一键填入" }
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("invalid_api_key")) {
    return { kind: "auth", hint: "API Key 错误或已失效 —— 在 Settings 重新填写并保存" }
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
    return { kind: "forbidden", hint: "API Key 没有该模型的访问权限 —— 换个有权限的 model,或确认账户已开通" }
  }
  if (lower.includes("429") || lower.includes("rate") || lower.includes("quota") || lower.includes("limit")) {
    return { kind: "rate_limit", hint: "触发了速率/配额限制 —— 等几分钟再试,或换 API Key" }
  }
  if (lower.includes("缺失 api key") || lower.includes("missing")) {
    return { kind: "missing_key", hint: "完全没配 API Key —— 到 Settings 填一个" }
  }
  if (lower.includes("timeout") || lower.includes("连接超时") || lower.includes("超时") || lower.includes("超过总耗时") || lower.includes("ssl") || lower.includes("eof")) {
    return { kind: "timeout", hint: "API Base 不可达,或模型名错导致服务端 hang(部分 API 不返回 4xx 而是不响应)" }
  }
  return { kind: "unknown", hint: "看下方原文判断" }
}

// 把 ISO 或 'YYYY-MM-DD HH:MM:SS' 时间字符串转成"刚刚 / X 分钟前 / 今天 14:30 / 5/26"
export function formatRelativeOrAbsolute(ts: string | undefined | null): string {
  if (!ts) return ""
  const t = new Date(ts.replace(" ", "T"))
  if (isNaN(t.getTime())) return ts
  const diff = (Date.now() - t.getTime()) / 1000
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) {
    const today = new Date()
    const sameDay = t.getDate() === today.getDate() && t.getMonth() === today.getMonth() && t.getFullYear() === today.getFullYear()
    if (sameDay) return `今天 ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`
    return `${Math.floor(diff / 3600)} 小时前`
  }
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return `${t.getMonth() + 1}/${t.getDate()}`
}

// "https://api.deepseek.com/v1" → "api.deepseek.com" —— Header chip 用
export function shortApiBase(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).host
  } catch {
    return url.length > 30 ? url.slice(0, 30) + "…" : url
  }
}

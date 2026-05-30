import { apiUrl } from "./api"

// ── Provider 预设：选中自动填 Base URL + 推荐 model；Claude 等非 OpenAI 原生协议走「自定义」+ 自有兼容网关 ──
export const PROVIDER_PRESETS = {
  deepseek: { label: "DeepSeek", apiBase: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  openai: { label: "OpenAI", apiBase: "https://api.openai.com/v1", models: ["gpt-4o", "gpt-4o-mini"] },
  custom: { label: "自定义", apiBase: "", models: ["claude-3-5-sonnet-latest"] },
} as const

export type ProviderId = keyof typeof PROVIDER_PRESETS

// 从 api_base 反推 provider，用于回填已存配置时高亮对应预设。
export function inferProviderId(apiBase: string | null | undefined): ProviderId {
  if (!apiBase) return "deepseek"
  if (apiBase.includes("deepseek")) return "deepseek"
  if (apiBase.includes("openai.com")) return "openai"
  return "custom"
}

// ── 配置档的安全快照（GET /api/llm-profiles 返回，绝不含明文 key）──
export interface LlmProfile {
  id: string
  name: string
  provider: string
  api_base: string
  model: string
  temperature: number
  max_tokens: number
  thinking: "default" | "on" | "off"
  enabled: boolean
  has_key: boolean
  key_source: "keychain" | "env" | "request" | "none"
  key_suffix: string | null
}

export interface ProfilesSnapshot {
  profiles: LlmProfile[]
  defaultProfileId: string | null
  keyring_available: boolean
  env_key_present: boolean
  created_id?: string
  message?: string
}

// /api/test-llm 的响应结构 —— Settings「测试连接」+ 失败自动归因 banner 都用
export interface TestLLMResult {
  ok: boolean
  model?: string
  api_base?: string
  latency_ms?: number
  sample?: string
  error?: string
  key_source?: string
}

// POST/PUT 入参：仅在用户输入新 key 时带 api_key，省略则后端保留原 key。
export interface LlmProfilePatch {
  name?: string
  provider?: string
  api_base?: string
  model?: string
  temperature?: number
  max_tokens?: number
  thinking?: "default" | "on" | "off"
  enabled?: boolean
  api_key?: string
}

async function readJsonOrThrow(res: Response): Promise<ProfilesSnapshot> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const d = await res.json()
      if (typeof d?.detail === "string") detail = d.detail
    } catch {
      /* 非 JSON 响应 */
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function listProfiles(): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(await fetch(apiUrl("/api/llm-profiles")))
}

export async function createProfile(patch: LlmProfilePatch): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(
    await fetch(apiUrl("/api/llm-profiles"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function updateProfile(id: string, patch: LlmProfilePatch): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(
    await fetch(apiUrl(`/api/llm-profiles/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  )
}

export async function deleteProfile(id: string): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(await fetch(apiUrl(`/api/llm-profiles/${id}`), { method: "DELETE" }))
}

export async function setDefaultProfile(id: string): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(await fetch(apiUrl(`/api/llm-profiles/${id}/default`), { method: "POST" }))
}

export async function deleteProfileKey(id: string): Promise<ProfilesSnapshot> {
  return readJsonOrThrow(await fetch(apiUrl(`/api/llm-profiles/${id}/key`), { method: "DELETE" }))
}

// ── 写作知识库（合同/知识层文件编辑）──
export interface KnowledgeItem {
  path: string
  label: string
  desc: string
  exists: boolean
  danger?: boolean
}
export interface KnowledgeGroup {
  group: string
  advanced?: boolean
  items: KnowledgeItem[]
}
export interface KnowledgeSaveResult {
  ok: boolean
  errors: string[]
  path: string
}

export async function listKnowledgeFiles(): Promise<KnowledgeGroup[]> {
  const res = await fetch(apiUrl("/knowledge-files"))
  if (!res.ok) throw new Error(`GET /knowledge-files 失败: HTTP ${res.status}`)
  return res.json()
}

export async function readKnowledgeFile(path: string): Promise<string> {
  const res = await fetch(apiUrl(`/knowledge-file?path=${encodeURIComponent(path)}`))
  if (!res.ok) throw new Error(`读取失败: HTTP ${res.status}`)
  return (await res.json()).content ?? ""
}

export async function saveKnowledgeFile(path: string, content: string): Promise<KnowledgeSaveResult> {
  const res = await fetch(apiUrl("/knowledge-file"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const d = await res.json(); if (typeof d?.detail === "string") detail = d.detail } catch { /* */ }
    throw new Error(detail)
  }
  return res.json()
}

// ── 旧版浏览器明文 key 迁移：检测残留 v2b_api_key（最早期实现写的明文），引导导入为配置档 ──
const LS_LEGACY_KEY = "v2b_api_key"

export function readLegacyKey(): string | null {
  const v = localStorage.getItem(LS_LEGACY_KEY)
  return v && v.trim() ? v.trim() : null
}

export function clearLegacyKey(): void {
  localStorage.removeItem(LS_LEGACY_KEY)
  // 顺手清掉早期非敏感缓存键
  localStorage.removeItem("v2b_api_base")
  localStorage.removeItem("v2b_model")
  localStorage.removeItem("v2b_provider")
}

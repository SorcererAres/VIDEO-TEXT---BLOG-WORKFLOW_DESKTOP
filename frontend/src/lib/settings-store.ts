export interface LlmSettings {
  apiKey: string
  apiBase: string
  model: string
}

export function readLlmSettings(): LlmSettings {
  return {
    apiKey: localStorage.getItem("v2b_api_key") || "",
    apiBase: localStorage.getItem("v2b_api_base") || "",
    model: localStorage.getItem("v2b_model") || "",
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  localStorage.setItem("v2b_api_key", settings.apiKey.trim())
  localStorage.setItem("v2b_api_base", settings.apiBase.trim())
  localStorage.setItem("v2b_model", settings.model.trim())
}

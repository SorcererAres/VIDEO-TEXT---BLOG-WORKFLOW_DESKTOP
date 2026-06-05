// 任务失败的自动归因 hook + 失败 banner。
// 从 jobs.tsx 原样搬出，零行为变更。
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  AlertCircle,
  Loader2,
  Copy,
  Edit,
  RotateCw,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { API_BASE } from '@/lib/api'
import { type TestLLMResult } from '@/lib/settings-store'
import {
  classifyDiagnosis,
  type EngineJob,
} from '@/lib/job-types'

// ═══════════════════ Failure Diagnosis Hook ═══════════════════
// 任务失败时自动用 task 的配置打一次 /api/test-llm,把"配置错还是网络问题"立刻定位。
// 每个 job.id 只跑一次,不重复浪费请求。
export function useFailureDiagnosis(job: EngineJob | null): { diagnosis: TestLLMResult | null; isDiagnosing: boolean } {
  const [diagnosis, setDiagnosis] = useState<TestLLMResult | null>(null)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const runForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!job || job.status !== "failed") {
      setDiagnosis(null)
      setIsDiagnosing(false)
      runForRef.current = null
      return
    }
    if (runForRef.current === job.id) return
    runForRef.current = job.id
    setIsDiagnosing(true)
    setDiagnosis(null)

    // api_key 不再从前端取 —— 后端按优先级链（环境变量 > 钥匙串 / config）自行解析。
    const body = {
      api_base: job.request.api_base,
      model: job.request.model,
    }
    fetch(API_BASE + "/api/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async r => {
        if (r.status === 404) {
          return { ok: false, error: "后端版本过旧,/api/test-llm 端点未注册" } as TestLLMResult
        }
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` } as TestLLMResult
        return r.json() as Promise<TestLLMResult>
      })
      .then(data => setDiagnosis(data))
      .catch(e => setDiagnosis({ ok: false, error: String(e) }))
      .finally(() => setIsDiagnosing(false))
  }, [job?.id, job?.status, job])

  return { diagnosis, isDiagnosing }
}

// ═══════════════════ Failure Banner ═══════════════════
// 任务失败时把 job.error 顶到醒目位置,不让用户在日志里挖。
// 关键体验:**自动归因** —— 用任务的 model/api_base + 本地 api_key 立刻 ping 一次 /api/test-llm,
// 把"是配置错还是网络抽风"这个核心问题在 banner 里直接回答掉。
export function FailureBanner({
  error,
  diagnosis,
  isDiagnosing,
  onCopy,
  onRetry,
  onOpenSettings,
}: {
  error: string
  diagnosis: TestLLMResult | null
  isDiagnosing: boolean
  onCopy: (t: string) => void
  onRetry: () => void
  onOpenSettings: () => void
}) {
  // 把诊断结果归类成一句"用户语言"的提示
  const diagnosisHint = useMemo(() => {
    if (!diagnosis) return null
    if (diagnosis.ok) {
      return {
        tone: "neutral" as const,
        title: "LLM 配置本身可用",
        body: `用相同配置 ping 成功 (${diagnosis.latency_ms ?? "?"}ms,model=${diagnosis.model || "?"})。
超时大概率是本次任务级别的问题:提示词过长 / 模型一时负载高 / 或单次响应耗时超过 90s。建议重试。`,
      }
    }
    const cls = classifyDiagnosis(diagnosis.error || "")
    return {
      tone: "actionable" as const,
      title: `根因高度疑似:${cls.kind === "model_not_found" ? "模型名错误"
        : cls.kind === "auth" ? "API Key 错误"
        : cls.kind === "forbidden" ? "权限不足"
        : cls.kind === "rate_limit" ? "速率/配额限制"
        : cls.kind === "missing_key" ? "未配 API Key"
        : cls.kind === "timeout" ? "API 不可达 / 模型可能不存在"
        : "未知"}`,
      body: cls.hint,
    }
  }, [diagnosis])

  return (
    <Alert variant="destructive" className="mt-3">
      <AlertCircle />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>任务失败</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onCopy(error)} className="h-7">
            <Copy data-icon="inline-start" />
            复制错误
          </Button>
          <Button size="sm" onClick={onRetry} className="h-7">
            <RotateCw data-icon="inline-start" />
            以相同参数重跑
          </Button>
        </div>
      </AlertTitle>
      <AlertDescription>
        <pre className="mt-1 text-xs whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
          {error}
        </pre>

        {/* 自动诊断结果区块 —— 把"为什么超时"这个核心问题尽量回答出来 */}
        <div className="mt-3 p-2.5 rounded border bg-card/60">
          <div className="flex items-center gap-2 text-xs font-semibold mb-1">
            <span>🔍 自动诊断</span>
            {isDiagnosing && <Loader2 className="size-3 animate-spin" />}
          </div>
          {isDiagnosing && (
            <div className="text-xs text-muted-foreground">
              正在用任务的 model / api_base + 本地 API Key 调一次 /api/test-llm…
            </div>
          )}
          {!isDiagnosing && !diagnosis && (
            <div className="text-xs text-muted-foreground">
              暂无诊断结果(可能后端版本过旧、缺少 /api/test-llm 端点)。
            </div>
          )}
          {!isDiagnosing && diagnosis && diagnosisHint && (
            <div className="text-xs flex flex-col gap-1.5">
              <div className={cn(
                "font-semibold",
                diagnosisHint.tone === "actionable" ? "text-warning" : "text-success",
              )}>
                {diagnosisHint.title}
              </div>
              <div className="text-foreground/85 whitespace-pre-wrap leading-relaxed">
                {diagnosisHint.body}
              </div>
            </div>
          )}

          {/* 快速修复 —— PR #3 起 launcher 不再支持指定模型覆盖，模型类问题统一去 Settings 改 profile.model。 */}
          {!isDiagnosing && diagnosis && (
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-border/40 flex-wrap">
              <span className="text-caption-sm text-muted-foreground shrink-0">快速修复:</span>
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenSettings}
                className="h-7 text-xs"
              >
                <Settings data-icon="inline-start" />
                去 Settings 改 Profile
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRetry}
                className="h-7 text-xs"
                title="把参数预填到新建框，可改后再跑"
              >
                <Edit data-icon="inline-start" />
                改参数重跑…
              </Button>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

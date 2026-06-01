// 后端发结构化进度事件（SSE event=="progress"，data 带 kind/step/verdict… 语义字段），
// 这里把语义字段映射成"给人看"的叙事事件（ParsedEvent）。
//
// 设计原则（H1 去耦后）：
//   - 语义在后端（runner._progress / server._transcribe），展示文案在前端（本文件）。
//   - 前端不再正则反解析后端 print 文本 —— 那套 string-coupling 已删除。
//   - 原始 print 仍以 `log` 事件流向「原始日志」视图（LogConsole 的 rawLogs），仅供排查。

export type LogEventType =
  | "system" // 任务开始 / 工作流开始
  | "step" // 进入新 step
  | "success" // 完成事件：博文落盘、质检通过、转录成稿等
  | "warning" // 自修正触发、视角拦截、解析失败转人工
  | "error" // 真错误
  | "paused" // 工作流挂起等人审
  | "detail" // 技术细节（默认折叠 / 仅原始日志）

export interface ParsedEvent {
  id: number
  type: LogEventType
  step?: number // 0-2 = 前三步转录；3-8 = LLM 步
  title: string // 给人看的标题
  subtitle?: string // 可选二级说明（如得分）
  raw: string // 结构化原文（JSON），保留给复制 / 搜索
}

const STEP_LABELS: Record<number, string> = {
  3: "清洗转录稿",
  4: "提炼核心观点",
  5: "搭建博文骨架",
  6: "撰写博文草稿",
  7: "质检评分",
  8: "归档落盘",
}

const ARTIFACT_TITLES: Record<string, string> = {
  post: "博文已落盘",
  review: "质检报告已保存",
  history: "已更新历史索引",
  fingerprint: "已更新风格指纹",
}

let _idCounter = 0
const nextId = () => ++_idCounter

/** 后端 progress 事件的 data 形状（字段按 kind 取用，全部可选）。 */
export interface ProgressData {
  kind: string
  step?: number
  version?: number
  chunks?: number
  mode?: string
  verdict?: string
  total?: string
  round?: number
  word?: string
  what?: string
  path?: string
  phase?: string
  engine?: string
  percent?: number
  mb?: number
}

/**
 * 把后端结构化 progress 事件映射成叙事 ParsedEvent。
 * 未知 kind 退化为 detail，绝不丢事件。
 */
export function mapProgress(data: ProgressData): ParsedEvent {
  const raw = JSON.stringify(data)
  const base = { id: nextId(), raw }

  switch (data.kind) {
    case "job_start":
      return {
        ...base,
        type: "system",
        title: data.mode === "full" ? "开始工作流（完整流程）" : "开始工作流（极速改写）",
      }

    case "step": {
      const step = data.step
      const label = step !== undefined ? STEP_LABELS[step] ?? `Step ${step}` : "处理中"
      const subtitle = data.version
        ? `第 ${data.version} 版`
        : data.chunks
          ? `分块 ${data.chunks} 段`
          : undefined
      return { ...base, type: "step", step, title: label, subtitle }
    }

    case "verdict": {
      const isPass = data.verdict === "PASS"
      return {
        ...base,
        type: isPass ? "success" : "warning",
        step: data.step ?? 7,
        title: isPass ? "质检通过" : "质检未通过，准备自修正",
        subtitle: data.total ? `得分 ${data.total}` : undefined,
      }
    }

    case "self_correct":
      return {
        ...base,
        type: "warning",
        step: data.step ?? 7,
        title: "启动自修正",
        subtitle: data.round ? `第 ${data.round} 轮重写` : undefined,
      }

    case "viewer_blocked":
      return {
        ...base,
        type: "warning",
        step: data.step ?? 7,
        title: "检测到禁用视角词，拒绝该版本",
        subtitle: data.word ? `命中「${data.word}」· 零成本本地拦截` : "零成本本地拦截",
      }

    case "parse_failed":
      return {
        ...base,
        type: "warning",
        step: data.step ?? 7,
        title: "质检失败，转人工审稿",
        subtitle: "跳过自修正，避免基于假反馈烧 token",
      }

    case "max_retries":
      return {
        ...base,
        type: "warning",
        step: data.step ?? 7,
        title: "已达重试上限，挑最高分版本",
      }

    case "artifact":
      return {
        ...base,
        type: "success",
        step: data.step ?? 8,
        title: data.what ? ARTIFACT_TITLES[data.what] ?? "已落盘" : "已落盘",
        subtitle: data.path,
      }

    case "transcribe":
      switch (data.phase) {
        case "model": {
          // 打包版首次转录需下载 ggml 模型（约 1.6GB）；percent 在则显示进度。
          const pct = typeof data.percent === "number" ? `${data.percent}%` : ""
          const sub = pct
            ? `下载中 ${pct}${data.mb ? ` · ${data.mb}MB` : ""}`
            : "首次需下载，约 1.6GB，后续复用"
          return { ...base, type: "step", step: 0, title: "准备转录模型", subtitle: sub }
        }
        case "start":
          return { ...base, type: "system", step: 0, title: "开始转录视频" }
        case "audio":
          return { ...base, type: "step", step: 0, title: "提取音频", subtitle: "ffmpeg" }
        case "asr":
          return { ...base, type: "step", step: 1, title: "语音转录", subtitle: data.engine }
        case "done":
          return { ...base, type: "success", step: 2, title: "转录成稿" }
        default:
          return { ...base, type: "detail", title: `转录：${data.phase ?? ""}` }
      }

    default:
      return { ...base, type: "detail", title: `事件：${data.kind}` }
  }
}

// ---- 任务级（SSE 顶层事件）→ ParsedEvent 工厂 ----
// started / paused / succeeded / failed 不是引擎 progress，而是 server 的 job 生命周期事件，
// 这里给它们做对应的叙事条目，与 progress 统一进同一条事件流。

export function systemEvent(title: string): ParsedEvent {
  return { id: nextId(), type: "system", title, raw: title }
}

export function successEvent(title: string): ParsedEvent {
  return { id: nextId(), type: "success", title, raw: title }
}

export function errorEvent(message: string): ParsedEvent {
  return { id: nextId(), type: "error", title: message, raw: message }
}

export function pausedEvent(stateStatus: string): ParsedEvent {
  if (stateStatus === "WAITING_USER_OUTLINE") {
    return {
      id: nextId(),
      type: "paused",
      step: 5,
      title: "等你审批大纲",
      subtitle: "请打开「骨架大纲审批」",
      raw: stateStatus,
    }
  }
  if (stateStatus === "WAITING_USER_REVIEW") {
    return {
      id: nextId(),
      type: "paused",
      step: 7,
      title: "等你审稿",
      subtitle: "请打开「草稿与质检」",
      raw: stateStatus,
    }
  }
  return { id: nextId(), type: "paused", title: "任务暂停", raw: stateStatus }
}

/**
 * 从事件序列里推断当前正在跑（或最近完成）的 step，驱动 StepProgress 高亮。
 */
export function inferCurrentStep(events: ParsedEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].step !== undefined) return events[i].step!
  }
  return null
}

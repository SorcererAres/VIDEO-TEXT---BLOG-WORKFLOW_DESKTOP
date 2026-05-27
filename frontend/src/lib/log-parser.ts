// 把后端 print 出来的工程师腔日志翻译成用户能读懂的叙事事件。
// 设计原则:
//   - 关键节点(step / success / warning / paused / error) 默认显示
//   - 中间技术细节(chunk N/M、清理痕迹、缓存命中之类) 标 detail,UI 默认折叠
//   - 完全无意义的(PAGER=cat 这种)直接 drop

export type LogEventType =
  | "system" // 任务开始 / 任务结束
  | "step" // 进入新 step
  | "success" // 完成事件:博文落盘、质检通过等
  | "warning" // 自修正触发、解析失败转人工
  | "error" // 真错误
  | "paused" // 工作流挂起等人审
  | "detail" // 技术细节(默认折叠)

export interface ParsedEvent {
  id: number
  type: LogEventType
  step?: number // 3-8 if present
  title: string // 给人看的标题
  subtitle?: string // 可选二级说明(如得分)
  raw: string // 原始日志,保留给"详细技术日志"查看
}

const STEP_LABELS: Record<number, string> = {
  3: "清洗转录稿",
  4: "提炼核心观点",
  5: "搭建博文骨架",
  6: "撰写博文草稿",
  7: "质检评分",
  8: "归档落盘",
}

let _idCounter = 0
const nextId = () => ++_idCounter

/**
 * 把单行原始日志转成 ParsedEvent;返回 null 表示该行应被丢弃。
 */
export function parseLogLine(raw: string): ParsedEvent | null {
  const line = raw.trimEnd()
  if (!line) return null

  // ---- 噪音过滤 ----
  if (/PAGER=cat/i.test(line)) return null
  if (/^\s*\[提示\]\s*当前处于非交互环境/.test(line)) return null

  // ---- 任务级 system 事件 ----
  if (/^\[\*\]\s*Backend job execution started/.test(line)) {
    return { id: nextId(), type: "system", title: "任务开始执行", raw }
  }
  if (/^\[\*\]\s*开始执行工作流\s*Job:/.test(line)) {
    const m = line.match(/模式[:：]\s*(full|quick)\)/i)
    return {
      id: nextId(),
      type: "system",
      title: m ? `开始工作流(${m[1] === "full" ? "完整流程" : "极速改写"})` : "开始工作流",
      raw,
    }
  }
  if (/^\[\*\]\s*任务执行完毕/.test(line)) {
    return { id: nextId(), type: "success", title: "任务完成", raw }
  }
  if (/Job completed successfully/i.test(line)) {
    return { id: nextId(), type: "success", title: "全部步骤已通过", raw }
  }

  // ---- step 进入 ----
  const stepEnter = line.match(/^\[\+\]\s*\[Step\s+(\d+)\]\s*(.+)$/)
  if (stepEnter) {
    const step = parseInt(stepEnter[1], 10)
    const detail = stepEnter[2]
    const label = STEP_LABELS[step] ?? `Step ${step}`

    // 草稿 v1 / v2 等版本信息
    const verM = detail.match(/第\s*(\d+)\s*版/)
    const subtitle = verM ? `第 ${verM[1]} 版` : undefined

    // 分块提示
    const chunkM = detail.match(/(\d+)\s*chunks?/i)
    const chunkSub = chunkM ? `分块 ${chunkM[1]} 段` : undefined

    return {
      id: nextId(),
      type: "step",
      step,
      title: label,
      subtitle: subtitle ?? chunkSub,
      raw,
    }
  }

  // ---- 缩进的子事件(以 -> 开头) ----
  const subEvent = line.match(/^\s*->\s*(.+)$/)
  if (subEvent) {
    const detail = subEvent[1]

    // 质检结论
    const verdict = detail.match(/质检结论[:：]\s*(PASS|REVIEW)\s*(?:\(得分[:：]\s*([^)]+)\))?/)
    if (verdict) {
      const isPass = verdict[1] === "PASS"
      return {
        id: nextId(),
        type: isPass ? "success" : "warning",
        title: isPass ? "质检通过" : "质检未通过,准备自修正",
        subtitle: verdict[2] ? `得分 ${verdict[2]}` : undefined,
        raw,
      }
    }

    // 自修正
    if (/自修正/.test(detail) && /启动自我修正/.test(detail)) {
      const verM = detail.match(/第\s*(\d+)\s*轮/)
      return {
        id: nextId(),
        type: "warning",
        title: "启动自修正",
        subtitle: verM ? `第 ${verM[1]} 轮重写` : undefined,
        raw,
      }
    }

    // 缓存命中
    if (/缓存命中/.test(detail)) {
      const stepM = detail.match(/第\s*(\d+)\s*版/)
      return {
        id: nextId(),
        type: "detail",
        title: stepM ? `缓存命中 · 第 ${stepM[1]} 版` : "缓存命中",
        subtitle: "跳过 API 调用",
        raw,
      }
    }

    // 视角违规拦截
    if (/\[拦截\].*视角违规/.test(detail)) {
      return {
        id: nextId(),
        type: "warning",
        title: "检测到禁用视角词,拒绝该版本",
        subtitle: "零成本本地拦截",
        raw,
      }
    }

    // Step 7 不符合合同
    if (/\[拦截\].*Step\s+7/.test(detail) || /Step\s+7\s*输出不符合/.test(detail)) {
      return {
        id: nextId(),
        type: "warning",
        title: "质检系统输出异常",
        subtitle: "LLM 未按合同输出评分表",
        raw,
      }
    }

    // Step 7 转人工
    if (/Step\s+7\s*解析失败/.test(detail) && /转人工/.test(detail)) {
      return {
        id: nextId(),
        type: "warning",
        title: "质检失败,转人工审稿",
        subtitle: "跳过自修正,避免基于假反馈烧 token",
        raw,
      }
    }

    // 清理痕迹这种技术细节
    if (/已清理.*运行过程痕迹/.test(detail)) {
      return { id: nextId(), type: "detail", title: detail, raw }
    }

    // insights/clean chunk N/M
    if (/chunk\s+\d+\/\d+/i.test(detail)) {
      return { id: nextId(), type: "detail", title: detail, raw }
    }

    // 评估并选择最佳版本
    if (/选择最佳版本|已达到最大重试/.test(detail)) {
      return {
        id: nextId(),
        type: "warning",
        title: "已达重试上限,挑最高分版本",
        raw,
      }
    }

    // 兜底:作为缩进 detail 显示
    return { id: nextId(), type: "detail", title: detail, raw }
  }

  // ---- 完成事件 [✓] ----
  if (/^\[✓\]\s*博文已输出到成品目录[:：]\s*(.+)$/.test(line)) {
    const m = line.match(/^\[✓\]\s*博文已输出到成品目录[:：]\s*(.+)$/)
    return {
      id: nextId(),
      type: "success",
      step: 8,
      title: "博文已落盘",
      subtitle: m?.[1],
      raw,
    }
  }
  if (/^\[✓\]\s*质检报告已保存[:：]\s*(.+)$/.test(line)) {
    const m = line.match(/^\[✓\]\s*质检报告已保存[:：]\s*(.+)$/)
    return {
      id: nextId(),
      type: "success",
      step: 8,
      title: "质检报告已保存",
      subtitle: m?.[1],
      raw,
    }
  }
  if (/^\[✓\]\s*已更新历史索引/.test(line)) {
    return { id: nextId(), type: "success", step: 8, title: "已更新历史索引", raw }
  }
  if (/^\[✓\]\s*已生成并更新风格指纹/.test(line)) {
    return { id: nextId(), type: "success", step: 8, title: "已更新风格指纹", raw }
  }
  if (/^\[\+\]\s*HISTORY\s*索引已生成/.test(line)) {
    return {
      id: nextId(),
      type: "success",
      step: 8,
      title: "HISTORY 索引已生成",
      subtitle: "模板摘要,零 LLM 调用",
      raw,
    }
  }

  // ---- 暂停事件 [!] ----
  if (/^\[!\]\s*任务暂停[:：]/.test(line)) {
    if (/WAITING_USER_OUTLINE|等待用户审批大纲|骨架已生成/.test(line)) {
      return {
        id: nextId(),
        type: "paused",
        step: 5,
        title: "等你审批大纲",
        subtitle: "请打开「骨架大纲审批」",
        raw,
      }
    }
    if (/WAITING_USER_REVIEW|未通过质量把关/.test(line)) {
      return {
        id: nextId(),
        type: "paused",
        step: 7,
        title: "等你审稿",
        subtitle: "请打开「草稿与质检」",
        raw,
      }
    }
    return { id: nextId(), type: "paused", title: "任务暂停", raw }
  }
  if (/^\[!\]\s*Workflow suspended[:：]?\s*Paused at\s*WAITING_USER_OUTLINE/.test(line)) {
    return { id: nextId(), type: "paused", step: 5, title: "等你审批大纲", raw }
  }
  if (/^\[!\]\s*Workflow suspended[:：]?\s*Paused at\s*WAITING_USER_REVIEW/.test(line)) {
    return { id: nextId(), type: "paused", step: 7, title: "等你审稿", raw }
  }

  // ---- 错误 ----
  if (/^\[错误\]/.test(line) || /^\[!\]\s*错误/.test(line)) {
    return {
      id: nextId(),
      type: "error",
      title: line.replace(/^\[错误\]\s*|^\[!\]\s*/, ""),
      raw,
    }
  }

  // ---- 改进建议 / Re-Brief / LLM 原始响应 等多行附属内容 ----
  // 默认归为 detail
  return { id: nextId(), type: "detail", title: line, raw }
}

/**
 * 从历史事件序列里推断当前正在跑(或最近完成)的 step。
 * 用于驱动 StepProgress 高亮当前节点。
 */
export function inferCurrentStep(events: ParsedEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].step !== undefined) return events[i].step!
  }
  return null
}

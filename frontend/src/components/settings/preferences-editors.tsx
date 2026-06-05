import { useState, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  parseStyleGuide,
  serializeStyleGuide,
  parseBanned,
  bannedItems,
  spliceBanned,
  PREF_FIELDS,
  getPrefField,
  setPrefField,
} from '@/lib/preferences-parser'

export function StyleGuideForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { preamble, rules } = useMemo(() => parseStyleGuide(value), [value])
  const update = (next: string[]) => onChange(serializeStyleGuide(preamble, next))
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    const a = [...rules]; const [m] = a.splice(from, 1); a.splice(to, 0, m); update(a)
  }
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-1 py-4 flex flex-col gap-2">
        <p className="text-sm text-muted-foreground mb-1">风格硬规则（优先级高于范文）。逐条编辑 · 增删 · 拖手柄排序；保存即写回 STYLE_GUIDE.md。</p>
        {rules.map((r, i) => (
          // 增项列表行（同禁用套话样式）：拖拽手柄 + 编号 + 编辑框 + hover 删除；拖手柄实时重排，编号随之刷新。
          <div
            key={i}
            onDragEnter={() => { if (dragIdx !== null && dragIdx !== i) { move(dragIdx, i); setDragIdx(i) } }}
            onDragOver={e => e.preventDefault()}
            className={cn("group flex items-center gap-2 rounded-lg border px-3 h-11", dragIdx === i && "opacity-50")}
          >
            <button
              type="button"
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => setDragIdx(null)}
              title="拖拽排序"
              aria-label="拖拽排序"
              className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <GripVertical className="size-4" />
            </button>
            <span className="shrink-0 w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <input
              value={r}
              onChange={e => { const n = [...rules]; n[i] = e.target.value; update(n) }}
              placeholder="一条风格规则"
              autoFocus={r === ""}
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => update(rules.filter((_, j) => j !== i))}
              title="删除"
              aria-label="删除"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={() => update([...rules, ""])}><Plus data-icon="inline-start" /> 添加规则</Button>
      </div>
    </ScrollArea>
  )
}

// 一行：label 左 + select 右（套 STYLE appearance-none + ChevronsUpDown 范式）。
// 现有值不在档位里时并入选项，确保不丢自定义值。
function PrefSelectRow({ label, value, options, onChange }: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const opts = options.includes(value) ? options : [value, ...options]
  return (
    // 对齐设计稿 Figma 428:1015：label 左（14px 中性）+ 控件右（固定 280、h-40、圆角 8、单 ChevronDown）
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="relative w-[280px] shrink-0">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-card border rounded-lg h-10 pl-3 pr-9 text-sm text-foreground focus:border-primary outline-none transition-colors"
        >
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 shrink-0 opacity-50" />
      </div>
    </div>
  )
}

// 禁用套话 = 增项列表：源码每个 `- ` 行 ↔ 列表一条（可编辑 + hover 删除），顶部「添加」追加新行。
function BannedList({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = useMemo(() => bannedItems(value), [value])
  if (items === null) return null
  const commit = (next: string[]) => onChange(spliceBanned(value, next))
  return (
    <div className="flex flex-col gap-3 border-t pt-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold">禁用套话</div>
          <div className="text-sm text-muted-foreground mt-0.5">改写时须删除的口播套话 / 求互动话术 · 一行一条</div>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => commit([...items, ""])}>
          <Plus data-icon="inline-start" /> 添加
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 italic">（暂无，点「添加」新增一条）</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="group flex items-center gap-2 rounded-lg border px-3 h-11">
              <input
                value={it}
                onChange={e => { const n = [...items]; n[i] = e.target.value.replace(/\n/g, " "); commit(n) }}
                placeholder="一条要删除的套话，如 大家好"
                autoFocus={it === ""}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => commit(items.filter((_, j) => j !== i))}
                title="删除"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PreferencesForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bullets = useMemo(() => parseBanned(value), [value])
  const fields = PREF_FIELDS
    .map(f => ({ ...f, val: getPrefField(value, f.key) }))
    .filter((f): f is { key: string; label: string; options: string[]; val: string } => f.val !== null)

  if (fields.length === 0 && bullets === null) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-sm text-muted-foreground">
        没识别到可表单化的字段（语言 / 人称 / 长度 / 版式 / 禁用套话）。请切「源码」模式编辑。
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="px-1 py-4 flex flex-col gap-7">
        {/* B2 · 核心偏好：规整的 label 左 + select 右行（无分隔线，靠行内 padding 留间距） */}
        {fields.length > 0 && (
          <div className="flex flex-col">
            {fields.map(f => (
              <PrefSelectRow
                key={f.key}
                label={f.label}
                value={f.val}
                options={f.options}
                onChange={v => onChange(setPrefField(value, f.key, v))}
              />
            ))}
          </div>
        )}

        {/* B3 · 禁用套话 → 增项列表（每条一行，可编辑/删除，顶部添加） */}
        {bullets !== null && <BannedList value={value} onChange={onChange} />}

        <p className="text-caption-sm text-muted-foreground/70">
          更细的偏好（受众 / 语气 / 视角约束 / 版式细节 / 专有名词）请切「源码」模式编辑。
        </p>
      </div>
    </ScrollArea>
  )
}

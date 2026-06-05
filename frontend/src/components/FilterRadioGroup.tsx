import { cn } from '@/lib/utils'

// 任务 ⚙ popover 里的单段 radio group —— 状态 / 时间 / 排序 三段共用。
// 显式 generic，避免父级把不同段的 value/onChange 串到同一个联合类型上。
export function FilterRadioGroup<T extends string>({ label, value, onChange, options }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
}) {
  return (
    <div>
      <div className="px-2 py-1 text-caption-sm uppercase tracking-wider text-muted-foreground">{label}</div>
      {options.map(([key, optionLabel]) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "flex items-center w-full h-7 px-2 rounded-md text-[13px] text-left transition-colors gap-2",
              active
                ? "bg-foreground/[0.08] text-foreground font-medium"
                : "text-foreground/85 hover:bg-foreground/[0.05]",
            )}
          >
            {/* 圆点 radio 指示器：active 实心 / 默认空心环 */}
            <span className={cn(
              "size-3 rounded-full shrink-0 flex items-center justify-center",
              active ? "border-[2px] border-foreground" : "border border-foreground/35",
            )}>
              {active && <span className="size-1 rounded-full bg-foreground" />}
            </span>
            <span className="flex-1">{optionLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

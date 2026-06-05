import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; title?: string }[]
  className?: string
}) {
  return (
    <div className={cn("inline-flex rounded-md border bg-card p-0.5 text-sm", className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-3 py-1 transition-colors whitespace-nowrap",
            // STYLE 表2 唯一选中态：中性玻璃高亮，不再用 bg-primary 实底。
            value === o.value
              ? "bg-foreground/[0.08] text-foreground font-medium"
              : "text-foreground/80 hover:bg-foreground/[0.05]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function Checkbox({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary rounded"
      />
      <div className="flex-1">
        <span className="text-sm">{label}</span>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </label>
  )
}

// 统一单行输入框（收敛全项目散落的手写 input）。默认 padding py-2 px-3；
// 透传所有原生 input 属性（value / onChange / placeholder / type…），className 可叠加/覆盖。
export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        "bg-card border rounded-md py-2 px-3 text-sm focus:border-primary outline-none transition-colors",
        className,
      )}
    />
  )
}

// 过滤 / 选择小 chip（pill）。选中态走 STYLE 表2 中性玻璃高亮。
export function FilterChip({ active, onClick, children, className, title }: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "px-2.5 py-0.5 text-xs rounded-full border transition-colors",
        active
          ? "bg-foreground/[0.08] border-foreground/15 text-foreground font-medium"
          : "border-border text-foreground/80 hover:bg-foreground/[0.05] hover:border-foreground/30",
        className,
      )}
    >
      {children}
    </button>
  )
}

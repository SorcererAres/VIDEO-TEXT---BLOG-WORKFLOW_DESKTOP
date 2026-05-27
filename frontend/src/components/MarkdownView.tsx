import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownViewProps {
  source: string
  className?: string
}

/**
 * 渲染 markdown 源码为可读富文本。
 * 给草稿审稿/质检报告/大纲预览用 —— 用户审稿时该看"渲染后的博文",而不是 # 这是标题 的源码。
 *
 * 样式风格刻意贴近成品 .md 在 Obsidian/笔记软件里的阅读感:
 *   - 衬线/常规 sans 字体(可读性 > 工程感)
 *   - 适中的标题层级反差
 *   - 引用块、代码块、表格都接入 shadcn 配色
 */
export function MarkdownView({ source, className }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none",
        "prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-3",
        "prose-h1:text-2xl prose-h1:mt-2 prose-h1:mb-4 prose-h1:border-b prose-h1:pb-2",
        "prose-h2:text-lg prose-h3:text-base",
        "prose-p:text-foreground/90 prose-p:leading-7",
        "prose-strong:text-foreground prose-strong:font-semibold",
        "prose-em:text-foreground/90",
        "prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:border prose-pre:text-foreground",
        "prose-blockquote:border-l-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:not-italic",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-li:text-foreground/90 prose-li:marker:text-muted-foreground",
        "prose-table:text-sm prose-th:bg-muted/40 prose-td:border-border prose-th:border-border",
        "prose-hr:border-border",
        "dark:prose-invert",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}

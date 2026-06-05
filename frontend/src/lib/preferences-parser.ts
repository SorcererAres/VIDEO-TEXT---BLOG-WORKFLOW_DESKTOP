// 写作偏好/风格指南的纯 parse/serialize（从 settings.tsx 机械拆出，逻辑零改动）。
// STYLE_GUIDE 是纯编号列表，可无损 parse/serialize 成表单（方案 A 首块）
export const STYLE_GUIDE_PATH = "knowledge/STYLE_GUIDE.md"
export function parseStyleGuide(md: string): { preamble: string; rules: string[] } {
  const lines = md.split("\n")
  const firstRule = lines.findIndex(l => /^\s*\d+\.\s+/.test(l))
  if (firstRule === -1) return { preamble: md.replace(/\s+$/, ""), rules: [] }
  const preamble = lines.slice(0, firstRule).join("\n").replace(/\s+$/, "")
  const rules: string[] = []
  for (const l of lines.slice(firstRule)) {
    const m = l.match(/^\s*\d+\.\s+(.*)$/)
    if (m) rules.push(m[1].trim())
  }
  return { preamble, rules }
}
export function serializeStyleGuide(preamble: string, rules: string[]): string {
  const body = rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
  return (preamble ? preamble + "\n\n" : "") + body + "\n"
}

export const PREFERENCES_PATH = "memory/PREFERENCES.md"
// PREFERENCES 是 prose-under-headings，不是干净 schema。只把最"列表化、高影响"的
// 「禁用套话」小节做成表单；用定向 splice 仅替换该小节的 bullet，其余字节不动；
// 找不到该小节就回退（不破坏文件）。其余偏好走源码模式编辑。
const BANNED_SECTION_RE = /(^##[^\n]*禁用套话[^\n]*\n)([\s\S]*?)(?=^##\s|$(?![\s\S]))/m
export function parseBanned(md: string): string[] | null {
  const m = md.match(BANNED_SECTION_RE)
  if (!m) return null
  return m[2].split("\n").map(l => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x)
}
// 列表用：每个 `- ` 行 = 一条（保留空行，新增/清空不丢行）—— 源码一行 ↔ 列表一条。
export function bannedItems(md: string): string[] | null {
  const m = md.match(BANNED_SECTION_RE)
  if (!m) return null
  return m[2].split("\n").filter(l => /^\s*[-*]\s/.test(l)).map(l => l.replace(/^\s*[-*]\s/, "").trim())
}
// 回写：一条一行 `- xxx`（引擎只当 prose 读，格式自由）。
export function spliceBanned(md: string, items: string[]): string {
  const body = "\n" + items.map(b => `- ${b}`).join("\n") + "\n\n"
  return md.replace(BANNED_SECTION_RE, (_m, heading) => heading + body)
}

// 语言/人称/长度/版式 各取该小节的「**加粗关键值**」做字段。定向 splice 只替换那段加粗值，
// 周围 prose 与全文其余字节不动；找不到的字段不渲染（结构改动走源码模式）。
// 每个字段给一组常用档位做 select 选项；用户现有值若不在档位里，会在渲染时并入，
// 保证不丢任意自定义值（onChange 仍走 setPrefField 写任意字符串）。
export const PREF_FIELDS: { key: string; label: string; options: string[] }[] = [
  { key: "正文语言", label: "正文语言", options: ["简体中文", "繁体中文", "English"] },
  { key: "叙述人称", label: "叙述人称（文章里的「我」）", options: ["演讲人第一人称「我」", "作者第一人称「我」", "第三人称转述"] },
  { key: "目标字数", label: "目标字数", options: ["800–1500 字", "1500–3000 字", "3000–5000 字", "不限"] },
  { key: "输出格式", label: "输出格式", options: ["Obsidian Markdown", "通用 Markdown", "纯文本"] },
]
const prefFieldRE = (k: string) => new RegExp(`(${k}[：:]\\s*\\*\\*)([^*]+?)(\\*\\*)`)
export function getPrefField(md: string, key: string): string | null {
  const m = md.match(prefFieldRE(key))
  return m ? m[2].trim() : null
}
export function setPrefField(md: string, key: string, val: string): string {
  return md.replace(prefFieldRE(key), (_m, a, _b, c) => a + val + c)
}

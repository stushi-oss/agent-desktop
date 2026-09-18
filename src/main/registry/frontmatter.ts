/** 极简 YAML frontmatter 子集解析：仅 key: value 字符串行 */
export function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return result
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) result[key] = value
  }
  return result
}

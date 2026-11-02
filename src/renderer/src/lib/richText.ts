/**
 * The little inline markup the release notes and a few catalog strings use:
 * **bold** and [links](https://…). Parsed into data and rendered as React
 * elements (components/ui/RichText.tsx), so no string ever becomes HTML.
 */
export interface Inline {
  text: string
  bold?: boolean
  /** Only http(s). Anything else in link syntax stays plain text. */
  href?: string
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of s.matchAll(/\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: s.slice(last, at) })
    if (m[1] !== undefined) out.push({ text: m[1], bold: true })
    else if (/^https?:\/\//i.test(m[3])) out.push({ text: m[2], href: m[3] })
    else out.push({ text: m[2] })
    last = at + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

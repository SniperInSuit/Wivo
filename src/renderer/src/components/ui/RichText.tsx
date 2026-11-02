import { parseInline, type Inline } from '../../lib/richText'

/** Text with **bold** and [links](https://…) (lib/richText.ts), as elements, never as HTML. */
export function RichText({ text }: { text: string | Inline[] }) {
  const parts = typeof text === 'string' ? parseInline(text) : text
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
            {p.text}
          </a>
        ) : p.bold ? (
          <strong key={i} className="font-semibold text-ink">{p.text}</strong>
        ) : (
          <span key={i}>{p.text}</span>
        ))}
    </>
  )
}

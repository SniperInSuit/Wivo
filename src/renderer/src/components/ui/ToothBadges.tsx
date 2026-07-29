interface ToothBadgesProps {
  hambad: string | null
  max?: number
}

export function ToothBadges({ hambad, max = 4 }: ToothBadgesProps) {
  if (!hambad) return null

  const teeth = hambad
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const visible = teeth.slice(0, max)
  const extra = teeth.length - max

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tooth) => (
        <span
          key={tooth}
          className="inline-block text-xs font-mono font-medium bg-accent-light text-accent-dark rounded px-1.5 py-0.5 leading-none"
        >
          {tooth}
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-block text-xs font-medium text-ink-muted bg-bg-sidebar rounded px-1.5 py-0.5 leading-none">
          +{extra}
        </span>
      )}
    </div>
  )
}

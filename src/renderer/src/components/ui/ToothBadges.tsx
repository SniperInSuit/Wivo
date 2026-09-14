interface ToothBadgesProps {
  hambad: string | null
  max?: number
  /**
   * FDI numbers that sit on an IMPLANT, comma-separated. Those chips are drawn
   * dark with a screw mark.
   *
   * On an implant bridge only two or three of the units carry it and the rest
   * are pontics, and that difference decides the screw cost — so a row of
   * identical numbers is a row that hides the one thing worth seeing.
   */
  implantaadid?: string | null
}

const split = (s: string | null | undefined): string[] =>
  (s ?? '').split(',').map(t => t.trim()).filter(Boolean)

export function ToothBadges({ hambad, max = 4, implantaadid }: ToothBadgesProps) {
  if (!hambad) return null

  const teeth = split(hambad)
  const implants = new Set(split(implantaadid))

  const visible = teeth.slice(0, max)
  const extra = teeth.length - max

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tooth) => {
        const isImplant = implants.has(tooth)
        return (
          <span
            key={tooth}
            title={isImplant ? `Hammas ${tooth} — implantaadil` : undefined}
            className={`relative inline-block text-xs font-mono font-medium rounded px-1.5 py-0.5 leading-none ${
              isImplant
                ? 'bg-slate-800 text-white'
                : 'bg-accent-light text-accent-dark'
            }`}
          >
            {tooth}
            {/* A dot, not an icon: these chips are 20px tall and sit five to a
                board card, where anything with strokes turns to mud. */}
            {isImplant && (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-white"
              />
            )}
          </span>
        )
      })}
      {extra > 0 && (
        <span className="inline-block text-xs font-medium text-ink-muted bg-bg-sidebar rounded px-1.5 py-0.5 leading-none">
          +{extra}
        </span>
      )}
    </div>
  )
}

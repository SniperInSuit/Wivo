/**
 * ToothLegend — one row per tooth state: a swatch drawn with the chart's own
 * geometry (not a coloured square, so the dashed 'Puudub' outline is
 * recognisable), the Estonian label, and a live count.
 *
 * The counts are derived from the same resolved map the chart renders, so they
 * always sum to 32.
 */

import { useMemo } from 'react'
import type { ToothStatus } from '../../types/teeth'
import { ALL_FDI, TOOTH_STATES } from '../../config/teeth'

interface ToothLegendProps {
  statuses: Record<number, ToothStatus>   // resolved 4-state map, all 32 keys present
}

export function ToothLegend({ statuses }: ToothLegendProps) {
  const counts = useMemo(() => {
    const c: Record<ToothStatus, number> = { toodeldud: 0, ravi: 0, terve: 0, puudub: 0 }
    ALL_FDI.forEach(fdi => { c[statuses[fdi] ?? 'terve'] += 1 })
    return c
  }, [statuses])

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      {TOOTH_STATES.map(s => (
        <div key={s.key} className="flex items-center gap-2">
          {/* Same rounded rect + stroke treatment as the real tooth body */}
          <svg width={14} height={12} viewBox="0 0 14 12" className="flex-shrink-0" aria-hidden="true">
            <rect
              x={1} y={1} width={12} height={10} rx={2.5} ry={2.5}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              strokeDasharray={s.dash}
              opacity={s.opacity}
            />
          </svg>
          <span className="text-ink-muted truncate">{s.label}</span>
          <span className="font-semibold ml-auto">{counts[s.key]}</span>
        </div>
      ))}
    </div>
  )
}

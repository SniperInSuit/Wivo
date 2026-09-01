/**
 * The one stat tile the statistics surfaces share.
 *
 * It replaces two near-identical components — `StatCard` in Dashboard.tsx and
 * `Money` in FinanceView.tsx — that had drifted into carrying different halves
 * of the same job: one knew how to show a two-way breakdown, the other knew how
 * to admit what its number could not see. A panel-based dashboard mixes both
 * kinds of tile in one grid, so a tile that can only do half is a tile that
 * quietly drops the other half's honesty.
 *
 * Deliberately in `ui/` rather than in `Dashboard/`: Ülevaade, Arved and
 * Patsiendid each still carry their own copy, and they should be able to migrate
 * here later without importing from a feature folder.
 *
 * Two props exist because the house rules require them and not because a design
 * wanted them:
 *
 *   `coverage`  — what the number could not see. A total that silently omitted a
 *                 third of the jobs is worse than no total at all, and a margin
 *                 that ignores unassigned work reads as good news while being
 *                 fiction.
 *   `scope`     — which window the number covers. An unlabelled figure sitting
 *                 next to period figures reads as a period figure; that is how
 *                 Ülevaade's all-time counts came to look like a third opinion
 *                 about this month.
 */
import { AlertTriangle } from 'lucide-react'
import type { Coverage } from '../../lib/finance'

/** One side of the optional two-way split under the value. */
export interface TileBreakdownSide {
  label: string
  value: number | string
  color?: string
}

export interface StatTileProps {
  icon: React.ElementType
  label: string
  /** Pre-formatted. Money formats itself with `money` rather than passing a string. */
  value: React.ReactNode
  /** Formats `value` as `0.00 €`. Only valid when value is a number. */
  money?: boolean
  sub?: string
  accent?: string
  /** Small chip beside the label: "kogu aeg", "hetkeseis", "august 2026". */
  scope?: string
  breakdown?: { left: TileBreakdownSide; right: TileBreakdownSide }
  coverage?: Coverage
  coverageLabel?: string
  /** 'md' matches the old StatCard, 'sm' the old Money tile. */
  size?: 'sm' | 'md'
}

const ACCENT = '#0AB6C4'

export function StatTile({
  icon: Icon,
  label,
  value,
  money,
  sub,
  accent,
  scope,
  breakdown,
  coverage,
  coverageLabel,
  size = 'md',
}: StatTileProps) {
  const tint = accent ?? ACCENT
  const missing = coverage?.missing ?? 0
  const shown = money && typeof value === 'number' ? `${value.toFixed(2)} €` : value

  return (
    // h-full: on a sized grid the tile fills the cells it was given, so a
    // "Kõrge" or "Täisekraan" tile is actually that size rather than a small
    // card floating at the top of an empty box.
    <div className={`card flex flex-col gap-1.5 h-full ${size === 'sm' ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center gap-2">
        <div
          className={`rounded-lg flex items-center justify-center flex-shrink-0 ${
            size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
          }`}
          style={{ backgroundColor: `${tint}18` }}
        >
          <Icon size={size === 'sm' ? 14 : 16} style={{ color: tint }} />
        </div>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {scope && (
          <span className="text-[10px] text-ink-faint bg-bg-sidebar rounded px-1.5 py-0.5 ml-auto flex-shrink-0">
            {scope}
          </span>
        )}
      </div>

      <p
        className={`font-bold text-ink leading-none ${
          size === 'sm' ? 'text-xl tabular-nums' : 'text-2xl'
        }`}
      >
        {shown}
      </p>

      {(sub || breakdown) && (
        <div className="flex items-center justify-between gap-2">
          {sub && <p className={size === 'sm' ? 'text-[11px] text-ink-faint' : 'text-xs text-ink-muted'}>{sub}</p>}
          {breakdown && (
            <div className="flex items-center gap-2.5 ml-auto flex-shrink-0">
              <span className="text-[11px] font-bold" style={{ color: breakdown.left.color ?? ACCENT }}>
                {breakdown.left.value}{' '}
                <span className="text-ink-faint font-normal">{breakdown.left.label}</span>
              </span>
              <span className="text-ink-faint/30">·</span>
              <span className="text-[11px] font-bold" style={{ color: breakdown.right.color ?? '#EC4899' }}>
                {breakdown.right.value}{' '}
                <span className="text-ink-faint font-normal">{breakdown.right.label}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Says what the number could not see. Never removed to tidy a card. */}
      {coverage && missing > 0 && (
        <p className="text-[11px] text-orange-500 flex items-start gap-1">
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          {coverage.covered}/{coverage.total} {coverageLabel} — {missing} tööd puudu
        </p>
      )}
    </div>
  )
}

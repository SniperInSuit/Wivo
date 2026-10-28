/**
 * A gauge panel: one metric, the user's own bounds, and whether it is there.
 *
 * ── Why the arc is hand-drawn SVG and not recharts ──────────────────────────
 * `RadialBarChart` can draw this shape, and it brings a ResponsiveContainer, a
 * polar coordinate system and an animation loop to put one path on screen. The
 * path is four numbers of trigonometry. The rest of the dashboard uses recharts
 * where it earns its place — bar charts, lines, tooltips, axes — and this is
 * not one of those places.
 *
 * ── Why the editor is inline and not a dialog ───────────────────────────────
 * Setting a target means looking at where the needle currently sits. A dialog
 * covering the dial you are aiming at makes you close it to check, which is the
 * same reason the theme editor is a section rather than a popup.
 */
import { useState } from 'react'
import { Settings2, Check } from 'lucide-react'
import { useUiPrefs, setGaugeBounds } from '../../../stores/useUiPrefs'
import {
  gaugeBounds, gaugeFraction, gaugeVerdict, formatMetric,
  type GaugeMetric,
} from './metrics'
import type { PanelCtx } from '../useStatsContext'

/** Degrees of sweep. 240° leaves the dial open at the bottom, like a dial. */
const SWEEP = 240
const START = 150 // bottom-left, going clockwise

const VERDICT_COLOR: Record<string, string> = {
  good: '#22C55E',
  near: '#F59E0B',
  bad: '#EF4444',
  none: '#0EB6C4',
}

/** Polar → cartesian on a 100×100 viewBox centred at (50, 52). */
function point(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [50 + radius * Math.cos(rad), 52 + radius * Math.sin(rad)]
}

function arcPath(fromFraction: number, toFraction: number, radius: number): string {
  const a0 = START + SWEEP * fromFraction
  const a1 = START + SWEEP * toFraction
  const [x0, y0] = point(a0, radius)
  const [x1, y1] = point(a1, radius)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`
}

export function Gauge({ metric, panelId, ctx }: {
  metric: GaugeMetric
  panelId: string
  ctx: PanelCtx
}) {
  const prefs = useUiPrefs()
  const [editing, setEditing] = useState(false)

  const cfg = prefs.dashboard?.gauges?.[panelId]
  const bounds = gaugeBounds(metric, cfg)
  const value = metric.read(ctx)
  const verdict = gaugeVerdict(value, metric, bounds)
  const colour = VERDICT_COLOR[verdict]
  const fraction = value === null ? 0 : gaugeFraction(value, bounds)
  const targetFraction = bounds.target === null ? null : gaugeFraction(bounds.target, bounds)

  return (
    <div className="card flex h-full flex-col p-4">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {metric.label}
        </h3>
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          className="flex-shrink-0 text-ink-faint transition-colors hover:text-ink"
          title={editing ? 'Valmis' : 'Sea piirid'}
        >
          {editing ? <Check size={13} /> : <Settings2 size={13} />}
        </button>
      </div>

      {editing ? (
        <div className="mt-2 space-y-1.5">
          <Field label="Alumine piir" value={cfg?.min} placeholder="0"
            onChange={n => setGaugeBounds(panelId, { min: n })} />
          <Field label="Ülemine piir" value={cfg?.max} placeholder={String(metric.defaultMax)}
            onChange={n => setGaugeBounds(panelId, { max: n })} />
          <Field label="Eesmärk" value={cfg?.target} placeholder="puudub"
            onChange={n => setGaugeBounds(panelId, { target: n })} />
          {/* Said here rather than enforced in `gaugeBounds`, which runs while
              the number is still being typed — see its own note. */}
          {cfg?.max !== undefined && cfg.max <= (cfg.min ?? 0) && (
            <p className="text-[10px] text-orange-600">
              Ülemine piir peab olema alumisest suurem — näidik kasutab seni vaikeulatust.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-ink-faint">
            Eesmärgita näidik on lihtsalt näit — värvi ta ei saa, sest ükski
            väärtus ei ole siis hea ega halb.{' '}
            {metric.higherIsBetter ? 'Suurem on parem.' : 'Väiksem on parem.'}
          </p>
        </div>
      ) : (
        <>
          <div className="relative mt-1 min-h-0 flex-1">
            <svg viewBox="0 0 100 78" className="h-full w-full" role="img"
              aria-label={`${metric.label}: ${value === null ? 'andmeid ei ole' : formatMetric(value, metric.unit)}`}>
              <path d={arcPath(0, 1, 38)} fill="none" strokeLinecap="round"
                className="stroke-ink-faint/20" strokeWidth={9} />
              {value !== null && fraction > 0 && (
                <path d={arcPath(0, fraction, 38)} fill="none" stroke={colour}
                  strokeLinecap="round" strokeWidth={9} />
              )}
              {targetFraction !== null && (() => {
                // A tick across the band, not a dot on it: the target is a
                // line you are on one side of.
                const [ix, iy] = point(START + SWEEP * targetFraction, 32)
                const [ox, oy] = point(START + SWEEP * targetFraction, 44)
                return <line x1={ix} y1={iy} x2={ox} y2={oy}
                  className="stroke-ink" strokeWidth={2} strokeLinecap="round" />
              })()}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-3">
              <span className="text-xl font-bold tabular-nums text-ink">
                {value === null ? '—' : formatMetric(value, metric.unit)}
              </span>
              {bounds.target !== null && (
                <span className="text-[10px] text-ink-faint tabular-nums">
                  eesmärk {formatMetric(bounds.target, metric.unit)}
                </span>
              )}
            </div>
          </div>
          <div className="flex justify-between text-[10px] tabular-nums text-ink-faint">
            <span>{formatMetric(bounds.min, metric.unit)}</span>
            <span>{formatMetric(bounds.max, metric.unit)}</span>
          </div>
          {value === null && (
            <p className="mt-1 text-center text-[10px] text-ink-faint">
              Selle perioodi kohta ei saa seda arvutada.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A bound. Empty clears it back to the default rather than storing 0 — see
 * `setGaugeBounds`: "no target" and "target 0" are different answers.
 */
function Field({ label, value, placeholder, onChange }: {
  label: string
  value: number | undefined
  placeholder: string
  onChange: (n: number | undefined) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="flex-1 text-[11px] text-ink-muted">{label}</span>
      <input
        value={value ?? ''}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={e => {
          const raw = e.target.value.trim().replace(',', '.')
          if (raw === '') { onChange(undefined); return }
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="input w-24 text-right text-xs tabular-nums"
      />
    </label>
  )
}

/**
 * What a gauge can measure. Data and readers only — no React, no recharts.
 *
 * ── Why a reader and not another panel ──────────────────────────────────────
 * Every number here is already on a tile somewhere in the catalogue. A gauge
 * is not a new figure, it is the same figure asked a different question: not
 * "what is it" but "is it where it should be". That question needs bounds, and
 * bounds are the user's — one lab calls 90% on-time good and another has a
 * contract that says 98%.
 *
 * So a gauge is one panel type times a metric times the user's own limits,
 * instead of sixty more catalogue entries nobody can configure.
 *
 * ── Readers never compute ───────────────────────────────────────────────────
 * The same rule render.tsx states: `periodMetrics` and `calculateFinance` are
 * the only places allowed to decide what a figure means. A reader picks a field
 * off the context. It does not add two of them together — a gauge quietly
 * disagreeing with the tile beside it is the 19-vs-15 bug again.
 */
import type { PermissionKey } from '../../../hooks/usePermissions'
import type { PanelCtx, PanelNeed } from '../useStatsContext'

export type MetricUnit = 'eur' | 'pct' | 'days' | 'count'

export interface GaugeMetric {
  key: string
  label: string
  hint: string
  unit: MetricUnit
  /** Null when the context cannot answer — too few jobs, nothing with a deadline. */
  read: (ctx: PanelCtx) => number | null
  /**
   * Which direction is good. Drives the colour, and nothing else: a gauge that
   * went red for a GOOD turnaround would be worse than no colour at all.
   */
  higherIsBetter: boolean
  /** Where the arc ends until the user says otherwise. */
  defaultMax: number
  perm?: PermissionKey
  needs?: readonly PanelNeed[]
}

/**
 * Deliberately a short list of things somebody sets a target for.
 *
 * Not every number in `PanelCtx`: a gauge for "how many materials have we ever
 * used" is a dial with no meaningful limit, and offering forty of those buries
 * the eight that a lab actually manages against.
 */
export const GAUGE_METRICS: GaugeMetric[] = [
  {
    key: 'kasum', label: 'Kasum', unit: 'eur', higherIsBetter: true, defaultMax: 10000,
    hint: 'Tööde hinnad miinus kõik kulud',
    read: ctx => ctx.profit.profit, perm: 'payments.read', needs: ['finance'],
  },
  {
    key: 'kate_pct', label: 'Kasumimarginaal', unit: 'pct', higherIsBetter: true, defaultMax: 100,
    hint: 'Kasum protsendina tulust',
    read: ctx => ctx.profit.profitPct, perm: 'payments.read', needs: ['finance'],
  },
  {
    key: 'kaive', label: 'Käive', unit: 'eur', higherIsBetter: true, defaultMax: 20000,
    hint: 'Tööde hinnad koos muudatuste tasudega',
    read: ctx => ctx.m.money, perm: 'payments.read',
  },
  {
    key: 'arveldatud', label: 'Arveldatud', unit: 'eur', higherIsBetter: true, defaultMax: 20000,
    hint: 'Arvetele pandud, käibemaksuta',
    read: ctx => ctx.fin.billed, perm: 'payments.read', needs: ['finance'],
  },
  {
    key: 'laekunud', label: 'Laekunud', unit: 'eur', higherIsBetter: true, defaultMax: 20000,
    hint: 'Arvetelt päriselt kontole jõudnud',
    read: ctx => ctx.fin.received, perm: 'payments.read', needs: ['finance'],
  },
  {
    key: 'volg', label: 'Võlgu kokku', unit: 'eur', higherIsBetter: false, defaultMax: 5000,
    hint: 'Tasumata arved, kogu aeg — mitte ainult valitud periood',
    read: ctx => ctx.debt.outstanding, perm: 'payments.read', needs: ['finance'],
  },
  {
    key: 'tahtajas', label: 'Tähtajas valmis', unit: 'pct', higherIsBetter: true, defaultMax: 100,
    hint: 'Osa töödest, mis jõudsid valmis tähtajaks',
    read: ctx => ctx.onTime.ratePct, needs: ['flow'],
  },
  {
    key: 'labiaeg', label: 'Läbiaeg (mediaan)', unit: 'days', higherIsBetter: false, defaultMax: 14,
    hint: 'Mediaan päevades saabumisest valmimiseni',
    read: ctx => ctx.turnaround.median, needs: ['flow'],
  },
  {
    key: 'tood', label: 'Valmis tööd', unit: 'count', higherIsBetter: true, defaultMax: 100,
    hint: 'Tööde arv valitud perioodil',
    read: ctx => ctx.m.yksused,
  },
  {
    key: 'hambad', label: 'Hambad', unit: 'count', higherIsBetter: true, defaultMax: 500,
    hint: 'Toodetud hambaid valitud perioodil',
    read: ctx => ctx.m.hambad,
  },
  {
    key: 'kasum_too', label: 'Kasum töö kohta', unit: 'eur', higherIsBetter: true, defaultMax: 200,
    hint: 'Kasum jagatud tööde arvuga',
    read: ctx => ctx.unit.profitPerJob, perm: 'payments.read', needs: ['finance', 'unit'],
  },
  {
    key: 'kate_hammas', label: 'Kate hamba kohta', unit: 'eur', higherIsBetter: true, defaultMax: 100,
    hint: 'Tulu miinus kulu, hamba kohta',
    read: ctx => ctx.unit.marginPerTooth, perm: 'payments.read', needs: ['finance', 'unit'],
  },
]

export const METRIC_BY_KEY: Record<string, GaugeMetric> =
  Object.fromEntries(GAUGE_METRICS.map(m => [m.key, m]))

// ── Panel ids ────────────────────────────────────────────────────────────────

/**
 * A gauge's panel id. One per metric, not one per instance.
 *
 * ── Why not an instance id ──────────────────────────────────────────────────
 * An id ends up in `profiles.ui_prefs` on somebody's account, and the rule
 * there is "render the intersection, store the union": an older build keeps
 * ids it does not recognise. A generated `naidik:7f3a…` would be kept forever
 * by every client that cannot draw it, with nothing able to decide whether it
 * is a future panel or a dead one.
 *
 * A key derived from the metric is self-describing. The cost is that you cannot
 * have two gauges of the same metric with different bounds — which is a dial
 * showing one number twice, and nobody has asked for that.
 */
export const GAUGE_PREFIX = 'naidik:'

export const gaugePanelId = (metricKey: string): string => `${GAUGE_PREFIX}${metricKey}`

/** The metric a panel id names, or null when it is not a gauge at all. */
export function metricOfPanel(panelId: string): GaugeMetric | null {
  if (!panelId.startsWith(GAUGE_PREFIX)) return null
  return METRIC_BY_KEY[panelId.slice(GAUGE_PREFIX.length)] ?? null
}

// ── Bounds ───────────────────────────────────────────────────────────────────

export interface GaugeConfig {
  min?: number
  max?: number
  /** The line on the dial. Absent = no target drawn, and no "reached" colour. */
  target?: number
}

export interface GaugeBounds {
  min: number
  max: number
  target: number | null
}

/**
 * The bounds a gauge actually draws with.
 *
 * ── Why a bad max is repaired rather than refused ───────────────────────────
 * This runs on the render path from a value somebody is TYPING. A max below the
 * min is a normal intermediate state of typing "100" over "20", and a gauge
 * that throws, or blanks, while you type is unusable. So the arc always gets a
 * usable span, and the editor is where a nonsensical pair is pointed out.
 */
export function gaugeBounds(metric: GaugeMetric, cfg: GaugeConfig | undefined): GaugeBounds {
  const min = Number.isFinite(cfg?.min) ? (cfg!.min as number) : 0
  const wanted = Number.isFinite(cfg?.max) ? (cfg!.max as number) : metric.defaultMax
  // Never equal: a zero-width arc divides by zero and paints nothing, which
  // reads as "no data" rather than "your bounds are the same number".
  const max = wanted > min ? wanted : min + Math.max(1, Math.abs(metric.defaultMax))
  const target = Number.isFinite(cfg?.target) ? (cfg!.target as number) : null
  return { min, max, target }
}

/** Where the needle sits, 0–1. Clamped: a value past the end still reads full. */
export function gaugeFraction(value: number, bounds: GaugeBounds): number {
  const span = bounds.max - bounds.min
  if (span <= 0) return 0
  return Math.max(0, Math.min(1, (value - bounds.min) / span))
}

export type GaugeVerdict = 'good' | 'near' | 'bad' | 'none'

/**
 * Whether the value is where it should be.
 *
 * `none` when there is no target: a dial with no goal is a readout, and
 * colouring it green or red would be inventing an opinion the user never
 * expressed. That is the whole reason `target` is optional.
 *
 * "near" is within a tenth of the span — close enough that calling it a failure
 * would be the gauge nagging rather than reporting.
 */
export function gaugeVerdict(
  value: number | null, metric: GaugeMetric, bounds: GaugeBounds,
): GaugeVerdict {
  if (value === null || bounds.target === null) return 'none'
  const reached = metric.higherIsBetter ? value >= bounds.target : value <= bounds.target
  if (reached) return 'good'
  const slack = Math.abs(bounds.max - bounds.min) * 0.1
  const miss = Math.abs(value - bounds.target)
  return miss <= slack ? 'near' : 'bad'
}

/** How a metric's value is written. */
export function formatMetric(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'eur': return `${value.toFixed(2)} €`
    case 'pct': return `${value.toFixed(1)}%`
    case 'days': return `${value} p`
    case 'count': return String(value)
  }
}

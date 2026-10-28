/**
 * Gauge maths. Pure, so it is tested where it is decided rather than guessed at
 * from a picture of an arc.
 */
import { describe, it, expect } from 'vitest'
import {
  GAUGE_METRICS, METRIC_BY_KEY, gaugePanelId, metricOfPanel,
  gaugeBounds, gaugeFraction, gaugeVerdict, formatMetric,
  type GaugeMetric,
} from './metrics'

const metric = (over: Partial<GaugeMetric> = {}): GaugeMetric => ({
  key: 'test', label: 'Test', hint: '', unit: 'eur',
  higherIsBetter: true, defaultMax: 100, read: () => 0, ...over,
})

describe('panel ids', () => {
  it('round-trips a metric through its panel id', () => {
    for (const m of GAUGE_METRICS) {
      expect(metricOfPanel(gaugePanelId(m.key))).toBe(m)
    }
  })

  it('REFUSES an id that is not a gauge', () => {
    expect(metricOfPanel('raha.kasum')).toBeNull()
    expect(metricOfPanel('')).toBeNull()
  })

  it('REFUSES a gauge id naming a metric this build does not have', () => {
    // A dashboard written by a newer version. It must read as "not mine",
    // never as a gauge with an undefined metric.
    expect(metricOfPanel('naidik:tulevikumootmik')).toBeNull()
  })

  it('has unique metric keys', () => {
    expect(Object.keys(METRIC_BY_KEY).length).toBe(GAUGE_METRICS.length)
  })
})

describe('gaugeBounds', () => {
  it('falls back to the metric default when nothing is set', () => {
    expect(gaugeBounds(metric(), undefined)).toEqual({ min: 0, max: 100, target: null })
  })

  it('takes the stored bounds', () => {
    expect(gaugeBounds(metric(), { min: 10, max: 50, target: 30 }))
      .toEqual({ min: 10, max: 50, target: 30 })
  })

  it('REPAIRS a max below the min rather than throwing', () => {
    // This runs while somebody is typing "100" over "20", so the intermediate
    // "1" is a normal state and must still draw an arc.
    const got = gaugeBounds(metric(), { min: 40, max: 1 })
    expect(got.min).toBe(40)
    expect(got.max).toBeGreaterThan(40)
  })

  it('REFUSES a zero-width arc, which would paint nothing', () => {
    const got = gaugeBounds(metric(), { min: 50, max: 50 })
    expect(got.max).toBeGreaterThan(got.min)
  })

  it('ignores NaN, which is what a half-typed number produces', () => {
    expect(gaugeBounds(metric(), { max: Number.NaN }).max).toBe(100)
    expect(gaugeBounds(metric(), { target: Number.NaN }).target).toBeNull()
  })

  it('allows a negative minimum — profit can be below zero', () => {
    expect(gaugeBounds(metric(), { min: -5000, max: 5000 }).min).toBe(-5000)
  })
})

describe('gaugeFraction', () => {
  const b = { min: 0, max: 200, target: null }

  it('places the value along the span', () => {
    expect(gaugeFraction(0, b)).toBe(0)
    expect(gaugeFraction(100, b)).toBe(0.5)
    expect(gaugeFraction(200, b)).toBe(1)
  })

  it('clamps past either end instead of drawing outside the arc', () => {
    expect(gaugeFraction(500, b)).toBe(1)
    expect(gaugeFraction(-50, b)).toBe(0)
  })

  it('handles a span that does not start at zero', () => {
    expect(gaugeFraction(75, { min: 50, max: 100, target: null })).toBe(0.5)
  })
})

describe('gaugeVerdict', () => {
  const bounds = { min: 0, max: 100, target: 80 }

  it('is "none" without a target — no goal, no opinion', () => {
    expect(gaugeVerdict(10, metric(), { min: 0, max: 100, target: null })).toBe('none')
  })

  it('is "none" when there is no value to judge', () => {
    expect(gaugeVerdict(null, metric(), bounds)).toBe('none')
  })

  it('is good at or above the target when higher is better', () => {
    expect(gaugeVerdict(80, metric(), bounds)).toBe('good')
    expect(gaugeVerdict(95, metric(), bounds)).toBe('good')
  })

  it('INVERTS for a metric where lower is better', () => {
    // Turnaround days and debt. A gauge going red for a GOOD turnaround would
    // be worse than no colour at all.
    const faster = metric({ higherIsBetter: false })
    expect(gaugeVerdict(60, faster, bounds)).toBe('good')
    expect(gaugeVerdict(95, faster, bounds)).toBe('bad')
  })

  it('is "near" within a tenth of the span, so it reports rather than nags', () => {
    expect(gaugeVerdict(75, metric(), bounds)).toBe('near')
    expect(gaugeVerdict(69, metric(), bounds)).toBe('bad')
  })
})

describe('formatMetric', () => {
  it('writes each unit the way the rest of the app does', () => {
    expect(formatMetric(1234.5, 'eur')).toBe('1234.50 €')
    expect(formatMetric(92.34, 'pct')).toBe('92.3%')
    expect(formatMetric(7, 'days')).toBe('7 p')
    expect(formatMetric(42, 'count')).toBe('42')
  })
})

describe('the metric list itself', () => {
  it('gives every metric a label and a hint', () => {
    for (const m of GAUGE_METRICS) {
      expect(m.label.trim().length, m.key).toBeGreaterThan(0)
      expect(m.hint.trim().length, m.key).toBeGreaterThan(0)
    }
  })

  it('gives every metric a positive default max, so the arc has a span', () => {
    for (const m of GAUGE_METRICS) expect(m.defaultMax, m.key).toBeGreaterThan(0)
  })

  it('gates every money metric behind a permission', () => {
    // The same rule the catalogue test applies to panels, checked at the
    // source: a metric that reaches finance or unit economics is payroll and
    // margins, and Statistika itself is gated only by `stats.read`.
    for (const m of GAUGE_METRICS) {
      if (!m.needs?.some(n => n === 'finance' || n === 'unit' || n === 'invoices')) continue
      expect(m.perm, m.key).toBeDefined()
    }
  })
})

/**
 * The forward-compatibility contract for per-user preferences.
 *
 * Every case here is a way a dashboard could silently lose panels: an older
 * build meeting a newer id, a hand-edited layout confused with an untouched
 * one, a corrupted value. The store around this file is a scheduler; this is
 * where the data would actually be destroyed.
 */
import { describe, it, expect } from 'vitest'
import {
  normaliseUiPrefs, knownPanels, reorderPreserving, withDashboard, clampSize,
  MAX_PANELS, UI_PREFS_VERSION, GRID_COLS, MAX_PANEL_ROWS,
} from './uiPrefs'

const KNOWN = new Set(['a', 'b', 'c', 'd'])

describe('normaliseUiPrefs', () => {
  it('reads nothing as never-customised, not as an empty dashboard', () => {
    for (const raw of [null, undefined, {}, 'x', 42, []]) {
      expect(normaliseUiPrefs(raw).dashboard).toBeUndefined()
    }
  })

  it('keeps an empty panel list as a real answer', () => {
    // "I removed everything" must survive. Folding it into "never customised"
    // would hand the panels back on the next load.
    const out = normaliseUiPrefs({ v: 1, dashboard: { preset: null, panels: [] } })
    expect(out.dashboard).toEqual({ preset: null, panels: [] })
  })

  it('carries keys it does not understand through untouched', () => {
    const out = normaliseUiPrefs({
      v: 2,
      dashboard: { preset: 'cfo', panels: ['a'], density: 'compact' },
      calendarPrefs: { zoom: 3 },
    })
    expect(out.calendarPrefs).toEqual({ zoom: 3 })
    expect((out.dashboard as unknown as Record<string, unknown>).density).toBe('compact')
    expect(out.v).toBe(2)
  })

  it('drops duplicates keeping the first position', () => {
    const out = normaliseUiPrefs({ dashboard: { panels: ['a', 'b', 'a', 'c', 'b'] } })
    expect(out.dashboard!.panels).toEqual(['a', 'b', 'c'])
  })

  it('survives junk without throwing', () => {
    expect(normaliseUiPrefs({ dashboard: { panels: 'nope' } }).dashboard).toBeUndefined()
    expect(normaliseUiPrefs({ dashboard: 7 }).dashboard).toBeUndefined()
    const mixed = normaliseUiPrefs({ dashboard: { panels: ['a', 3, null, '', '  ', 'b'] } })
    expect(mixed.dashboard!.panels).toEqual(['a', 'b'])
  })

  it('caps a runaway list', () => {
    const many = Array.from({ length: 500 }, (_, i) => `p${i}`)
    expect(normaliseUiPrefs({ dashboard: { panels: many } }).dashboard!.panels)
      .toHaveLength(MAX_PANELS)
  })

  it('reads a missing preset as null rather than inventing one', () => {
    expect(normaliseUiPrefs({ dashboard: { panels: ['a'] } }).dashboard!.preset).toBeNull()
  })
})

describe('knownPanels', () => {
  it('renders only what this build can draw, in stored order', () => {
    expect(knownPanels(['c', 'from_the_future', 'a'], KNOWN)).toEqual(['c', 'a'])
  })
})

describe('reorderPreserving — an unknown id survives an older build', () => {
  it('keeps an unknown id and its position across a round trip', () => {
    // 1.62 wrote ['a', 'NEW', 'b']. 1.58 knows nothing of NEW, draws [a, b],
    // and the user drags b above a.
    const stored = ['a', 'NEW', 'b']
    const next = reorderPreserving(stored, ['b', 'a'], KNOWN)
    expect(next).toContain('NEW')
    // Anchored after 'a', which is where its owner put it.
    expect(next).toEqual(['b', 'a', 'NEW'])
  })

  it('keeps a leading unknown id at the front', () => {
    expect(reorderPreserving(['NEW', 'a', 'b'], ['b', 'a'], KNOWN)).toEqual(['NEW', 'b', 'a'])
  })

  it('keeps consecutive unknowns in their own order', () => {
    const next = reorderPreserving(['a', 'X', 'Y', 'b'], ['a', 'b'], KNOWN)
    expect(next).toEqual(['a', 'X', 'Y', 'b'])
  })

  it('falls back to the end when the anchor was removed', () => {
    // 'a' is dragged out of the layout entirely; 'X' anchored to it.
    const next = reorderPreserving(['a', 'X', 'b'], ['b'], KNOWN)
    expect(next).toEqual(['b', 'X'])
  })

  it('does nothing clever when there is nothing unknown', () => {
    expect(reorderPreserving(['a', 'b'], ['b', 'a'], KNOWN)).toEqual(['b', 'a'])
  })

  it('never grows past the cap', () => {
    const stored = Array.from({ length: MAX_PANELS }, (_, i) => `u${i}`)
    expect(reorderPreserving(stored, ['a'], KNOWN).length).toBeLessThanOrEqual(MAX_PANELS)
  })
})

describe('withDashboard', () => {
  it('replaces the dashboard slice and leaves every other key alone', () => {
    const before = normaliseUiPrefs({ v: 1, calendarPrefs: { zoom: 3 } })
    const after = withDashboard(before, { preset: null, panels: ['a'] })
    expect(after.calendarPrefs).toEqual({ zoom: 3 })
    expect(after.dashboard).toEqual({ preset: null, panels: ['a'] })
    expect(after.v).toBe(UI_PREFS_VERSION)
  })

  it('round-trips: save → normalise → same value', () => {
    const saved = withDashboard(normaliseUiPrefs({ other: 1 }), { preset: 'ceo', panels: ['a', 'NEW'] })
    expect(normaliseUiPrefs(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
})

describe('paneelide suurused', () => {
  it('clamps to the grid instead of trusting the stored value', () => {
    expect(clampSize(99, 99)).toEqual([GRID_COLS, MAX_PANEL_ROWS])
    expect(clampSize(0, 0)).toEqual([1, 1])
    expect(clampSize(-3, 2.4)).toEqual([1, 2])
  })

  it('reads a stored size map and clamps every entry', () => {
    const out = normaliseUiPrefs({
      dashboard: { panels: ['a', 'b'], sizes: { a: [2, 2], b: [40, 40] } },
    })
    expect(out.dashboard!.sizes).toEqual({ a: [2, 2], b: [GRID_COLS, MAX_PANEL_ROWS] })
  })

  it('drops junk entries without losing the good ones', () => {
    const out = normaliseUiPrefs({
      dashboard: {
        panels: ['a'],
        sizes: { a: [2, 1], bad: 'nope', worse: [1], nan: [NaN, 2] },
      },
    })
    expect(out.dashboard!.sizes).toEqual({ a: [2, 1] })
  })

  it('leaves the key out entirely when nothing has been resized', () => {
    const out = normaliseUiPrefs({ dashboard: { panels: ['a'], sizes: {} } })
    expect(out.dashboard).not.toHaveProperty('sizes')
  })

  it('keeps a size for an id this build does not know', () => {
    // Same rule as the panel list: a size written by a newer version survives a
    // round trip through an older one.
    const out = normaliseUiPrefs({
      dashboard: { panels: ['a', 'FUTURE'], sizes: { FUTURE: [4, 3] } },
    })
    expect(out.dashboard!.sizes).toEqual({ FUTURE: [4, 3] })
  })

  it('round-trips sizes through save → normalise', () => {
    const saved = withDashboard(normaliseUiPrefs({}), {
      preset: null, panels: ['a'], sizes: { a: [2, 2] },
    })
    expect(normaliseUiPrefs(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
})

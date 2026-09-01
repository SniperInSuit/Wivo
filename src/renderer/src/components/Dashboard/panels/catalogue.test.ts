/**
 * Registry consistency. Pure data, no JSX — which is the reason the catalogue
 * is a separate file from the renderers in the first place.
 *
 * The failure this catches is invisible at runtime by design: an id that does
 * not exist is treated as "a panel from a newer version", so a typo in a preset
 * would silently produce a dashboard with a missing card and no error anywhere.
 */
import { describe, it, expect } from 'vitest'
import {
  PANEL_CATALOGUE, PANEL_BY_ID, KNOWN_PANEL_IDS, PANEL_GROUP_LABEL, type PanelMeta,
} from './catalogue'
import { PRESETS } from './presets'
import { RETIRED_PANEL_IDS } from '../../../lib/uiPrefs'

const ALL: readonly PanelMeta[] = PANEL_CATALOGUE

describe('paneelide kataloog', () => {
  it('has unique ids', () => {
    const ids = ALL.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every panel an Estonian title and a group with a label', () => {
    for (const p of ALL) {
      expect(p.title.trim().length, p.id).toBeGreaterThan(0)
      expect(PANEL_GROUP_LABEL[p.group], p.id).toBeDefined()
      const [w, h] = p.defaultSize
      expect(w, p.id).toBeGreaterThanOrEqual(1)
      expect(w, p.id).toBeLessThanOrEqual(4)
      expect(h, p.id).toBeGreaterThanOrEqual(1)
      expect(h, p.id).toBeLessThanOrEqual(6)
    }
  })

  it('names only panels that exist, in every preset', () => {
    for (const preset of PRESETS) {
      for (const id of preset.panels) {
        expect(KNOWN_PANEL_IDS.has(id), `${preset.key} → ${id}`).toBe(true)
      }
      expect(new Set(preset.panels).size, preset.key).toBe(preset.panels.length)
    }
  })

  it('gates every money panel behind a permission', () => {
    // A panel reading any of these shows margins, wages, debt or unit prices.
    // Statistika itself is gated only by `stats.read`, so without this the
    // customisable dashboard would be a way to surface payroll and receivables
    // to anyone who can open the page.
    const MONEY_NEEDS = ['finance', 'invoices', 'unit']
    // Panels that read a money aggregate for its COUNTS only. Each one is
    // listed by hand, so adding a money panel cannot join them by accident.
    const COUNTS_ONLY = ['inim.tootaja_tootlikkus', 'inim.katvus', 'inim.kliendid_seis']
    for (const p of ALL) {
      if (!p.needs?.some(n => MONEY_NEEDS.includes(n))) continue
      if (COUNTS_ONLY.includes(p.id)) continue
      expect(p.perm, p.id).toBeDefined()
    }
  })

  it('keeps the fun group free of anything needing a permission', () => {
    // "Lõbus teada" is for everyone in the lab. A curiosity that turns out to
    // need payments.read is a money panel wearing a smile.
    for (const p of ALL.filter(x => x.group === 'lobus')) {
      expect(p.perm, p.id).toBeUndefined()
    }
  })

  it('keeps the technician preset free of money entirely', () => {
    // Not merely permission-filtered: a technician granted payments.read by
    // accident should still open on a sane view.
    for (const id of PRESETS.find(p => p.key === 'tehnik')!.panels) {
      expect(PANEL_BY_ID[id].group, id).not.toBe('raha')
      expect(PANEL_BY_ID[id].group, id).not.toBe('yhik')
    }
  })

  it('points every retired id at something that exists, or at null', () => {
    for (const [from, to] of Object.entries(RETIRED_PANEL_IDS)) {
      expect(KNOWN_PANEL_IDS.has(from), `${from} is retired but still in the catalogue`).toBe(false)
      if (to !== null) expect(KNOWN_PANEL_IDS.has(to), `${from} → ${to}`).toBe(true)
    }
  })
})

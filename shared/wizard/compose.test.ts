/**
 * kirjeldus is the only place four wizard fields can be stored, so the exact
 * text it produces is a contract with the Edit page — that is what the user
 * reads back later.
 */
import { describe, expect, it } from 'vitest'
import { composeKirjeldus } from './compose'
import type { NewJobState } from './types'
import { createEmptyNewJobState } from './types'

const state = (over: Partial<NewJobState> = {}): NewJobState => ({
  ...createEmptyNewJobState(),
  ...over,
})

describe('composeKirjeldus', () => {
  it('is null when there is nothing to say', () => {
    expect(composeKirjeldus(state())).toBeNull()
    expect(composeKirjeldus(state({ description: '   ', notes: '\n' }))).toBeNull()
  })

  it('keeps the fixed line order', () => {
    const out = composeKirjeldus(state({
      description: 'Ülemine esihammas',
      materials: ['Crown HT', 'Ceramic Crown', 'OnX Tough 2'],
      glaze: 'Matt',
      texture: 'Kerge',
      notes: 'Patsient tuleb reedel',
    }))
    expect(out).toBe([
      'Ülemine esihammas',
      'Lisamaterjalid: Ceramic Crown, OnX Tough 2',
      'Glasuur: Matt',
      'Tekstuur: Kerge',
      'Märkus: Patsient tuleb reedel',
    ].join('\n'))
  })

  it('omits every empty line rather than leaving blanks', () => {
    expect(composeKirjeldus(state({ glaze: 'Matt' }))).toBe('Glasuur: Matt')
  })

  it('never repeats the priced material', () => {
    expect(composeKirjeldus(state({ materials: ['Crown HT'] }))).toBeNull()
  })

  it('trims what the user typed', () => {
    expect(composeKirjeldus(state({ description: '  Sild 14-16  ' }))).toBe('Sild 14-16')
  })
})

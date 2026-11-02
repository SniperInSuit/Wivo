import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  SOUNDS, DEFAULT_SOUND_SETTINGS, decideSound, recordSound, emptyGate, inQuietHours,
  normaliseSoundSettings, INTERFACE_GAIN, type SoundName,
} from './soundCore'

const on = { ...DEFAULT_SOUND_SETTINGS, interface: true }
const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m)
const ctx = (over: Partial<Parameters<typeof decideSound>[1]> = {}) =>
  ({ nowMs: 10_000, now: at(12), settings: on, gate: emptyGate(), loaded: true, random: () => 0.5, ...over })

describe('decideSound', () => {
  it('defaults: notifications on, interface sounds off', () => {
    expect(decideSound('notify-message', ctx({ settings: DEFAULT_SOUND_SETTINGS })).play).toBe(true)
    expect(decideSound('ui-check', ctx({ settings: DEFAULT_SOUND_SETTINGS }))).toEqual({ play: false, reason: 'category-off' })
  })

  it('the master switch and zero volume silence everything', () => {
    expect(decideSound('notify-error', ctx({ settings: { ...on, enabled: false } }))).toEqual({ play: false, reason: 'off' })
    expect(decideSound('notify-error', ctx({ settings: { ...on, volume: 0 } }))).toEqual({ play: false, reason: 'off' })
  })

  it('a missing file is skipped, not an error', () => {
    expect(decideSound('ui-tab', ctx({ loaded: false }))).toEqual({ play: false, reason: 'missing' })
  })

  it('notifications never overlap: a second within 1 s is skipped, after 1 s it plays', () => {
    const gate = emptyGate()
    recordSound(gate, 'notify-message', 10_000)
    expect(decideSound('notify-upload-done', ctx({ gate, nowMs: 10_999 }))).toEqual({ play: false, reason: 'overlap' })
    expect(decideSound('notify-upload-done', ctx({ gate, nowMs: 11_000 })).play).toBe(true)
  })

  it('the same interface sound plays at most once per 80 ms; a different one is not held back', () => {
    const gate = emptyGate()
    recordSound(gate, 'ui-tick', 10_000)
    expect(decideSound('ui-tick', ctx({ gate, nowMs: 10_079 }))).toEqual({ play: false, reason: 'throttled' })
    expect(decideSound('ui-tick', ctx({ gate, nowMs: 10_080 })).play).toBe(true)
    expect(decideSound('ui-check', ctx({ gate, nowMs: 10_010 })).play).toBe(true)
  })

  it('interface sounds vary pitch by at most ±3 % and sit about 8 dB lower', () => {
    const lo = decideSound('ui-drop', ctx({ random: () => 0 }))
    const hi = decideSound('ui-drop', ctx({ random: () => 0.999999 }))
    expect(lo).toMatchObject({ play: true, rate: 0.97 })
    expect(hi.play && hi.rate).toBeCloseTo(1.03, 4)
    expect(lo.play && lo.gain).toBeCloseTo(on.volume * INTERFACE_GAIN, 6)
    expect(20 * Math.log10(INTERFACE_GAIN)).toBeCloseTo(-8, 1)
    expect(decideSound('notify-message', ctx())).toMatchObject({ rate: 1, gain: on.volume })
  })

  it('quiet hours silence both kinds', () => {
    const quiet = { ...on, quietFrom: '22:00', quietTo: '07:00' }
    expect(decideSound('notify-message', ctx({ settings: quiet, now: at(23, 30) }))).toEqual({ play: false, reason: 'quiet-hours' })
    expect(decideSound('ui-check', ctx({ settings: quiet, now: at(6, 59) }))).toEqual({ play: false, reason: 'quiet-hours' })
    expect(decideSound('notify-message', ctx({ settings: quiet, now: at(7) })).play).toBe(true)
  })
})

describe('inQuietHours', () => {
  it('same-day and across-midnight ranges; unset or empty ranges are never quiet', () => {
    expect(inQuietHours(at(13), '12:00', '14:00')).toBe(true)
    expect(inQuietHours(at(14), '12:00', '14:00')).toBe(false)
    expect(inQuietHours(at(0, 30), '22:00', '07:00')).toBe(true)
    expect(inQuietHours(at(12), '22:00', '07:00')).toBe(false)
    expect(inQuietHours(at(12), null, '07:00')).toBe(false)
    expect(inQuietHours(at(12), '08:00', '08:00')).toBe(false)
  })
})

describe('settings', () => {
  it('garbage becomes the defaults; good values survive; volume is clamped', () => {
    expect(normaliseSoundSettings('nope')).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(normaliseSoundSettings({ interface: true, volume: 3, quietFrom: '22:00', quietTo: '7:00' }))
      .toEqual({ ...DEFAULT_SOUND_SETTINGS, interface: true, volume: 1, quietFrom: '22:00', quietTo: null })
  })
})

describe('the files', () => {
  it('every registered sound has its file, except the two that have no recording yet', () => {
    const dir = join(__dirname, '..', '..', 'public', 'sounds')
    const missing = (Object.keys(SOUNDS) as SoundName[]).filter(n => !existsSync(join(dir, SOUNDS[n].file)))
    expect(missing.sort()).toEqual(['ui-tab', 'ui-tick'])
  })
})

import { mentionsMe } from '../components/Partners/JobThread'

describe('mentionsMe', () => {
  it('first name or username after @, not inside an e-mail address', () => {
    expect(mentionsMe('@Mari can you check 21?', 'Mari Maasikas', null)).toBe(true)
    expect(mentionsMe('ping @mari.k', 'Mari Maasikas', 'mari.k')).toBe(true)
    expect(mentionsMe('write to mari@example.com', 'Mari Maasikas', null)).toBe(false)
    expect(mentionsMe('@Marika is here', 'Mari Maasikas', null)).toBe(false)
  })
})

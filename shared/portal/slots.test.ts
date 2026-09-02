import { describe, it, expect } from 'vitest'
import {
  freeSlots, openWindows, slotsByDay, slotStillFree, toMinutes, toClock,
} from './slots'
import type { BookingRules, DayLoad, SlotsInput } from './slots'

/** Mon–Fri 09:00–17:00, lunch 12:00–13:00. */
const RULES: BookingRules = {
  tooajad: {
    '1': [{ algus: '09:00', lopp: '17:00' }],
    '2': [{ algus: '09:00', lopp: '17:00' }],
    '3': [{ algus: '09:00', lopp: '17:00' }],
    '4': [{ algus: '09:00', lopp: '17:00' }],
    '5': [{ algus: '09:00', lopp: '17:00' }],
  },
  pausid: [{ algus: '12:00', lopp: '13:00' }],
  samm: 30,
  ette: 1,
  kuni: 30,
}

const day = (kuupaev: string, over: Partial<DayLoad> = {}): DayLoad =>
  ({ kuupaev, hoivatud: [], suuri: 0, ...over })

/** 2026-09-07 is a Monday. Days run Mon→Sun from there. */
const WEEKDAY: Record<string, number> = {
  '2026-09-07': 1, '2026-09-08': 2, '2026-09-09': 3, '2026-09-10': 4,
  '2026-09-11': 5, '2026-09-12': 6, '2026-09-13': 7,
}

const input = (over: Partial<SlotsInput> = {}): SlotsInput => ({
  rules: RULES,
  kestus: 60,
  paevad: [day('2026-09-07')],
  nadalapaev: d => WEEKDAY[d] ?? 1,
  tana: '2026-09-01',
  paevaVahe: d => Number(d.slice(-2)) - 1,   // day-of-month minus the 1st
  ...over,
})

describe('openWindows — millal on lahti', () => {
  it('lõikab pausi keskelt välja', () => {
    expect(openWindows(RULES, 1)).toEqual([
      { algus: 9 * 60, lopp: 12 * 60 },
      { algus: 13 * 60, lopp: 17 * 60 },
    ])
  })

  it('nädalavahetus on kinni, sest kirjet ei ole', () => {
    // Absence means CLOSED. A missing setting must never open the diary.
    expect(openWindows(RULES, 6)).toEqual([])
    expect(openWindows(RULES, 7)).toEqual([])
  })

  it('paus väljaspool tööaega ei muuda midagi', () => {
    const r: BookingRules = { ...RULES, pausid: [{ algus: '20:00', lopp: '21:00' }] }
    expect(openWindows(r, 1)).toEqual([{ algus: 540, lopp: 1020 }])
  })

  it('eirab vigast kellaaega, mitte ei kuku', () => {
    const r: BookingRules = { tooajad: { '1': [{ algus: '25:00', lopp: 'ho' }] } }
    expect(openWindows(r, 1)).toEqual([])
  })
})

describe('freeSlots — mis päriselt vabaks jääb', () => {
  it('annab ajad sammu kaupa, mahtudes enne sulgemist ära', () => {
    const s = freeSlots(input())
    expect(s[0].kell).toBe('09:00')
    // A 60-minute job cannot start at 11:30 with lunch at 12:00.
    expect(s.map(x => x.kell)).toContain('11:00')
    expect(s.map(x => x.kell)).not.toContain('11:30')
    // Nor at 16:30, because it would run past 17:00.
    expect(s.map(x => x.kell)).not.toContain('16:30')
    expect(s[s.length - 1].kell).toBe('16:00')
  })

  it('ei paku aega hõivatud aja peal', () => {
    const s = freeSlots(input({
      paevad: [day('2026-09-07', { hoivatud: [{ algus: 600, lopp: 660 }] })],
    }))
    expect(s.map(x => x.kell)).not.toContain('10:00')
    // Touching is not overlapping: 11:00 starts exactly when the other ends.
    expect(s.map(x => x.kell)).toContain('11:00')
    expect(s.map(x => x.kell)).toContain('09:00')
  })

  it('mitme tooliga mahub kaks korraga', () => {
    const busy = day('2026-09-07', { hoivatud: [{ algus: 600, lopp: 660 }] })
    expect(freeSlots(input({ paevad: [busy] })).map(x => x.kell)).not.toContain('10:00')
    expect(freeSlots(input({
      rules: { ...RULES, kohti: 2 }, paevad: [busy],
    })).map(x => x.kell)).toContain('10:00')
  })

  it('nädalavahetusel ei ole midagi', () => {
    expect(freeSlots(input({ paevad: [day('2026-09-12'), day('2026-09-13')] })))
      .toEqual([])
  })

  it('puhkusepäev on kinni, ka argipäeval', () => {
    const r: BookingRules = { ...RULES, puhkused: ['2026-09-07'] }
    expect(freeSlots(input({ rules: r }))).toEqual([])
  })

  it('austab etteteatamist ja horisonti', () => {
    // `ette: 1` — nothing today.
    const r: BookingRules = { ...RULES, ette: 10, kuni: 12 }
    const days = [day('2026-09-07'), day('2026-09-11')]   // 6 and 10 days away
    const s = freeSlots(input({ rules: r, paevad: days }))
    expect(new Set(s.map(x => x.kuupaev))).toEqual(new Set(['2026-09-11']))
  })

  it('pikk töö mahub ainult sellesse aknasse, kuhu ta ära mahub', () => {
    // Lunch splits the day into 09:00–12:00 (180 min) and 13:00–17:00 (240).
    // A four-hour job fits the afternoon EXACTLY and the morning not at all.
    expect(freeSlots(input({ kestus: 240 })).map(x => x.kell)).toEqual(['13:00'])
    // Five hours fits neither window, so the day offers nothing — the job does
    // not silently run through lunch.
    expect(freeSlots(input({ kestus: 300 }))).toEqual([])
  })

  it('kestuseta ei paku midagi', () => {
    expect(freeSlots(input({ kestus: 0 }))).toEqual([])
    expect(freeSlots(input({ kestus: -30 }))).toEqual([])
  })
})

describe('koormus — mitu suurt tööd päevas', () => {
  // The clinic's own rule: a day the website can fill with four full-arch cases
  // is a day the practice cannot work.
  const rules: BookingRules = { ...RULES, koormus: { suurMin: 120, suuriPaevas: 1 } }

  it('sulgeb päeva suurele tööle, kui kvoot on täis', () => {
    const full = day('2026-09-07', { suuri: 1 })
    expect(freeSlots(input({ rules, kestus: 180, paevad: [full] }))).toEqual([])
  })

  it('aga väike töö mahub samale päevale edasi', () => {
    const full = day('2026-09-07', { suuri: 1 })
    expect(freeSlots(input({ rules, kestus: 60, paevad: [full] })).length).toBeGreaterThan(0)
  })

  it('tühjal päeval on suur töö lubatud', () => {
    expect(freeSlots(input({ rules, kestus: 180, paevad: [day('2026-09-07')] })).length)
      .toBeGreaterThan(0)
  })

  it('ilma koormusreeglita ei piira miski', () => {
    const noRule = { ...RULES }
    expect(freeSlots(input({ rules: noRule, kestus: 180, paevad: [day('2026-09-07', { suuri: 9 })] })).length)
      .toBeGreaterThan(0)
  })
})

describe('slotsByDay ja slotStillFree', () => {
  it('rühmitab päevade kaupa, ajaliselt järjestatult', () => {
    const grouped = slotsByDay(freeSlots(input({
      paevad: [day('2026-09-08'), day('2026-09-07')],
    })))
    expect(grouped.map(g => g.kuupaev)).toEqual(['2026-09-07', '2026-09-08'])
    expect(grouped[0].kellad[0]).toBe('09:00')
  })

  it('slotStillFree kordab sama otsust, mitte teist', () => {
    // The list is a snapshot; the booking is a decision. Both must say the same
    // thing about the same slot, or somebody is double-booked.
    expect(slotStillFree(input(), '2026-09-07', '09:00')).toBe(true)
    const taken = input({
      paevad: [day('2026-09-07', { hoivatud: [{ algus: 540, lopp: 600 }] })],
    })
    expect(slotStillFree(taken, '2026-09-07', '09:00')).toBe(false)
  })
})

describe('kellaaja teisendus', () => {
  it('läheb mõlemat pidi', () => {
    expect(toMinutes('09:30')).toBe(570)
    expect(toClock(570)).toBe('09:30')
    expect(toClock(0)).toBe('00:00')
  })

  it('keeldub jamast', () => {
    for (const bad of ['', '9:5', '24:00', '12:60', 'lõuna', '12-30']) {
      expect(toMinutes(bad), bad).toBe(-1)
    }
    expect(toMinutes('9:05')).toBe(545)   // a single-digit hour is fine
  })
})

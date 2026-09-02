/**
 * Which times are actually free — the slot picker's whole brain.
 *
 * ── No time zone lives in this file, on purpose ──────────────────────────────
 * Everything here is LOCAL WALL CLOCK: a date as 'YYYY-MM-DD' and a time as
 * minutes from local midnight. The caller converts real timestamps into that
 * shape before calling, and converts a chosen slot back afterwards.
 *
 * This is not squeamishness. Estonia moves between UTC+2 and UTC+3, and the
 * classic failure is a slot list that is correct in July and an hour wrong in
 * November — usually discovered by a patient who arrives at the wrong time. By
 * keeping the arithmetic in wall clock and the conversion in exactly one place,
 * there is one line to get right instead of forty.
 *
 * ── A free slot is not a promise ─────────────────────────────────────────────
 * Two people can be looking at the same list. The booking itself has to check
 * again at write time; this function narrows the choice, it does not reserve
 * anything.
 *
 * The `shared/` contract applies: no dependencies at all. See shared/README.md.
 */

/** 'HH:mm' → minutes from midnight. -1 when it is not a time. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return -1
  const h = Number(m[1]), min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return -1
  return h * 60 + min
}

/** Minutes from midnight → 'HH:mm'. */
export function toClock(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface OpenPeriod { algus: string; lopp: string }

export interface BookingRules {
  /**
   * Opening hours per ISO weekday, 1 = Monday … 7 = Sunday. A weekday with no
   * entry, or an empty list, is closed — absence means closed rather than
   * "all day", because a missing setting must never open the diary.
   */
  tooajad: Partial<Record<string, OpenPeriod[]>>
  /** Daily breaks, every open day. Lunch, mostly. */
  pausid?: OpenPeriod[]
  /** 'YYYY-MM-DD' the clinic is shut regardless of the weekday. */
  puhkused?: string[]
  /** Slot granularity in minutes. 15 unless told otherwise. */
  samm?: number
  /** Soonest bookable, in days from today. 1 = from tomorrow. */
  ette?: number
  /** Furthest bookable, in days from today. */
  kuni?: number
  /** How many appointments can run at once — chairs, or dentists. */
  kohti?: number
  /**
   * Load control. "A big job" is one at least `suurMin` minutes long, and a day
   * takes at most `suuriPaevas` of them.
   *
   * The clinic's own words: there must not be too many big jobs in one day. A
   * diary that lets the website fill Tuesday with four full-arch cases is a
   * diary the practice cannot work.
   */
  koormus?: { suurMin: number; suuriPaevas: number }
}

/** One day's existing load, already converted to local wall clock. */
export interface DayLoad {
  kuupaev: string
  hoivatud: { algus: number; lopp: number }[]
  /** How many of those already count as big. */
  suuri: number
}

export interface Slot {
  kuupaev: string
  /** 'HH:mm' local. */
  kell: string
  kestus: number
}

const DEFAULT_STEP = 15

function overlaps(a: { algus: number; lopp: number }, b: { algus: number; lopp: number }): boolean {
  // Touching is not overlapping: a visit ending at 10:00 and one starting at
  // 10:00 are back to back, which is how a day is filled.
  return a.algus < b.lopp && b.algus < a.lopp
}

/** Periods a day is open, minus its breaks. */
export function openWindows(rules: BookingRules, weekday: number): { algus: number; lopp: number }[] {
  const raw = rules.tooajad?.[String(weekday)] ?? []
  const breaks = (rules.pausid ?? [])
    .map(p => ({ algus: toMinutes(p.algus), lopp: toMinutes(p.lopp) }))
    .filter(p => p.algus >= 0 && p.lopp > p.algus)

  let windows = raw
    .map(p => ({ algus: toMinutes(p.algus), lopp: toMinutes(p.lopp) }))
    .filter(p => p.algus >= 0 && p.lopp > p.algus)

  for (const b of breaks) {
    const next: { algus: number; lopp: number }[] = []
    for (const w of windows) {
      if (!overlaps(w, b)) { next.push(w); continue }
      if (b.algus > w.algus) next.push({ algus: w.algus, lopp: Math.min(b.algus, w.lopp) })
      if (b.lopp < w.lopp) next.push({ algus: Math.max(b.lopp, w.algus), lopp: w.lopp })
    }
    windows = next
  }
  return windows.filter(w => w.lopp > w.algus).sort((a, b) => a.algus - b.algus)
}

export interface SlotsInput {
  rules: BookingRules
  /** How long this service needs, minutes. */
  kestus: number
  /** The days to consider, in order, each with its existing load. */
  paevad: DayLoad[]
  /** ISO weekday 1–7 for each date, supplied by the caller. */
  nadalapaev: (kuupaev: string) => number
  /** 'YYYY-MM-DD' today, local. Lead time and horizon are measured from it. */
  tana: string
  /** Days from `tana` for each date — the caller owns calendar arithmetic. */
  paevaVahe: (kuupaev: string) => number
}

/**
 * Every start time this service can actually take.
 *
 * A slot survives only if EVERY test passes: inside opening hours, long enough
 * to finish before closing, within the booking horizon, not on a closed date,
 * enough free capacity, and not over the day's big-job limit. Any of them
 * failing removes the slot silently — an explanation belongs on the screen, not
 * in this list.
 */
export function freeSlots(input: SlotsInput): Slot[] {
  const { rules, kestus, paevad, nadalapaev, paevaVahe } = input
  if (!(kestus > 0)) return []

  const step = rules.samm && rules.samm > 0 ? rules.samm : DEFAULT_STEP
  const capacity = rules.kohti && rules.kohti > 0 ? rules.kohti : 1
  const closed = new Set(rules.puhkused ?? [])
  const ette = rules.ette ?? 0
  const kuni = rules.kuni ?? 90
  const big = rules.koormus
  const isBig = !!big && big.suurMin > 0 && kestus >= big.suurMin

  const out: Slot[] = []

  for (const day of paevad) {
    if (closed.has(day.kuupaev)) continue

    const away = paevaVahe(day.kuupaev)
    if (away < ette || away > kuni) continue

    // The load rule, checked once per day rather than per slot: a day already
    // holding its quota of big jobs offers none, however empty it looks.
    if (isBig && big && day.suuri >= big.suuriPaevas) continue

    for (const w of openWindows(rules, nadalapaev(day.kuupaev))) {
      // Start on the step grid, so the list reads as times rather than as
      // whatever the previous appointment happened to end at.
      const first = Math.ceil(w.algus / step) * step
      for (let t = first; t + kestus <= w.lopp; t += step) {
        const candidate = { algus: t, lopp: t + kestus }
        const busy = day.hoivatud.filter(b => overlaps(candidate, b)).length
        if (busy >= capacity) continue
        out.push({ kuupaev: day.kuupaev, kell: toClock(t), kestus })
      }
    }
  }

  return out
}

/** Slots grouped by day, for a picker that shows days first. */
export function slotsByDay(slots: Slot[]): { kuupaev: string; kellad: string[] }[] {
  const byDay = new Map<string, string[]>()
  for (const s of slots) {
    byDay.set(s.kuupaev, [...(byDay.get(s.kuupaev) ?? []), s.kell])
  }
  return [...byDay.entries()]
    .map(([kuupaev, kellad]) => ({ kuupaev, kellad: kellad.slice().sort() }))
    .sort((a, b) => a.kuupaev.localeCompare(b.kuupaev))
}

/**
 * Is this exact slot still free? The check the BOOKING makes, as opposed to the
 * list the picker shows.
 *
 * Separate because the list is a snapshot and the booking is a decision. Two
 * people can hold the same list; only one may hold the slot.
 */
export function slotStillFree(
  input: SlotsInput, kuupaev: string, kell: string,
): boolean {
  return freeSlots(input).some(s => s.kuupaev === kuupaev && s.kell === kell)
}

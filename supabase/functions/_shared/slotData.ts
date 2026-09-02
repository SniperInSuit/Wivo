/**
 * The ONE place a real timestamp becomes local wall clock.
 *
 * `@shared/portal/slots` deliberately knows nothing about time zones: it works
 * in 'YYYY-MM-DD' and minutes-from-midnight. Everything that has to reconcile
 * that with `timestamptz` is here, in one file, so the daylight-saving question
 * is answered once instead of at every call site.
 *
 * Estonia is UTC+2 in winter and UTC+3 in summer. The conversion uses
 * `Intl.DateTimeFormat` with a named zone rather than a fixed offset, because a
 * fixed offset is correct for half the year and quietly an hour wrong for the
 * other half — discovered by a patient who arrives at the wrong time.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { DayLoad } from '@shared/portal/slots.ts'

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/** The clinic's wall clock. One name, not an offset. */
export const ZONE = Deno.env.get('CLINIC_TIMEZONE') ?? 'Europe/Tallinn'

const partsOf = (d: Date): Record<string, string> =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
  )

/** 'YYYY-MM-DD' in the clinic's zone. */
export function localDate(d: Date): string {
  const p = partsOf(d)
  return `${p.year}-${p.month}-${p.day}`
}

/** Minutes from local midnight, in the clinic's zone. */
export function localMinutes(d: Date): number {
  const p = partsOf(d)
  // '24' happens at local midnight in some locales' hourCycle. Fold it to 0.
  return (Number(p.hour) % 24) * 60 + Number(p.minute)
}

/**
 * A local wall-clock date and time back into a real instant.
 *
 * Done by search rather than by arithmetic: guess UTC, see what wall clock that
 * lands on, correct by the difference, then check. Two passes settle every case
 * including the hour that repeats in autumn, and no offset is hard-coded.
 */
export function toInstant(kuupaev: string, kell: string): Date {
  const [y, m, d] = kuupaev.split('-').map(Number)
  const [hh, mm] = kell.split(':').map(Number)
  const wanted = Date.UTC(y, m - 1, d, hh, mm)
  let guess = new Date(wanted)
  for (let i = 0; i < 3; i++) {
    const p = partsOf(guess)
    const got = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute))
    const drift = wanted - got
    if (drift === 0) break
    guess = new Date(guess.getTime() + drift)
  }
  return guess
}

/** ISO weekday 1–7 for a 'YYYY-MM-DD'. Monday is 1. */
export function isoWeekday(kuupaev: string): number {
  const [y, m, d] = kuupaev.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 ? 7 : wd
}

/** Whole days between two 'YYYY-MM-DD'. */
export function dayDiff(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** The next `count` dates from `start`, inclusive. */
export function dateRange(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i))
    out.push(t.toISOString().slice(0, 10))
  }
  return out
}

/**
 * What is already booked, per day, in local wall clock.
 *
 * Reads only `algus` and `kestus_min` — a slot picker has no business knowing
 * who the visit is for, and not selecting the patient's name is a stronger
 * guarantee than not rendering it.
 */
export async function loadOf(
  clinicId: string, dates: string[], suurMin: number,
): Promise<DayLoad[]> {
  if (dates.length === 0) return []
  const from = toInstant(dates[0], '00:00')
  const to = toInstant(dates[dates.length - 1], '23:59')

  const { data, error } = await admin()
    .from('visits')
    .select('algus, kestus_min')
    // `clinic_id` was added in sql/015 as NULL and backfilled afterwards, so a
    // visit written before that has none. Such a row would be INVISIBLE here
    // and its hour offered to the website — a real patient double-booked.
    //
    // Counting it as busy can at worst withhold an hour that another clinic
    // owns. Withholding a free hour costs a booking; offering a taken one costs
    // somebody's appointment, so the direction to be wrong in is obvious.
    .or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
    .gte('algus', from.toISOString())
    .lte('algus', to.toISOString())
    .neq('staatus', 'tuhistatud')
  if (error) throw error

  const byDate = new Map<string, DayLoad>(
    dates.map(k => [k, { kuupaev: k, hoivatud: [], suuri: 0 }]),
  )
  for (const v of (data ?? []) as { algus: string; kestus_min: number }[]) {
    const start = new Date(v.algus)
    const key = localDate(start)
    const day = byDate.get(key)
    if (!day) continue
    const algus = localMinutes(start)
    const kestus = Number(v.kestus_min) || 0
    day.hoivatud.push({ algus, lopp: algus + kestus })
    if (suurMin > 0 && kestus >= suurMin) day.suuri++
  }
  return dates.map(k => byDate.get(k)!)
}

/** Requests already holding a slot but not yet turned into a visit. */
/**
 * How long an UNPAID hold survives. Somebody who opens the bank page and closes
 * it must not block that time for ever.
 *
 * Long enough to pay without hurrying, short enough that a popular slot comes
 * back the same afternoon. Only unpaid holds expire — a request with no fee
 * asked, or one already paid, holds its time until a person deals with it,
 * because that is a real request for that hour.
 */
export const HOLD_MINUTES = 30

export async function pendingHolds(
  clinicId: string, dates: string[],
): Promise<{ kuupaev: string; algus: number; kestus: number }[]> {
  if (dates.length === 0) return []
  const { data, error } = await admin()
    .from('visit_requests')
    .select('soovitud_algus, soovitud_kestus, makse_staatus, created_at')
    .eq('clinic_id', clinicId)
    .eq('staatus', 'uus')
    .not('soovitud_algus', 'is', null)
  if (error) return []

  const wanted = new Set(dates)
  const cutoff = Date.now() - HOLD_MINUTES * 60_000
  const out: { kuupaev: string; algus: number; kestus: number }[] = []

  for (const r of (data ?? []) as {
    soovitud_algus: string; soovitud_kestus: number
    makse_staatus: string; created_at: string
  }[]) {
    // A payment that failed or was abandoned is not a commitment: release the
    // time immediately rather than making the next visitor wait out the window.
    if (r.makse_staatus === 'ebaonnestus' || r.makse_staatus === 'tuhistatud') continue
    // Started paying and never finished — hold it, but only for a while.
    if (r.makse_staatus === 'ootel' && Date.parse(r.created_at) < cutoff) continue

    const d = new Date(r.soovitud_algus)
    const key = localDate(d)
    if (!wanted.has(key)) continue
    out.push({ kuupaev: key, algus: localMinutes(d), kestus: Number(r.soovitud_kestus) || 0 })
  }
  return out
}

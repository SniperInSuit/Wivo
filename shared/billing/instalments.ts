/**
 * Splitting one amount into a monthly payment schedule. THE implementation.
 *
 * A patient pays 5000 € over five months. Three questions have to be answered
 * the same way everywhere they are asked — the form that previews the plan, the
 * loop that writes the invoices, and (later) the scheduled function that sends
 * them — or the preview promises one thing and the documents say another:
 *
 *   1. how the money divides, to the cent
 *   2. what date each instalment is issued on
 *   3. what date each one falls due
 *
 * NO DEPENDENCIES, INCLUDING date-fns. `shared/README.md`: "No dependencies. At
 * all." This file has to run in an Electron renderer today and in a Deno edge
 * function once sending is automated, and date-fns is an npm specifier that
 * would be externalised out of the bundle. The date arithmetic below is
 * therefore hand-rolled and works in UTC — `sql/044` is this project's proof
 * that letting a local timezone near a stored date costs a migration.
 */

/** What a plan needs to know to lay itself out. */
export interface PaymentPlanShape {
  /** The whole sum being split. */
  total: number
  /** How many monthly parts. */
  count: number
  /** 'YYYY-MM-DD' — when instalment 1 is issued. */
  firstIssue: string
  /**
   * Day of month every later instalment lands on, 1–28.
   *
   * Capped at 28 and not 31 on purpose: February. A plan issued "on the 31st"
   * would silently become the 28th three months in and the 31st again the month
   * after, which is a schedule nobody agreed to. Omit it to keep whatever day
   * `firstIssue` falls on, clamped the same way.
   */
  dayOfMonth?: number
  /** Days from issue to due. The "x päeva aega maksta" number. */
  termDays: number
}

/** One instalment, as it will be written down. */
export interface Instalment {
  /** 1-based, for "Osamakse 3/5". */
  no: number
  issueDate: string
  dueDate: string
  amount: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const pad = (n: number): string => String(n).padStart(2, '0')

interface Ymd { y: number; m: number; d: number }

/** 'YYYY-MM-DD' → parts, or null. Deliberately strict: a half-typed date is not
 *  a date, and guessing one would put an invoice in the wrong month. */
function parseYmd(iso: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // Round-trip through UTC so 2026-02-30 is rejected rather than rolled into March.
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null
  }
  return { y, m: mo, d }
}

const fmtYmd = ({ y, m, d }: Ymd): string => `${y}-${pad(m)}-${pad(d)}`

const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m, 0)).getUTCDate()

/** k months on, with the day CLAMPED into the target month rather than rolled
 *  over. Adding one month to 31 January is 28 February, never 3 March. */
function addMonths({ y, m, d }: Ymd, k: number): Ymd {
  const total = (y * 12) + (m - 1) + k
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) }
}

function addDays(p: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d))
  t.setUTCDate(t.getUTCDate() + n)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/**
 * `total` divided into `count` parts that add back up to `total` exactly.
 *
 * Every part is floored to the cent and the LAST one absorbs the remainder, so
 * 1000 / 3 is 333.33 + 333.33 + 333.34. The alternative — rounding each part —
 * lets the parts sum to more than the whole, which on an invoice run means
 * charging a patient a cent they never agreed to and never being able to show
 * where it came from.
 */
export function splitAmount(total: number, count: number): number[] {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count < 1) return []
  if (count === 1) return [round2(total)]
  const per = Math.floor((total / count) * 100) / 100
  const parts = Array.from({ length: count - 1 }, () => per)
  parts.push(round2(total - per * (count - 1)))
  return parts
}

/**
 * What is wrong with this plan, in the patient's language. Empty = it can be
 * written down.
 *
 * Same honesty rule as `publishProblems()` in shared/portal and `unpriced` in
 * shared/pricing: a schedule that does not add up is NOT generated with a
 * plausible-looking wrong number. It refuses and says why.
 */
export function scheduleProblems(plan: PaymentPlanShape): string[] {
  const out: string[] = []
  if (!Number.isFinite(plan.total) || plan.total <= 0) {
    out.push('Kogusumma puudub või ei ole positiivne.')
  }
  if (!Number.isInteger(plan.count) || plan.count < 1) {
    out.push('Osamaksete arv peab olema vähemalt 1.')
  } else if (plan.count > 60) {
    out.push('Osamakseid saab olla kuni 60.')
  }
  if (!parseYmd(plan.firstIssue)) {
    out.push('Esimese arve kuupäev on puudu või vigane.')
  }
  if (plan.dayOfMonth !== undefined
    && (!Number.isInteger(plan.dayOfMonth) || plan.dayOfMonth < 1 || plan.dayOfMonth > 28)) {
    // 28 rather than 31 — see PaymentPlanShape.dayOfMonth.
    out.push('Arve päev peab olema 1–28, et see kehtiks ka veebruaris.')
  }
  if (!Number.isInteger(plan.termDays) || plan.termDays < 0) {
    out.push('Maksetähtaeg peab olema päevades, 0 või rohkem.')
  }
  // A part that rounds to nothing means the plan is finer than money is.
  if (out.length === 0 && plan.total / plan.count < 0.01) {
    out.push('Osamakse jääks alla sendi — vähenda osamaksete arvu.')
  }
  return out
}

/**
 * The plan, laid out. Empty when `scheduleProblems()` is not empty — a caller
 * that skips the check still cannot generate a broken run.
 */
export function instalmentSchedule(plan: PaymentPlanShape): Instalment[] {
  if (scheduleProblems(plan).length > 0) return []
  const first = parseYmd(plan.firstIssue)
  if (!first) return []

  const amounts = splitAmount(plan.total, plan.count)
  return amounts.map((amount, i) => {
    const shifted = addMonths(first, i)
    // The chosen day applies from the FIRST instalment too: a plan set to the
    // 2nd should not start on the 17th just because that is when it was typed.
    const issue = plan.dayOfMonth === undefined
      ? shifted
      : { ...shifted, d: Math.min(plan.dayOfMonth, daysInMonth(shifted.y, shifted.m)) }
    return {
      no: i + 1,
      issueDate: fmtYmd(issue),
      dueDate: fmtYmd(addDays(issue, plan.termDays)),
      amount,
    }
  })
}

/** What the whole plan comes to. Reads the parts, never `total` — so a rounding
 *  mistake shows up as a mismatch instead of hiding behind the input. */
export const scheduleTotal = (rows: Instalment[]): number =>
  round2(rows.reduce((s, r) => s + r.amount, 0))

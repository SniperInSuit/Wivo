/**
 * The numbers nobody plans around and everybody wants to know.
 *
 * These are deliberately ALL-TIME rather than period-bound, because that is the
 * question being asked: "how many teeth have we made" is a career total, not a
 * September total. Each one prints its own scope so it cannot be mistaken for a
 * period figure sitting among period figures — the exact confusion that made
 * Ülevaade's all-time counts read as a third opinion about this month.
 *
 * Cheap to compute (a few passes over jobs already in memory) and cheap to be
 * wrong about: nothing here is a money decision. That is why they can be fun.
 */
import type { Job } from '../types/job'
import { jobWorkItems, revisionReasons } from '../types/job'

/** Teeth in one adult mouth, for the only unit conversion anybody enjoys. */
const TEETH_PER_MOUTH = 32

const toothList = (h: string | null | undefined): string[] =>
  h ? h.split(',').map(s => s.trim()).filter(Boolean) : []

const parse = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)

export interface Superlative {
  label: string
  value: number
  /** Free text: a patient, a material, a date. */
  detail?: string
}

export interface FunFacts {
  /** Every tooth ever recorded, originals and remakes. */
  teethAllTime: number
  /** …expressed in whole mouths, because 3 812 teeth means nothing. */
  mouthsAllTime: number
  jobsAllTime: number
  /** Days since the earliest job on record. */
  daysInBusiness: number | null
  firstJobDate: string | null
  /** Most teeth finished in a single day, and when. */
  busiestDay: Superlative | null
  /** The single biggest job by tooth count. */
  biggestJob: Superlative | null
  /** Longest run of consecutive finished jobs with no revision on any of them. */
  cleanStreak: number
  /** The shade that comes back most often. */
  favouriteShade: Superlative | null
  /** How many distinct materials have ever been used. */
  materialsUsed: number
  /** Distinct FDI positions ever worked on, out of 32. */
  toothMapCoverage: number
  /** Jobs finished on a Saturday or Sunday. */
  weekendJobs: number
  /** Share of all jobs that were rush jobs. */
  rushPct: number
  /** The reason that causes the most remakes, all time. */
  topRevisionReason: Superlative | null
  /** Most jobs for one patient. */
  loyalPatient: Superlative | null
  /** Average teeth per job — the shape of the caseload in one number. */
  teethPerJob: number | null
}

export function funFacts(jobs: Job[], doneStageKey: string): FunFacts {
  let teeth = 0
  let weekend = 0
  let rush = 0
  const shades = new Map<string, number>()
  const materials = new Set<string>()
  const positions = new Set<string>()
  const perDay = new Map<string, number>()
  const perPatient = new Map<string, number>()
  const reasons = new Map<string, number>()
  let firstDate: string | null = null
  let biggest: Superlative | null = null

  for (const j of jobs) {
    const own = toothList(j.hambad)
    let jobTeeth = own.length
    own.forEach(t => positions.add(t))

    for (const rev of j.revisions ?? []) {
      const rt = toothList(rev.hambad)
      jobTeeth += rt.length
      rt.forEach(t => positions.add(t))
      for (const reason of revisionReasons(rev)) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      }
    }
    teeth += jobTeeth

    if (!biggest || jobTeeth > biggest.value) {
      biggest = { label: j.patsient || j.too || 'Töö', value: jobTeeth, detail: j.too ?? undefined }
    }

    if (j.kiirtoo) rush++
    if (j.varv?.trim()) shades.set(j.varv.trim(), (shades.get(j.varv.trim()) ?? 0) + 1)
    // The material string carries a shade suffix; the whole string is the
    // material as far as the lab is concerned, which is how it is priced.
    if (j.materjal?.trim()) materials.add(j.materjal.trim())
    for (const item of jobWorkItems(j)) {
      if (item.too?.trim()) materials.add(item.too.trim())
    }

    const patient = (j.patsient ?? '').trim().toLowerCase()
    if (patient) perPatient.set(patient, (perPatient.get(patient) ?? 0) + 1)

    if (j.kuupaev && (!firstDate || j.kuupaev < firstDate)) firstDate = j.kuupaev

    if (j.valmis_kuupaev) {
      perDay.set(j.valmis_kuupaev, (perDay.get(j.valmis_kuupaev) ?? 0) + own.length)
      const day = new Date(parse(j.valmis_kuupaev)).getDay()
      if (day === 0 || day === 6) weekend++
    }
  }

  // ── Longest clean streak ──────────────────────────────────────────────────
  // Finished jobs in completion order; a revision on any of them breaks it.
  const finished = jobs
    .filter(j => j.status === doneStageKey && j.valmis_kuupaev)
    .sort((a, b) => (a.valmis_kuupaev ?? '').localeCompare(b.valmis_kuupaev ?? ''))
  let streak = 0
  let bestStreak = 0
  for (const j of finished) {
    const hasRevision = (j.revisions?.length ?? 0) > 0 || !!j.muudatused
    if (hasRevision) streak = 0
    else { streak++; bestStreak = Math.max(bestStreak, streak) }
  }

  const top = (m: Map<string, number>): Superlative | null => {
    let best: Superlative | null = null
    for (const [label, value] of m) {
      if (!best || value > best.value) best = { label, value }
    }
    return best
  }

  const busiest = top(perDay)
  const firstTs = parse(firstDate)

  return {
    teethAllTime: teeth,
    mouthsAllTime: Math.round((teeth / TEETH_PER_MOUTH) * 10) / 10,
    jobsAllTime: jobs.length,
    daysInBusiness: Number.isNaN(firstTs)
      ? null
      : Math.max(0, Math.round((Date.now() - firstTs) / 86_400_000)),
    firstJobDate: firstDate,
    busiestDay: busiest ? { label: busiest.label, value: busiest.value } : null,
    biggestJob: biggest && biggest.value > 0 ? biggest : null,
    cleanStreak: bestStreak,
    favouriteShade: top(shades),
    materialsUsed: materials.size,
    toothMapCoverage: positions.size,
    weekendJobs: weekend,
    rushPct: jobs.length > 0 ? Math.round((rush / jobs.length) * 1000) / 10 : 0,
    topRevisionReason: top(reasons),
    loyalPatient: top(perPatient),
    teethPerJob: jobs.length > 0 ? Math.round((teeth / jobs.length) * 10) / 10 : null,
  }
}

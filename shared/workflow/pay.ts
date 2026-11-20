/**
 * §10 (docs/WORKFLOW-STAGES.md): who is paid for which kind of pay on a job,
 * by the people on the job's stages: pure, so lib/earnings.ts and its tests
 * agree with it line for line.
 *
 * THE RULE
 *   A job stage carries a pay kind (`job_stage.pay_role`, copied from its
 *   template when the stage is made, sql/124). The people on that stage are
 *   paid for that kind, and split it equally among themselves.
 *
 *   Wherever the stage rule has nobody to pay, today's rule applies, unchanged:
 *   no stage with that pay kind, the stage skipped, or nobody on it. An old job
 *   has no pay kinds and no people on its stages at all, so every line of it
 *   takes today's rule and pays to the cent what it paid before.
 *
 *   Each kind on its own:
 *     too       the job's piece work and its extras: the 'too' stage, else
 *               the technician (jobs.assigned_to).
 *     disain    the design and its extras: the 'disain' stage, else the
 *               designers by work item (designed_by), as today.
 *     mudel     the model: the 'mudel' stage, else whoever is paid for 'too'
 *               (today the model goes with the technician).
 *     muudatus  a revision: its own technician when it names one (sql/087),
 *               else the 'muudatus' stage, else whoever is paid for 'too'.
 *     a revision's design: its own designer when it names one, else whoever
 *               is paid for 'disain'.
 *
 * HOW A SPLIT IS PRICED
 *   Everyone is priced by their OWN pay rules, as if they had done the whole
 *   of it, and then takes their part: `splitEqually`, whole cents, the cents
 *   left over one each to the first people in id order. With equal rules the
 *   parts add up to the whole exactly. Shares other than equal are later work.
 *
 * Nothing here reads a patient.
 */
import { isPayRole, splitEqually, type PayRole } from './workflow'

/** One stage of a job, as pay reads it. Only stages with a pay kind matter. */
export interface PayStage {
  stageKey: string
  position: number
  payRole: PayRole | null
  skipped: boolean
  people: readonly string[]
}

/**
 * Who is paid for one kind of pay on one job.
 *
 * 'legacy': today's rule decides (assigned_to, designed_by, the revision's own
 * people), by the code that decided it before stages existed.
 * 'stage': these people, sorted and never empty, split it equally.
 */
export type Payees =
  | { by: 'legacy' }
  | { by: 'stage'; people: readonly string[] }

const LEGACY: Payees = Object.freeze({ by: 'legacy' as const })

/**
 * The stage rule for one pay kind: the people on the job's stage that carries
 * it, or null when the rule has nobody (no such stage, skipped, empty).
 *
 * A job has at most one stage per pay kind (sql/124 copies it only once per
 * job). Should two ever carry it, the first by position decides, so the answer
 * is the same every time it is computed.
 */
export function stagePeople(stages: readonly PayStage[] | null | undefined, role: PayRole): string[] | null {
  if (!stages || stages.length === 0) return null
  let found: PayStage | null = null
  for (const s of stages) {
    if (s.payRole !== role) continue
    if (!found || s.position < found.position) found = s
  }
  if (!found || found.skipped) return null
  const people = [...new Set(found.people.filter(p => typeof p === 'string' && p.length > 0))].sort()
  return people.length > 0 ? people : null
}

const byStage = (people: string[] | null): Payees => (people ? { by: 'stage', people } : LEGACY)

/** Who is paid for the job's own lines: piece work, design, model. */
export interface JobPayees {
  too: Payees
  disain: Payees
  mudel: Payees
}

export function jobPayees(stages: readonly PayStage[] | null | undefined): JobPayees {
  const too = byStage(stagePeople(stages, 'too'))
  const mudelPeople = stagePeople(stages, 'mudel')
  return {
    too,
    disain: byStage(stagePeople(stages, 'disain')),
    // No model stage: the model goes with the piece work, as it does today.
    mudel: mudelPeople ? { by: 'stage', people: mudelPeople } : too,
  }
}

/** Who is paid for one revision: its production (and model, extras), and its design. */
export interface RevisionPayees {
  tech: Payees
  design: Payees
}

/**
 * A revision's people.
 *
 * Its own technician (sql/087) or designer, when it names one, is today's
 * rule: that person, the whole amount. Only a revision that names nobody
 * falls to the stages.
 */
export function revisionPayees(
  stages: readonly PayStage[] | null | undefined,
  revision: { assigned_to?: string | null; designed_by?: string | null },
): RevisionPayees {
  const job = jobPayees(stages)
  let tech: Payees = LEGACY
  if (!revision.assigned_to) {
    const muudatus = stagePeople(stages, 'muudatus')
    tech = muudatus ? { by: 'stage', people: muudatus } : job.too
  }
  const design: Payees = revision.designed_by ? LEGACY : job.disain
  return { tech, design }
}

/** Is this person among the payees? Only for 'stage'; 'legacy' is the caller's own test. */
export const paysPerson = (p: Payees, profileId: string): boolean =>
  p.by === 'stage' && p.people.includes(profileId)

/** This person's part of an amount in euros, split equally among the payees. */
export interface PayPart {
  /** Euros, two decimals; the parts of everyone add up to the amount. */
  amount: number
  /** 1 / head count: what qty is scaled by, so qty × rate still describes the part. */
  fraction: number
  heads: number
}

/**
 * This person's part of `amount` (euros) among `people`, or null when they are
 * not among them. One person: the amount itself, untouched.
 */
export function partOf(amount: number, people: readonly string[], profileId: string): PayPart | null {
  const ids = [...new Set(people)]
  if (!ids.includes(profileId)) return null
  if (ids.length === 1) return { amount, fraction: 1, heads: 1 }
  const cents = Math.round(amount * 100)
  const mine = splitEqually(cents, ids).find(s => s.profileId === profileId)
  return { amount: (mine?.cents ?? 0) / 100, fraction: 1 / ids.length, heads: ids.length }
}

// ─── From the database ───────────────────────────────────────────────────────

/** A `job_stage` row as the jobs query embeds it (lib/jobPayStages.ts). */
export interface PayStageRow {
  stage_key?: unknown
  position?: unknown
  pay_role?: unknown
  skipped_at?: unknown
  job_stage_person?: unknown
}

/**
 * The embedded rows, as pay stages. Anything malformed is left out rather than
 * guessed at: a stage this cannot read pays by today's rule, which is what the
 * job paid before it had stages.
 */
export function payStagesFromRows(rows: unknown): PayStage[] {
  if (!Array.isArray(rows)) return []
  const out: PayStage[] = []
  for (const r of rows as PayStageRow[]) {
    if (!r || typeof r !== 'object') continue
    if (typeof r.stage_key !== 'string' || !isPayRole(r.pay_role)) continue
    const people = Array.isArray(r.job_stage_person)
      ? (r.job_stage_person as { profile_id?: unknown }[])
          .map(p => p?.profile_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    out.push({
      stageKey: r.stage_key,
      position: typeof r.position === 'number' ? r.position : Number.MAX_SAFE_INTEGER,
      payRole: r.pay_role,
      skipped: r.skipped_at !== null && r.skipped_at !== undefined,
      people,
    })
  }
  return out.sort((a, b) => a.position - b.position)
}

/**
 * What is DUE on a day — jobs and remakes alike.
 *
 * Two screens asked this question and both asked it of `job.valmis_aeg` alone:
 * the Ülevaade rail and its "Täna tähtsad tööd" panel. A revision carries its
 * own `deadline` and its own stage, so a remake due at one o'clock today was on
 * the board, in the payroll, in the costs — and absent from the one screen
 * whose whole job is to say what today looks like. The rail read "2 tööd
 * tähtajaga" on a day with four.
 *
 * One function, because those two screens disagreeing about today is worse than
 * either of them being wrong: the panel said "Täna tähtajaga töid ei ole" while
 * the rail beside it drew two.
 */
import { parseISO, isValid, isSameDay, isBefore } from 'date-fns'
import type { Job, Revision } from '../types/job'
import { jobWorkItems } from '../types/job'

export interface Deadline {
  /** Stable across renders; unique per job-or-revision. */
  key: string
  job: Job
  /** Null when this is the job's own deadline. */
  rev: Revision | null
  /** 1-based, matching the "Muudatus 2" chips on the job page. Null on a job. */
  nr: number | null
  /** ISO datetime it is due. */
  at: string
  /** The stage THIS is in — a revision has its own, and it is not the job's. */
  status: string
  /** "Kroon" / "Muudatus 2: Kroon" — what to put on the row. */
  label: string
  /** Work type, for the colour. A revision inherits the job's. */
  too: string
}

const labelOf = (job: Job): string => {
  const names = [...new Set(jobWorkItems(job).map(i => i.too).filter(Boolean))]
  return names.join(' + ') || job.too || 'Määramata töö'
}

/**
 * Every deadline the list carries, jobs and revisions together, unsorted.
 *
 * A revision with no deadline of its own is NOT given the job's: the remake was
 * agreed without one, and inventing a date would put work on a day nobody
 * promised it for.
 */
export function jobDeadlines(jobs: Job[]): Deadline[] {
  const out: Deadline[] = []
  for (const job of jobs) {
    if (job.valmis_aeg) {
      out.push({
        key: `job|${job.id}`,
        job, rev: null, nr: null,
        at: job.valmis_aeg,
        status: job.status,
        label: labelOf(job),
        too: job.too ?? '',
      })
    }
    for (const [i, rev] of (job.revisions ?? []).entries()) {
      if (!rev.deadline) continue
      out.push({
        key: `rev|${job.id}|${rev.id}`,
        job, rev, nr: i + 1,
        at: rev.deadline,
        // Its own stage, defaulting the way the rest of the app defaults it.
        status: rev.status ?? 'disain',
        label: `Muudatus ${i + 1}: ${labelOf(job)}`,
        too: job.too ?? '',
      })
    }
  }
  return out
}

/** Those due on `day`, whatever stage they are in. For the rail. */
export function deadlinesOn(jobs: Job[], day: Date): Deadline[] {
  return jobDeadlines(jobs).filter(d => {
    const at = parseISO(d.at)
    return isValid(at) && isSameDay(at, day)
  })
}

/**
 * Still open and due today / already late.
 *
 * `doneStageKey` is asked of the DEADLINE's own status, not the job's: a job
 * can be finished while a remake of it is still on the bench, and that remake
 * is exactly the thing a "what is due" panel exists to show.
 */
export function openDeadlines(
  jobs: Job[], now: Date, doneStageKey: string
): { dueToday: Deadline[]; overdue: Deadline[] } {
  const dueToday: Deadline[] = []
  const overdue: Deadline[] = []
  for (const d of jobDeadlines(jobs)) {
    if (d.status === doneStageKey) continue
    const at = parseISO(d.at)
    if (!isValid(at)) continue
    if (isSameDay(at, now)) dueToday.push(d)
    else if (isBefore(at, now)) overdue.push(d)
  }
  return { dueToday, overdue }
}

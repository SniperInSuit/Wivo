/**
 * The top bar's search: what a query matches, and which job Enter opens.
 *
 * The job code (TAL-26-0042) is what is written on the box and said on the
 * phone, and the search could not find it: it looked at the patient, the work
 * type, the teeth and the IDs, never the code. So a job was found by paging
 * through the calendar.
 */
import type { Job } from '../types/job'

/** Case, spaces and dashes do not matter: "tal 26 0042" is TAL-26-0042. */
const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[\s-]+/g, '')

export function jobMatchesSearch(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const code = norm(query)
  return (
    (!!code && norm(job.job_code).includes(code)) ||
    (job.customer_ref ?? '').toLowerCase().includes(q) ||
    job.patsient.toLowerCase().includes(q) ||
    (job.too ?? '').toLowerCase().includes(q) ||
    (job.hambad ?? '').toLowerCase().includes(q) ||
    (job.materjal ?? '').toLowerCase().includes(q) ||
    (job.print_id ?? '').toLowerCase().includes(q) ||
    (job.mudel_id ?? '').toLowerCase().includes(q) ||
    (job.kirjeldus ?? '').toLowerCase().includes(q)
  )
}

export type SearchPick =
  | { kind: 'job'; job: Job }
  | { kind: 'none' }
  | { kind: 'many'; count: number }

/**
 * What Enter opens. The code decides first, because a short number like "42"
 * is also a tooth: the whole code, then the only code containing the query,
 * then the only job matching at all. Nothing anywhere is an error the person
 * should see; several matches stay on screen as the filtered list.
 */
export function pickJobForSearch(jobs: readonly Job[], query: string): SearchPick | null {
  const code = norm(query)
  if (!code) return null
  const exact = jobs.find(j => norm(j.job_code) === code)
  if (exact) return { kind: 'job', job: exact }
  const byCode = jobs.filter(j => norm(j.job_code).includes(code))
  if (byCode.length === 1) return { kind: 'job', job: byCode[0] }
  const any = byCode.length > 0 ? byCode : jobs.filter(j => jobMatchesSearch(j, query))
  if (any.length === 0) return { kind: 'none' }
  if (any.length === 1) return { kind: 'job', job: any[0] }
  return { kind: 'many', count: any.length }
}

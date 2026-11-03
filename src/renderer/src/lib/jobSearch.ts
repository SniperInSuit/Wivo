/**
 * The search: what a query matches, how it is asked of the database, and which
 * job Enter opens.
 *
 * The job code (TAL-26-0042) is what is written on the box and said on the
 * phone, and the search could not find it: it looked at the patient, the work
 * type, the teeth and the IDs, never the code — and only among the jobs already
 * loaded. So a job was found by paging through the calendar.
 *
 * Now the code and the patient are asked of the DATABASE (useJobSearch), so
 * the date range on screen does not matter. RLS decides what comes back, the
 * same as for the board: the caller's own organisation, not deleted, and only
 * the jobs this person may read. A partner's jobs are never in `jobs` for them;
 * they search the partner view, which has no patient.
 */
import type { Job } from '../types/job'

/** At most this many results; enough to pick from, small enough to stay fast. */
export const SEARCH_LIMIT = 20

/** Case, spaces and dashes do not matter: "tal 26 0042" is TAL-26-0042. */
export const normCode = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[\s-]+/g, '')

/**
 * The full codes a query could be, however the dashes were typed.
 *
 * A code is PREFIX-YY-N: the prefix is letters, perhaps with a digit after
 * them (TAL2 when TAL was taken, sql/070), YY two digits, N at least four. With
 * the dashes gone the split between a prefix digit and the year is ambiguous
 * ("TAL2260042"), so every split is returned; an exact `in` asks for all.
 */
export function jobCodeCandidates(query: string): string[] {
  const s = query.toUpperCase().replace(/[\s-]+/g, '')
  const m = /^([A-Z]+)(\d{6,})$/.exec(s)
  if (!m) return []
  const [, letters, digits] = m
  const out: string[] = []
  for (let k = 0; k + 6 <= digits.length; k++) {
    const yy = digits.slice(k, k + 2)
    const n = digits.slice(k + 2)
    // Past four digits the number is not padded (sql/085): no leading zero.
    if (n.length > 4 && n.startsWith('0')) continue
    out.push(`${letters}${digits.slice(0, k)}-${yy}-${n}`)
  }
  return out
}

/** A LIKE pattern for "contains", with the user's own % and _ taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`
}

/**
 * What a partial code is matched as. "26 0042" and "260042" both mean the
 * "26-0042" part of a code, so the dash is put back where the code has it.
 */
export function partialCodePattern(query: string): string {
  const s = query.trim()
  const m = /^(\d{2})[\s-]*(\d{4,})$/.exec(s)
  return containsPattern(m ? `${m[1]}-${m[2]}` : s)
}

export function jobMatchesSearch(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const code = normCode(query)
  return (
    (!!code && normCode(job.job_code).includes(code)) ||
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

/**
 * One list from the database's answers: the exact code first, then other
 * codes containing the query, then patient names; each job once, newest first
 * within a group, at most SEARCH_LIMIT.
 */
export function rankSearchResults(found: readonly Job[], query: string): Job[] {
  const code = normCode(query)
  const q = query.trim().toLowerCase()
  const group = (j: Job): number =>
    code && normCode(j.job_code) === code ? 0
      : code && normCode(j.job_code).includes(code) ? 1
        : j.patsient.toLowerCase().includes(q) ? 2
          : 3
  const seen = new Set<string>()
  return found
    .filter(j => !seen.has(j.id) && !!seen.add(j.id))
    .filter(j => group(j) < 3)
    .sort((a, b) => group(a) - group(b) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, SEARCH_LIMIT)
}

export type SearchPick =
  | { kind: 'job'; job: Job }
  | { kind: 'none' }
  | { kind: 'many'; count: number }

/**
 * What Enter opens, from the ranked results: the exact code at once, else the
 * only result. Nothing is an error the person should see; several stay on
 * screen to pick from.
 */
export function pickJobForSearch(results: readonly Job[], query: string): SearchPick | null {
  const code = normCode(query)
  if (!code) return null
  const exact = results.find(j => normCode(j.job_code) === code)
  if (exact) return { kind: 'job', job: exact }
  if (results.length === 0) return { kind: 'none' }
  if (results.length === 1) return { kind: 'job', job: results[0] }
  return { kind: 'many', count: results.length }
}

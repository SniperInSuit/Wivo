/**
 * How many UNITS of each work type were made — teeth, not jobs.
 *
 * ── Why this could not reuse `stats.byWorkType` ─────────────────────────────
 * Every existing type breakdown buckets by `job.too` and counts `job.hambad`.
 * Both are the JOB-level denormalised fields, and a job can hold several work
 * items of different types:
 *
 *     work_items: [{ too: 'Kroon', hambad: '11,12' },
 *                  { too: 'Sild',  hambad: '14,15,16' }]
 *     too:    'Kroon'
 *     hambad: '11,12,14,15,16'
 *
 * Read at the job level that is five crowns and no bridge. The teeth of one
 * type are attributed to another, and the error is invisible — the totals still
 * add up, they are just filed under the wrong name. This is the same shape as
 * the pay bug the work-item split was introduced to fix, where a bridge was
 * paid at the crown rate because the first item decided the whole case.
 *
 * So: walk the ITEMS. `jobWorkItems` already falls back to the denormalised
 * pair for legacy rows that have no `work_items`, so nothing is lost.
 *
 * ── Why remakes are counted separately ──────────────────────────────────────
 * A remade crown is a crown that was made — the bench did the work twice. It is
 * also not a second crown sold. Neither number is wrong, so both are returned
 * and the caller says which one it is showing.
 */
import { jobWorkItems, type Job, type Revision } from '../types/job'
import { toothCount } from '@shared/pricing/teeth'

export interface TypeUnits {
  name: string
  /** Teeth of this type on the original work. */
  teeth: number
  /** Teeth of this type that were remade under a revision. */
  redone: number
  /** Work items of this type — a four-unit bridge is one item, four teeth. */
  items: number
  /** Jobs containing at least one item of this type. */
  jobs: number
}

export interface UnitsByType {
  /** Newest question first: most units made. */
  rows: TypeUnits[]
  /**
   * Remade teeth that could not be matched to a work item, usually because the
   * revision names no teeth at all.
   *
   * Reported rather than spread across the types or quietly dropped. Splitting
   * them by guess would put units under a name nobody made, and dropping them
   * silently would make the remake column read lower than it is — the same
   * "coverage" habit the rest of the dashboard uses.
   */
  unplacedRedone: number
}

const teethOf = (hambad: string | null | undefined): string[] =>
  (hambad ?? '').split(',').map(t => t.trim()).filter(Boolean)

/**
 * @param label  Classifies a raw `too` string into a work type NAME — pass
 *               `useWorkTypes().label`, so the chart groups exactly the way
 *               the calendar and the price list already do.
 */
export function unitsByType(
  jobs: Job[],
  label: (too: string | null | undefined) => string,
): UnitsByType {
  const acc = new Map<string, TypeUnits>()
  let unplacedRedone = 0

  const bucket = (name: string): TypeUnits => {
    const got = acc.get(name) ?? { name, teeth: 0, redone: 0, items: 0, jobs: 0 }
    acc.set(name, got)
    return got
  }

  for (const job of jobs) {
    const items = jobWorkItems(job)
    if (items.length === 0) continue

    // Which type owns each tooth, so a revision's teeth land on the item that
    // actually made them rather than on whichever type the job is filed under.
    const owner = new Map<string, string>()
    const typesHere = new Set<string>()

    for (const item of items) {
      const name = label(item.too)
      const b = bucket(name)
      b.teeth += toothCount(item.hambad)
      b.items += 1
      typesHere.add(name)
      for (const tooth of teethOf(item.hambad)) {
        // First item wins a tooth claimed twice. That is a data error either
        // way; what matters is that the tooth is counted once.
        if (!owner.has(tooth)) owner.set(tooth, name)
      }
    }

    for (const name of typesHere) bucket(name).jobs += 1

    for (const rev of (job.revisions ?? []) as Revision[]) {
      const revTeeth = teethOf(rev.hambad)
      if (revTeeth.length === 0) {
        // A revision with no tooth list. On a single-type job there is only one
        // answer and guessing it is not a guess; on a mixed one there is no way
        // to know, so it is reported instead.
        if (typesHere.size === 1) bucket([...typesHere][0]).redone += toothCount(job.hambad)
        else unplacedRedone += toothCount(job.hambad)
        continue
      }
      for (const tooth of revTeeth) {
        const name = owner.get(tooth)
        if (name) bucket(name).redone += 1
        else unplacedRedone += 1
      }
    }
  }

  const rows = [...acc.values()]
    .filter(r => r.teeth > 0 || r.redone > 0)
    .sort((a, b) => b.teeth - a.teeth || a.name.localeCompare(b.name))

  return { rows, unplacedRedone }
}

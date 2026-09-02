/**
 * The bug this exists for: `` `${ctx.stats.withRevision} tööd` `` shipped, and
 * the panel read "[object Object],[object Object],[object Object] tööd 47-st".
 *
 * TypeScript does not catch it. A template literal accepts ANY type — an array
 * of jobs stringifies without complaint — so the compiler was green, the build
 * was green, and the only place it showed up was a screenshot.
 *
 * A source scan rather than a render test, for the same reason the catalogue
 * test is data-only: this repo has no jsdom, and recharts panels cannot be
 * mounted in plain vitest. The file is read as text and the shape is checked.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'render.tsx'), 'utf8')

/**
 * Fields on `useDashboardStats` that hold ARRAYS. Interpolating one prints
 * `[object Object]` per element — never what was meant, always a count.
 */
const ARRAY_FIELDS = [
  'filtered', 'completed', 'inProduction', 'overdue', 'withRevision',
  'kiirtooJobs', 'topPatients', 'machineStats', 'workByType',
]

describe('paneelide renderdajad', () => {
  it('never interpolates an array of jobs into a string', () => {
    const offenders: string[] = []
    for (const field of ARRAY_FIELDS) {
      // `${ctx.stats.foo}` with nothing after it — no `.length`, no `[0]`, no
      // `.map(`. Those are all fine; the bare array is the bug.
      const bare = new RegExp(`\\$\\{ctx\\.stats\\.${field}\\}`, 'g')
      for (const m of SRC.matchAll(bare)) offenders.push(m[0])
    }
    expect(offenders, 'use .length — a bare array prints [object Object]').toEqual([])
  })
})

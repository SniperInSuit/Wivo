/**
 * "Report a bug" (sql/079). A platform table: users file, nobody in a clinic
 * reads — not even their own report. A screenshot exists only if attached.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

const submit = (shot: boolean) => rowsAs<{ id: string; screenshot_path: string | null }>(db, { id: A.workerId },
  `select * from public.submit_bug_report('The board froze', 'board', '1.110.0', '[{"message":"TypeError"}]'::jsonb, $1)`, [shot])

describe('bug reports', () => {
  it('a user files one with version, organisation, screen and errors', async () => {
    const [r] = await submit(false)
    const { rows } = await db.query(`select org_id, app_version, screen, recent_errors, screenshot_path from public.bug_report where id = $1`, [r.id])
    expect(rows[0]).toEqual({ org_id: A.clinicId, app_version: '1.110.0', screen: 'board',
      recent_errors: [{ message: 'TypeError' }], screenshot_path: null })
  })

  it('nobody in a clinic can read reports, not even their own', async () => {
    await submit(false)
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.bug_report`)).toEqual([])
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.bug_report`)).toEqual([])
    expect(await errorAs(db, { id: A.ownerId }, `select * from public.pending_bug_reports()`)).toMatch(/permission denied/)
  })

  it('no screenshot unless asked for; with one, only that one slot accepts an upload', async () => {
    const [plain] = await submit(false)
    expect(await errorAs(db, { id: A.workerId },
      `insert into storage.objects (bucket_id, name) values ('bug-reports', $1)`, [`${plain.id}/screenshot`])).not.toBeNull()
    const [r] = await submit(true)
    expect(r.screenshot_path).toBe(`${r.id}/screenshot`)
    expect(await errorAs(db, { id: A.ownerId },
      `insert into storage.objects (bucket_id, name) values ('bug-reports', $1)`, [r.screenshot_path])).not.toBeNull()
    expect(await errorAs(db, { id: A.workerId },
      `insert into storage.objects (bucket_id, name) values ('bug-reports', $1)`, [r.screenshot_path])).toBeNull()
    await rowsAs(db, { id: A.workerId }, `select public.confirm_bug_screenshot($1)`, [r.id])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from storage.objects where bucket_id = 'bug-reports'`)).toEqual([])
  })

  it('an empty description is refused; a flood is cut off', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `select * from public.submit_bug_report('   ', 'x', '1', '[]'::jsonb)`)).not.toBeNull()
    for (let i = 0; i < 20; i++) await rowsAs(db, { id: A.ownerId }, `select * from public.submit_bug_report('n', 'x', '1', '[]'::jsonb)`)
    expect(await errorAs(db, { id: A.ownerId }, `select * from public.submit_bug_report('n', 'x', '1', '[]'::jsonb)`)).toMatch(/Too many/)
  })

  it('the e-mail sender (service role) sees them', async () => {
    const { rows } = await db.query(`select * from public.pending_bug_reports()`)
    expect(rows.length).toBeGreaterThan(0)
  })
})

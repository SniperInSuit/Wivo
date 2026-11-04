/**
 * sql/105: searching the audit log — by person, action, job code and dates, a
 * page at a time — for owners and admins only, of their own organisation, with
 * nothing audit_entries does not already show.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let jobA: { id: string; code: string }
let jobA2: { id: string; code: string }

interface Row { id: number; at: string; user_name: string | null; action: string; object: string; job_code: string | null; detail: unknown }

/** One audit row, as audit() would write it, at a given time. */
const log = (org: string, user: string | null, action: string, object: string, at: string) =>
  db.query(`insert into public.audit_log (org_id, user_id, action, object, at) values ($1, $2, $3, $4, $5)`, [org, user, action, object, at])

const search = (args: Record<string, unknown> = {}, who = A.ownerId) => rowsAs<Row>(db, { id: who },
  `select * from public.audit_search(p_user => $1, p_action => $2, p_job_code => $3, p_from => $4, p_to => $5,
     p_before_at => $6, p_before_id => $7, p_limit => $8)`,
  [args.user ?? null, args.action ?? null, args.job ?? null, args.from ?? null, args.to ?? null,
   args.beforeAt ?? null, args.beforeId ?? null, args.limit ?? 50])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  const code = async (id: unknown) => (await db.query<{ c: string }>(`select job_code as c from public.jobs where id = $1`, [id])).rows[0].c
  const j1 = await makeRow(db, 'jobs', A)
  const j2 = await makeRow(db, 'jobs', A)
  jobA = { id: j1.id as string, code: await code(j1.id) }
  jobA2 = { id: j2.id as string, code: await code(j2.id) }
  await db.query(`delete from public.audit_log`)
  // Ten months of A's log, and some of B's.
  for (let m = 1; m <= 10; m++) {
    const month = String(m).padStart(2, '0')
    await log(A.clinicId, A.workerId, 'view', `job:${jobA.id}`, `2026-${month}-05T10:00:00Z`)
    await log(A.clinicId, A.ownerId, 'download', `job:${jobA2.id}`, `2026-${month}-06T10:00:00Z`)
    await log(A.clinicId, A.ownerId, 'stage_move', `job:${jobA.id}`, `2026-${month}-07T10:00:00Z`)
  }
  await log(A.clinicId, null, 'partnership', 'partnership:x', '2026-03-01T00:00:00Z')
  await log(B.clinicId, B.ownerId, 'view', `job:${jobA.id}`, '2026-05-05T10:00:00Z')
}, 120_000)

describe('who may search', () => {
  it('an owner and an admin; not a worker, and not without the second factor', async () => {
    expect((await search()).length).toBeGreaterThan(0)
    const admin = (await db.query<{ id: string }>(`insert into auth.users (email) values ('admin@a.test') returning id`)).rows[0].id
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'admin' where id = $2`, [A.clinicId, admin])
    expect((await search({}, admin)).length).toBeGreaterThan(0)
    expect(await errorAs(db, { id: A.workerId }, `select * from public.audit_search()`)).toMatch(/admin/)
    expect(await errorAs(db, { id: A.ownerId, mfa: false }, `select * from public.audit_search()`)).toMatch(/second factor/)
    expect(await errorAs(db, { id: A.workerId }, `select * from public.audit_people()`)).toMatch(/admin/)
  })

  it('only one\'s own organisation: B\'s row about A\'s job is not in A\'s search, nor A\'s in B\'s', async () => {
    const mine = await search({ action: 'view', from: '2026-05-01', to: '2026-06-01' })
    expect(mine).toHaveLength(1)
    expect(mine[0].user_name).not.toBe('Riga owner')
    const theirs = await search({}, B.ownerId)
    expect(theirs).toHaveLength(1)
    expect(theirs[0].job_code).toBe(jobA.code)
  })
})

describe('the filters', () => {
  it('by person', async () => {
    const rows = await search({ user: A.workerId, limit: 100 })
    expect(rows).toHaveLength(10)
    expect(new Set(rows.map(r => r.action))).toEqual(new Set(['view']))
  })

  it('by action', async () => {
    expect(await search({ action: 'stage_move', limit: 100 })).toHaveLength(10)
    expect(await search({ action: 'partnership' })).toHaveLength(1)
  })

  it('by job code: exact, part of it, any case, spaces or dashes', async () => {
    const exact = await search({ job: jobA.code, limit: 100 })
    expect(exact).toHaveLength(20)
    expect(new Set(exact.map(r => r.job_code))).toEqual(new Set([jobA.code]))
    expect(await search({ job: jobA.code.toLowerCase().replace(/-/g, ' '), limit: 100 })).toHaveLength(20)
    const prefix = jobA.code.split('-')[0]
    expect((await search({ job: prefix, limit: 100 })).length).toBe(30)
    expect(await search({ job: 'NOPE-99-9999' })).toEqual([])
  })

  it('by dates: from inclusive, to exclusive', async () => {
    const march = await search({ from: '2026-03-01T00:00:00Z', to: '2026-04-01T00:00:00Z', limit: 100 })
    expect(march).toHaveLength(4)
    expect(march.every(r => r.at >= '2026-03-01' || new Date(r.at) >= new Date('2026-03-01T00:00:00Z'))).toBe(true)
  })

  it('combined', async () => {
    const rows = await search({ user: A.ownerId, action: 'download', from: '2026-01-01', to: '2026-04-01' })
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.job_code === jobA2.code)).toBe(true)
  })
})

describe('paging', () => {
  it('pages of 7 cover every row once, newest first, months back included', async () => {
    const all = await search({ limit: 1000 })
    expect(all).toHaveLength(31)
    const seen: number[] = []
    let before: Row | undefined
    for (;;) {
      const page = await search({ limit: 7, beforeAt: before?.at ?? null, beforeId: before?.id ?? null })
      if (page.length === 0) break
      seen.push(...page.map(r => r.id))
      before = page[page.length - 1]
    }
    expect(seen).toEqual(all.map(r => r.id))
    expect(new Set(seen).size).toBe(31)
  })

  it('rows written meanwhile do not shift the next page', async () => {
    const first = await search({ limit: 5 })
    // Rolled back after: the log is append-only, even here (sql/114).
    await db.exec('begin')
    try {
      await log(A.clinicId, A.ownerId, 'view', 'job:new', '2026-12-31T00:00:00Z')
      const next = await search({ limit: 5, beforeAt: first[4].at, beforeId: first[4].id })
      expect(next.map(r => r.id)).not.toContain(first[4].id)
      const all = await search({ limit: 1000 })
      expect(next.map(r => r.id)).toEqual(all.slice(6, 11).map(r => r.id))
    } finally {
      await db.exec('rollback')
    }
  })
})

describe('nothing new shown', () => {
  it('the same rows and columns as audit_entries', async () => {
    const entries = await rowsAs<Row>(db, { id: A.ownerId }, `select * from public.audit_entries(1000)`)
    const found = await search({ limit: 1000 })
    expect(found).toEqual(entries)
  })

  it('the people list holds only who appears in the log, by the name the log shows', async () => {
    const people = await rowsAs<{ user_id: string; name: string }>(db, { id: A.ownerId }, `select * from public.audit_people()`)
    expect(people.map(p => p.user_id).sort()).toEqual([A.ownerId, A.workerId].sort())
    expect(people.map(p => p.name)).not.toContain('Riga owner')
  })

  it('both are reads (stable), so an old build may still search', async () => {
    const { rows } = await db.query<{ proname: string; provolatile: string }>(
      `select proname, provolatile from pg_proc where proname in ('audit_search', 'audit_people')`)
    expect(rows.every(r => r.provolatile === 's')).toBe(true)
  })
})

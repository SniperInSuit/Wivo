/**
 * What the menu's Jobs and Table rest on (shared/permissions menuAllows): every
 * member sees their own jobs without any permission — technician or designer
 * on the job, or designer of one of its work items (job_is_mine, sql/064) —
 * and edits them with Edit jobs; View jobs widens it to every job. Found on
 * the test copy: the desktop hid Jobs from a technician with the defaults,
 * while the phone (which shows what the database returns) opened his job.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, grant, type Tenant } from './harness'
import { TECHNICIAN_PRESET } from '../../shared/permissions'

let db: PGlite
let A: Tenant
let tech: string
const jobs: Record<'assigned' | 'designer' | 'itemDesigner' | 'other', string> = { assigned: '', designer: '', itemDesigner: '', other: '' }

async function member(perms: readonly string[]): Promise<string> {
  const id = await createUser(db, 'Kevin Test')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'technician' where id = $2`, [A.clinicId, id])
  await grant(db, A, id, [...perms])
  return id
}

async function job(fields: string, params: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status${fields ? ', ' + fields.split('=')[0] : ''})
     values ($1, 'X', 'disain'${fields ? ', $2' : ''}) returning id`, [A.clinicId, ...params])
  return rows[0].id
}

const seen = async (who: string) =>
  (await rowsAs<{ id: string }>(db, { id: who }, `select id from public.jobs order by created_at`)).map(r => r.id).sort()
const edits = async (who: string, id: string) =>
  (await rowsAs(db, { id: who }, `update public.jobs set varv = 'A3' where id = $1 returning id`, [id])).length === 1

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  tech = await member(TECHNICIAN_PRESET)
  jobs.assigned = await job('assigned_to', [tech])
  jobs.designer = await job('designed_by', [tech])
  jobs.itemDesigner = await job('work_items', [JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', designed_by: tech }])])
  jobs.other = await job('')
}, 120_000)

describe('a technician with the defaults (Edit jobs, not View jobs)', () => {
  it('sees exactly their own jobs: technician, designer, a work item\'s designer', async () => {
    expect(await seen(tech)).toEqual([jobs.assigned, jobs.designer, jobs.itemDesigner].sort())
  })

  it('edits their own jobs, not another\'s', async () => {
    expect(await edits(tech, jobs.assigned)).toBe(true)
    expect(await edits(tech, jobs.itemDesigner)).toBe(true)
    expect(await edits(tech, jobs.other)).toBe(false)
  })
})

describe('View jobs widens it to every job; Edit jobs is what edits', () => {
  it('with View jobs: every job of the clinic', async () => {
    const reader = await member([...TECHNICIAN_PRESET, 'jobs.read'])
    expect(await seen(reader)).toEqual(Object.values(jobs).sort())
    expect(await edits(reader, jobs.other)).toBe(true)
  })

  it('without Edit jobs: their own jobs, read only', async () => {
    const looker = await member([])
    await db.query(`update public.jobs set assigned_to = $1 where id = $2`, [looker, jobs.other])
    expect(await seen(looker)).toEqual([jobs.other])
    expect(await edits(looker, jobs.other)).toBe(false)
  })
})

/**
 * sql/116: a booking request (name, phone, e-mail, message) is read, added,
 * changed and deleted only by the people who handle them — Manage visits,
 * the owner, an admin — as the app's Requests menu says. The public booking
 * page still makes them, through the service key.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant } from './harness'
import { TECHNICIAN_PRESET } from '../../shared/permissions'

let db: PGlite
let A: Tenant
let B: Tenant
let request: string

async function member(t: Tenant, perms: readonly string[], orgRole = 'technician'): Promise<string> {
  const id = await createUser(db)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = $2 where id = $3`, [t.clinicId, orgRole, id])
  await grant(db, t, id, [...perms])
  return id
}

const reads = async (who: string) => (await rowsAs(db, { id: who }, `select id from public.visit_requests where id = $1`, [request])).length === 1
const changes = async (who: string) =>
  (await rowsAs(db, { id: who }, `update public.visit_requests set sonum = 'x' where id = $1 returning id`, [request])).length === 1

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  // As the public booking page makes it: the Edge Function, with the service key.
  await db.exec('set role service_role')
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.visit_requests (clinic_id, idempotency_key, nimi, telefon, email, sonum)
       values ($1, 'k1', 'Mari Maasikas', '+372 5555 1234', 'mari@example.ee', 'Hammas valutab') returning id`, [A.clinicId])
    request = rows[0].id
  } finally {
    await db.exec('reset role')
  }
}, 120_000)

describe('who handles booking requests sees them', () => {
  it('Manage visits, the owner and an admin: read and change', async () => {
    for (const who of [await member(A, ['visits.write']), A.ownerId, await member(A, [], 'admin')]) {
      expect(await reads(who)).toBe(true)
      expect(await changes(who)).toBe(true)
    }
  })

  it('a technician with the defaults, or with View visits only: nothing, and cannot change, add or delete', async () => {
    for (const who of [await member(A, TECHNICIAN_PRESET), await member(A, ['visits.read'])]) {
      expect(await reads(who)).toBe(false)
      expect(await changes(who)).toBe(false)
      expect(await rowsAs(db, { id: who }, `delete from public.visit_requests where id = $1 returning id`, [request])).toEqual([])
      expect(await errorAs(db, { id: who },
        `insert into public.visit_requests (clinic_id, idempotency_key, nimi, telefon) values ($1, 'k2', 'X', '+372 5000 0001')`, [A.clinicId]))
        .toMatch(/row-level security/)
    }
    expect(await reads(A.ownerId)).toBe(true)
  })

  it('a handler adds one by hand (a phone call)', async () => {
    const h = await member(A, ['visits.write'])
    expect(await errorAs(db, { id: h },
      `insert into public.visit_requests (clinic_id, idempotency_key, nimi, telefon) values ($1, 'k3', 'Jaan', '+372 5000 0002')`, [A.clinicId])).toBeNull()
  })

  it('another clinic\'s handler and the public key: nothing', async () => {
    expect(await reads(B.ownerId)).toBe(false)
    expect(await reads(await member(B, ['visits.write']))).toBe(false)
    expect(await errorAs(db, 'anon', `select id from public.visit_requests`)).toMatch(/permission denied/)
  })
})

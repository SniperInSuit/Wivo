/**
 * sql/118: every member reads what a job shows of its client (id, name,
 * archived); the whole client — contact person, e-mail, phone, address,
 * registry code, notes, special prices, payment terms — needs View jobs (the
 * Clients page) or View payments (invoices), owners and admins always.
 * Changing clients needs Edit jobs and View jobs (admins always).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant } from './harness'
import { TECHNICIAN_PRESET } from '../../shared/permissions'

let db: PGlite
let A: Tenant
let B: Tenant
let client: string

async function member(t: Tenant, perms: readonly string[], orgRole = 'technician'): Promise<string> {
  const id = await createUser(db)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = $2 where id = $3`, [t.clinicId, orgRole, id])
  await grant(db, t, id, [...perms])
  return id
}

const full = async (who: string) =>
  (await rowsAs<{ id: string; email: string | null }>(db, { id: who }, `select id, email from public.customers_full()`))
const DETAILS = ['contact_name', 'email', 'cc_emails', 'phone', 'address', 'reg_code', 'vat_number', 'note', 'price_overrides', 'payment_terms_days', 'billing_mode']

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  const { rows } = await db.query<{ id: string }>(
    `insert into public.customers (clinic_id, name, contact_name, email, phone, note)
     values ($1, 'Hambakliinik OÜ', 'Mari Maasikas', 'mari@kliinik.ee', '+372 5555 1234', 'maksab hilja') returning id`, [A.clinicId])
  client = rows[0].id
}, 120_000)

describe('what a job needs: every member', () => {
  it('a technician with the defaults reads id, name and archived', async () => {
    const tech = await member(A, TECHNICIAN_PRESET)
    expect(await rowsAs(db, { id: tech }, `select id, name, archived_at from public.customers where id = $1`, [client]))
      .toEqual([{ id: client, name: 'Hambakliinik OÜ', archived_at: null }])
  })

  it('but none of the details, from anyone, and no select *', async () => {
    for (const who of [await member(A, TECHNICIAN_PRESET), A.ownerId]) {
      for (const col of DETAILS) {
        expect(await errorAs(db, { id: who }, `select ${col} from public.customers`), col).toMatch(/permission denied/)
      }
      expect(await errorAs(db, { id: who }, `select * from public.customers`)).toMatch(/permission denied/)
    }
  })

  it('customers_full(): nothing for them', async () => {
    expect(await full(await member(A, TECHNICIAN_PRESET))).toEqual([])
  })
})

describe('the whole client: View jobs, View payments, owners and admins', () => {
  it('each of them', async () => {
    for (const who of [await member(A, ['jobs.read']), await member(A, ['payments.read']), A.ownerId, await member(A, [], 'admin')]) {
      expect(await full(who)).toEqual([{ id: client, email: 'mari@kliinik.ee' }])
    }
  })

  it('never another clinic\'s', async () => {
    expect(await full(B.ownerId)).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select id from public.customers where id = $1`, [client])).toEqual([])
  })

  it('the public key: nothing', async () => {
    expect(await errorAs(db, 'anon', `select name from public.customers`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select * from public.customers_full()`)).toMatch(/permission denied/)
  })
})

describe('changing clients: Edit jobs and View jobs, admins always', () => {
  const add = (who: string) => errorAs(db, { id: who },
    `insert into public.customers (clinic_id, name) values ($1, 'Uus kliinik')`, [A.clinicId])
  const rename = async (who: string) =>
    (await rowsAs(db, { id: who }, `update public.customers set name = 'Hambakliinik AS' where id = $1 returning id`, [client])).length === 1

  it('Edit jobs alone (the technician defaults): cannot add or change', async () => {
    const tech = await member(A, TECHNICIAN_PRESET)
    expect(await add(tech)).toMatch(/row-level security/)
    expect(await rename(tech)).toBe(false)
  })

  it('Edit jobs and View jobs, the owner, an admin: can', async () => {
    for (const who of [await member(A, ['jobs.write', 'jobs.read']), A.ownerId, await member(A, [], 'admin')]) {
      expect(await add(who)).toBeNull()
      expect(await rename(who)).toBe(true)
    }
  })
})

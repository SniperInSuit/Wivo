/**
 * sql/117: a colleague's pay and tax settings (employment type, pay basis,
 * pension percentage, tax-free income, rush multiplier) only for payroll —
 * the owner and Manage payroll, as for rates, hours and payouts; an admin
 * needs Manage payroll too — former members included. Everyone reads their
 * own, and every member still sees a colleague's name, username and role.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant } from './harness'
import { TECHNICIAN_PRESET } from '../../shared/permissions'

let db: PGlite
let A: Tenant
let B: Tenant
let tech: string
let former: string

const PAY = ['toosuhe', 'tasu_arvestus', 'kogumispension_protsent', 'maksuvaba_tulu', 'kiirtoo_kordaja']

async function member(t: Tenant, perms: readonly string[], orgRole = 'technician', name?: string): Promise<string> {
  const id = await createUser(db, name)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = $2,
                    kogumispension_protsent = 4, maksuvaba_tulu = 700, tasu_arvestus = 'neto' where id = $3`, [t.clinicId, orgRole, id])
  await grant(db, t, id, [...perms])
  return id
}

const paySeen = async (who: string) =>
  (await rowsAs<{ profile_id: string }>(db, { id: who }, `select profile_id from public.pay_settings()`)).map(r => r.profile_id).sort()

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  tech = await member(A, TECHNICIAN_PRESET, 'technician', 'Tõnu Tehnik')
  former = await member(A, [], 'technician', 'Endine Töötaja')
  await db.query(`update public.profiles set clinic_id = null, removed_from = $1 where id = $2`, [A.clinicId, former])
}, 120_000)

describe('a member reads colleagues, not their pay', () => {
  it('a colleague\'s name, username and role: yes', async () => {
    const rows = await rowsAs<{ full_name: string; role: string }>(db, { id: tech },
      `select id, full_name, username, role, org_role from public.profiles where id = $1`, [A.ownerId])
    expect(rows).toEqual([expect.objectContaining({ full_name: 'Tallinn owner', role: 'owner' })])
  })

  it('a pay or tax field, anyone\'s, their own included, straight from the table: refused', async () => {
    for (const col of PAY) {
      expect(await errorAs(db, { id: tech }, `select ${col} from public.profiles where id = $1`, [A.ownerId]), col).toMatch(/permission denied/)
      expect(await errorAs(db, { id: tech }, `select ${col} from public.profiles where id = $1`, [tech]), col).toMatch(/permission denied/)
    }
  })

  it('select * is refused: the app names its columns', async () => {
    expect(await errorAs(db, { id: tech }, `select * from public.profiles`)).toMatch(/permission denied/)
  })

  it('their own pay settings, through pay_settings(); nobody else\'s', async () => {
    expect(await paySeen(tech)).toEqual([tech])
    const [mine] = await rowsAs<Record<string, unknown>>(db, { id: tech }, `select * from public.pay_settings()`)
    expect(mine).toMatchObject({ profile_id: tech, tasu_arvestus: 'neto', maksuvaba_tulu: '700.00' })
  })
})

describe('payroll reads everyone\'s, former members included', () => {
  const everyone = () => [A.ownerId, A.workerId, tech, former].sort()

  it('Manage payroll', async () => {
    expect(await paySeen(await member(A, ['payroll.manage']))).toEqual(expect.arrayContaining(everyone()))
  })

  it('the owner', async () => {
    expect(await paySeen(A.ownerId)).toEqual(expect.arrayContaining(everyone()))
  })

  it('an admin: only with Manage payroll, as for rates, hours and payouts', async () => {
    const admin = await member(A, [], 'admin')
    expect(await paySeen(admin)).toEqual([admin])
    expect(await paySeen(await member(A, ['payroll.manage'], 'admin'))).toEqual(expect.arrayContaining(everyone()))
    // The same rule as the rest of pay data (can_manage_payroll, sql/085).
    expect(await rowsAs(db, { id: admin }, `select 1 from public.worker_rates where profile_id <> $1`, [admin])).toEqual([])
  })

  it('never another clinic\'s', async () => {
    const seen = await paySeen(B.ownerId)
    expect(seen).not.toContain(tech)
    expect(seen).not.toContain(former)
  })
})

describe('writing is unchanged', () => {
  it('one\'s own language; the owner sets a member\'s pay basis', async () => {
    expect(await errorAs(db, { id: tech }, `update public.profiles set language = 'en' where id = $1`, [tech])).toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `update public.profiles set tasu_arvestus = 'bruto' where id = $1`, [tech])).toBeNull()
    const [p] = await rowsAs<{ tasu_arvestus: string }>(db, { id: A.ownerId }, `select tasu_arvestus from public.pay_settings() where profile_id = $1`, [tech])
    expect(p.tasu_arvestus).toBe('bruto')
  })

  it('the public key: nothing at all', async () => {
    expect(await errorAs(db, 'anon', `select full_name from public.profiles`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select * from public.pay_settings()`)).toMatch(/permission denied/)
  })
})

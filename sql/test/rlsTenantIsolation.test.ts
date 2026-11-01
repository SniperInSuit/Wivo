/**
 * Tenant isolation, checked against a real database (spec: "Testing → RLS leak
 * tests"): a user of organisation B must not be able to read or change a single
 * row of organisation A, through any table.
 *
 * The first block is generic on purpose. It walks EVERY table in `public` —
 * including tables added after this file was written — makes one row that
 * belongs to tenant A, and checks it from tenant B and from anon. A new table
 * whose policy forgets the tenant fails here without anyone writing a test for
 * it. The blocks after it cover the holes found in the Phase 0 audit
 * (docs/night-run/phase0-report.md §2), each closed by sql/068.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  freshDb, createTenant, createUser, makeRow, primaryKey, publicTables,
  rowsAs, errorAs, type Tenant,
} from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

async function clinicOf(profileId: string): Promise<string | null> {
  const { rows } = await db.query<{ clinic_id: string | null }>(
    `select clinic_id from public.profiles where id = $1`, [profileId])
  return rows[0].clinic_id
}

/** `where pk1 = $1 and pk2 = $2` for one row. */
function wherePk(pk: string[], row: Record<string, unknown>): [string, unknown[]] {
  return [pk.map((c, i) => `"${c}" = $${i + 1}`).join(' and '), pk.map(c => row[c])]
}

describe('every table: tenant B and anon cannot see or change a tenant A row', () => {
  it('holds for all tables in public', async () => {
    const failures: string[] = []
    for (const table of await publicTables(db)) {
      const row = await makeRow(db, table, A)
      const pk = await primaryKey(db, table)
      if (pk.length === 0) { failures.push(`${table}: no primary key`); continue }
      const [where, params] = wherePk(pk, row)

      for (const [who, actor] of [['tenant B owner', { id: B.ownerId }], ['tenant B worker', { id: B.workerId }], ['anon', 'anon']] as const) {
        const seen = await rowsAs(db, actor, `select 1 from public.${table} where ${where}`, params).catch(() => [])
        if (seen.length > 0) failures.push(`${table}: ${who} can READ it`)
        const updated = await rowsAs(db, actor, `update public.${table} set "${pk[0]}" = "${pk[0]}" where ${where} returning 1`, params).catch(() => [])
        if (updated.length > 0) failures.push(`${table}: ${who} can UPDATE it`)
        const deleted = await rowsAs(db, actor, `delete from public.${table} where ${where} returning 1`, params).catch(() => [])
        if (deleted.length > 0) failures.push(`${table}: ${who} can DELETE it`)
      }
    }
    expect(failures).toEqual([])
  }, 120_000)
})

describe('profiles: nobody moves themselves or others across tenants', () => {
  it('a worker cannot make themselves owner', async () => {
    const err = await errorAs(db, { id: A.workerId },
      `update public.profiles set role = 'owner' where id = $1`, [A.workerId])
    expect(err).not.toBeNull()
    const { rows } = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [A.workerId])
    expect(rows[0].role).toBe('worker')
  })

  it('a worker cannot move themselves into another clinic', async () => {
    const err = await errorAs(db, { id: A.workerId },
      `update public.profiles set clinic_id = $1 where id = $2`, [B.clinicId, A.workerId])
    expect(err).not.toBeNull()
  })

  it('an owner cannot pull a worker of another clinic into theirs', async () => {
    const { rows } = await rowsAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1 where id = $2 returning 1`, [A.clinicId, B.workerId]).then(r => ({ rows: r }))
    expect(rows).toEqual([])
  })

  it('an owner cannot pull in a stranger who has no clinic yet, unless they just signed up for it', async () => {
    const stranger = await createUser(db, 'Old stranger')
    await db.query(`update public.profiles set created_at = now() - interval '2 days' where id = $1`, [stranger])
    // Refused by the row filter (0 rows) or by the guard (error) — either way
    // the stranger must still belong to nobody.
    await errorAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, stranger])
    expect(await clinicOf(stranger)).toBeNull()
  })

  it('a clinic-less user is invisible to other tenants', async () => {
    const stranger = await createUser(db, 'Fresh signup')
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.profiles where id = $1`, [stranger])).toEqual([])
  })
})

describe('the flows the app needs still work', () => {
  it('founding a clinic: create it, link yourself, become its owner', async () => {
    const founder = await createUser(db, 'Founder')
    const [clinic] = await rowsAs<{ id: string }>(db, { id: founder },
      `insert into public.clinics (name) values ('New lab') returning id`)
    expect(clinic.id).toBeTruthy()
    expect(await errorAs(db, { id: founder },
      `update public.profiles set clinic_id = $1 where id = $2`, [clinic.id, founder])).toBeNull()
    const { rows } = await db.query<{ role: string; clinic_id: string }>(
      `select role, clinic_id from public.profiles where id = $1`, [founder])
    expect(rows[0]).toEqual({ role: 'owner', clinic_id: clinic.id })
  })

  it('an owner can link a worker they have just created', async () => {
    const fresh = await createUser(db, 'New technician')
    expect(await errorAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, fresh])).toBeNull()
  })

  it('an owner can remove a worker and put them back; the removed list is theirs only', async () => {
    const tech = await createUser(db, 'Removable')
    await db.query(`update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, tech])
    expect(await errorAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = null where id = $1`, [tech])).toBeNull()
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.profiles where id = $1`, [tech])).toHaveLength(1)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.profiles where id = $1`, [tech])).toEqual([])
    await errorAs(db, { id: B.ownerId },
      `update public.profiles set clinic_id = $1 where id = $2`, [B.clinicId, tech])
    expect(await clinicOf(tech)).toBeNull()
    expect(await errorAs(db, { id: A.ownerId },
      `update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, tech])).toBeNull()
  })

  it('anyone can still edit their own name and pay settings', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `update public.profiles set full_name = 'Renamed' where id = $1`, [A.workerId])).toBeNull()
  })
})

describe('clinics: a tenant sees only its own', () => {
  it('tenant B cannot read tenant A (name, IBAN, registry code)', async () => {
    expect(await rowsAs(db, { id: B.workerId }, `select 1 from public.clinics where id = $1`, [A.clinicId])).toEqual([])
  })
})

describe('rows with no clinic are nobody\'s, not everybody\'s', () => {
  it('an orphan job is invisible to every tenant', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.jobs (patsient, clinic_id) values ('Orphan', null) returning id`)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.jobs where id = $1`, [rows[0].id])).toEqual([])
  })

  it('a job cannot be pushed out of its clinic to become an orphan', async () => {
    const job = await makeRow(db, 'jobs', A)
    expect(await errorAs(db, { id: A.ownerId },
      `update public.jobs set clinic_id = null where id = $1`, [job.id])).not.toBeNull()
  })
})

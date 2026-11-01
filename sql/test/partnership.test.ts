/**
 * Organisations, partnerships, invites, job codes and the audit log
 * (sql/070). Spec, Phase 1: "Creating a partnership", steps 1–7.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, as, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant  // Tallinn, inviter
let B: Tenant  // Riga, invitee
let C: Tenant  // a third clinic, never a partner

const admin = (t: Tenant) => ({ id: t.ownerId, mfa: true })

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
}, 120_000)

async function invite(): Promise<string> {
  const [r] = await rowsAs<{ code: string }>(db, admin(A), `select public.create_partnership_invite() as code`)
  return r.code
}

describe('organisation and members', () => {
  it('every clinic gets a unique job-code prefix', async () => {
    const { rows } = await db.query<{ code_prefix: string }>(`select code_prefix from public.clinics`)
    expect(rows.every(r => /^[A-Z]{2,3}\d*$/.test(r.code_prefix))).toBe(true)
    expect(new Set(rows.map(r => r.code_prefix)).size).toBe(rows.length)
  })

  it('new jobs get a code: prefix, year, running number', async () => {
    const j1 = await makeRow(db, 'jobs', A)
    const j2 = await makeRow(db, 'jobs', A)
    expect(j1.job_code).toMatch(/^[A-Z]+\d*-\d{2}-\d{4}$/)
    expect(j1.job_code).not.toBe(j2.job_code)
  })

  it('the spec views show members of your own organisation only', async () => {
    const rows = await rowsAs<{ org_id: string; role: string }>(db, { id: A.workerId }, `select * from public.org_member`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.org_id === A.clinicId)).toBe(true)
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.organization where id = $1`, [B.clinicId])).toEqual([])
  })

  it('nobody raises their own org role; an owner sets someone else\'s', async () => {
    await errorAs(db, { id: A.workerId }, `update public.profiles set org_role = 'admin' where id = $1`, [A.workerId])
    const r1 = await db.query<{ org_role: string }>(`select org_role from public.profiles where id = $1`, [A.workerId])
    expect(r1.rows[0].org_role).toBe('technician')
    expect(await errorAs(db, { id: A.ownerId }, `update public.profiles set org_role = 'doctor' where id = $1`, [A.workerId])).toBeNull()
    const r2 = await db.query<{ org_role: string; role: string }>(`select org_role, role from public.profiles where id = $1`, [A.workerId])
    expect(r2.rows[0]).toEqual({ org_role: 'doctor', role: 'worker' })
    await db.query(`update public.profiles set org_role = 'technician' where id = $1`, [A.workerId])
  })
})

describe('creating an invite (step 1)', () => {
  it('a worker cannot', async () => {
    expect(await errorAs(db, { id: A.workerId, mfa: true }, `select public.create_partnership_invite()`)).toMatch(/admin/)
  })

  it('an admin without MFA cannot', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.create_partnership_invite()`)).toMatch(/two-factor/)
  })

  it('an admin with MFA gets a code; only its hash is stored', async () => {
    const code = await invite()
    expect(code).toMatch(/^WIVO-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const { rows } = await db.query<{ code_hash: string }>(`select code_hash from public.partnership_invite where org_id = $1`, [A.clinicId])
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows)).not.toContain(code)
  })

  it('the other side cannot list someone else\'s invites', async () => {
    expect(await rowsAs(db, admin(B), `select 1 from public.partnership_invite where org_id = $1`, [A.clinicId])).toEqual([])
  })
})

describe('the whole flow (steps 3–7)', () => {
  let partnershipId: string

  it('B sees who invites: name, country, registry code', async () => {
    const code = await invite()
    const rows = await rowsAs<{ org_name: string; country: string }>(db, admin(B),
      `select * from public.preview_partnership_invite($1)`, [code])
    expect(rows).toEqual([expect.objectContaining({ org_name: 'Tallinn', country: 'EE' })])
  })

  it('B cannot accept without a data processing agreement reference', async () => {
    const code = await invite()
    expect(await errorAs(db, admin(B),
      `select public.accept_partnership_invite($1, false, 'partial', array['design'], '')`, [code])).toMatch(/data processing/)
  })

  it('B accepts; nothing is active yet', async () => {
    const code = await invite()
    const [r] = await rowsAs<{ id: string }>(db, admin(B),
      `select public.accept_partnership_invite($1, true, 'partial', array['design'], 'DPA 2026-11') as id`, [code])
    partnershipId = r.id
    const { rows } = await db.query<{ status: string }>(`select status from public.partnership where id = $1`, [partnershipId])
    expect(rows[0].status).toBe('awaiting_inviter')
  })

  it('a used code cannot be used again', async () => {
    const code = await invite()
    await rowsAs(db, admin(C), `select public.accept_partnership_invite($1, false, 'partial', '{}', 'DPA')`, [code])
    expect(await errorAs(db, admin(B),
      `select public.accept_partnership_invite($1, false, 'partial', '{}', 'DPA')`, [code])).toMatch(/not valid/)
  })

  it('only the inviter confirms, and then Wivo still has to approve', async () => {
    expect(await errorAs(db, admin(B), `select public.confirm_partnership($1)`, [partnershipId])).not.toBeNull()
    expect(await errorAs(db, admin(A), `select public.confirm_partnership($1)`, [partnershipId])).toBeNull()
    const { rows } = await db.query<{ status: string }>(`select status from public.partnership where id = $1`, [partnershipId])
    expect(rows[0].status).toBe('awaiting_platform')
  })

  it('no clinic user can approve on Wivo\'s behalf', async () => {
    expect(await errorAs(db, admin(A), `select public.platform_approve_partnership($1)`, [partnershipId])).toMatch(/permission denied/)
  })

  it('Wivo approves (service role / SQL editor) and it is active', async () => {
    await db.query(`select public.platform_approve_partnership($1)`, [partnershipId])
    const { rows } = await db.query<{ status: string }>(`select status from public.partnership where id = $1`, [partnershipId])
    expect(rows[0].status).toBe('active')
  })

  it('both sides see it, with the other side\'s name; a third clinic does not', async () => {
    const a = await rowsAs<{ name: string; status: string }>(db, { id: A.workerId }, `select name, status from public.partner_orgs()`)
    expect(a).toContainEqual({ name: 'Riga', status: 'active' })
    const b = await rowsAs<{ name: string }>(db, { id: B.workerId }, `select name from public.partner_orgs()`)
    expect(b).toContainEqual({ name: 'Tallinn' })
    expect(await rowsAs(db, { id: C.ownerId }, `select 1 from public.partnership where id = $1`, [partnershipId])).toEqual([])
  })

  it('either side pauses, resumes and ends it; the end sets a read-only window', async () => {
    expect(await errorAs(db, admin(B), `select public.set_partnership_status($1, 'suspended')`, [partnershipId])).toBeNull()
    expect(await errorAs(db, admin(A), `select public.set_partnership_status($1, 'active')`, [partnershipId])).toBeNull()
    expect(await errorAs(db, admin(A), `select public.set_partnership_status($1, 'ended', 30)`, [partnershipId])).toBeNull()
    const { rows } = await db.query<{ status: string; days: number }>(
      `select status, round(extract(epoch from readonly_until - ended_at) / 86400)::int as days from public.partnership where id = $1`, [partnershipId])
    expect(rows[0]).toEqual({ status: 'ended', days: 30 })
  })

  it('every step is in both organisations\' audit logs, readable by their admins only', async () => {
    const a = await rowsAs<{ detail: { step: string } }>(db, { id: A.ownerId },
      `select detail from public.audit_log where object = $1 order by id`, ['partnership:' + partnershipId])
    expect(a.map(r => r.detail.step)).toEqual(['accepted_by_partner', 'confirmed', 'approved_by_wivo', 'suspended', 'active', 'ended'])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.audit_log`)).toEqual([])
  })
})

describe('the audit log is append-only', () => {
  it('not even an admin can change or delete a row', async () => {
    // No update/delete policy hides the rows from the statement; the trigger
    // is the second wall, for whoever reaches the table another way.
    await errorAs(db, { id: A.ownerId }, `update public.audit_log set action = 'view'`)
    await errorAs(db, { id: A.ownerId }, `delete from public.audit_log`)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where org_id = $1 and action = 'partnership'`, [A.clinicId])
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('a user cannot write to it directly', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.audit_log (org_id, action, object) values ($1, 'view', 'x')`, [A.clinicId])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `select public.audit($1, 'view', 'x')`, [A.clinicId])).toMatch(/permission denied/)
  })
})

describe('wrong codes are rate limited', () => {
  it('after 5 wrong codes in an hour the 6th attempt is refused outright', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await rowsAs(db, admin(C), `select * from public.preview_partnership_invite('WIVO-XXXX-XXX${i}')`)).toEqual([])
    }
    const code = await invite()
    expect(await errorAs(db, admin(C), `select * from public.preview_partnership_invite($1)`, [code])).toMatch(/Too many/)
  })

  it('an organisation cannot accept its own invite', async () => {
    const code = await invite()
    expect(await as(db, admin(A), async () => (await db.query(`select * from public.preview_partnership_invite($1)`, [code])).rows)).toEqual([])
  })
})

describe('job codes are the database\'s (sql/082)', () => {
  it('a duplicated job sent with the original\'s code gets its own', async () => {
    const original = await makeRow(db, 'jobs', A)
    const [copy] = await rowsAs<{ job_code: string }>(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, job_code) values ($1, 'Copy', $2) returning job_code`,
      [A.clinicId, original.job_code])
    expect(copy.job_code).toMatch(/-\d{2}-\d{4}$/)
    expect(copy.job_code).not.toBe(original.job_code)
  })

  it('an update cannot change a code', async () => {
    const job = await makeRow(db, 'jobs', A)
    await rowsAs(db, { id: A.ownerId }, `update public.jobs set job_code = 'HACKED-1' where id = $1 returning 1`, [job.id])
    const { rows } = await db.query<{ job_code: string }>(`select job_code from public.jobs where id = $1`, [job.id])
    expect(rows[0].job_code).toBe(job.job_code)
  })

  it('an update that sends the same code (the old app saving a job) is fine', async () => {
    const job = await makeRow(db, 'jobs', A)
    expect(await errorAs(db, { id: A.ownerId },
      `update public.jobs set job_code = $2, patsient = 'Renamed' where id = $1`, [job.id, job.job_code])).toBeNull()
  })
})

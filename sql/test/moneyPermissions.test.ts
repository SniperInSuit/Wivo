/**
 * sql/102: money needs payments.read / payments.write in the database itself;
 * customers need jobs.write to change; clinic settings split into what every
 * member reads and what only owners, admins (and for material costs, payroll
 * managers) read; deleting a job needs jobs.delete; a new technician's defaults.
 * Owners and admins keep full access throughout.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, makeRow, rowsAs, errorAs, grant, type Tenant, type Actor } from './harness'
import { TECHNICIAN_PRESET } from '../../shared/permissions'

let db: PGlite
let A: Tenant
let B: Tenant
let invoice: Record<string, unknown>
let line: Record<string, unknown>
let payment: Record<string, unknown>
let plan: Record<string, unknown>

/** A member of `t` with exactly these permissions (and optionally an org role). */
async function member(t: Tenant, perms: string[], orgRole: string = 'technician'): Promise<string> {
  const id = await createUser(db, `Member ${perms.join('+') || 'none'} ${orgRole}`)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = $2 where id = $3`, [t.clinicId, orgRole, id])
  if (perms.length) await grant(db, t, id, perms)
  return id
}
const who = (id: string): Actor => ({ id })

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  invoice = await makeRow(db, 'invoices', A)
  line = (await db.query<Record<string, unknown>>(
    `insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kroon', 1, 100) returning *`, [invoice.id])).rows[0]
  payment = (await db.query<Record<string, unknown>>(
    `insert into public.payments (clinic_id, invoice_id, amount) values ($1, $2, 50) returning *`, [A.clinicId, invoice.id])).rows[0]
  plan = await makeRow(db, 'payment_plans', A)
}, 120_000)

const MONEY = ['invoices', 'invoice_lines', 'payments', 'payment_plans'] as const
const idOf = (t: string) => ({ invoices: invoice, invoice_lines: line, payments: payment, payment_plans: plan } as Record<string, Record<string, unknown>>)[t].id

describe('money: a worker without payments.read gets nothing through the API', () => {
  it('no row of invoices, invoice_lines, payments or payment_plans, nor through an embedded select', async () => {
    const w = await member(A, ['jobs.read', 'jobs.write', 'stock.read', 'stats.read'])
    for (const t of MONEY) expect(await rowsAs(db, who(w), `select * from public.${t}`), t).toEqual([])
    expect(await rowsAs(db, who(w), `select i.*, (select count(*) from public.invoice_lines l where l.invoice_id = i.id) from public.invoices i`)).toEqual([])
    expect(await rowsAs(db, who(w), `select * from public.invoice_counters`)).toEqual([])
  })

  it('and cannot write them, number an invoice, or run the totals', async () => {
    const w = await member(A, [])
    expect(await errorAs(db, who(w), `insert into public.invoices (clinic_id, number, patsient) values ($1, 'X-1', 'X')`, [A.clinicId])).toMatch(/row-level security/)
    expect(await errorAs(db, who(w), `insert into public.payments (clinic_id, invoice_id, amount) values ($1, $2, 1)`, [A.clinicId, invoice.id])).toMatch(/row-level security/)
    expect(await errorAs(db, who(w), `insert into public.invoice_lines (invoice_id, description) values ($1, 'x')`, [invoice.id])).toMatch(/row-level security/)
    for (const t of MONEY) {
      expect(await rowsAs(db, who(w), `update public.${t} set id = id where id = $1 returning 1`, [idOf(t)]), t).toEqual([])
      expect(await rowsAs(db, who(w), `delete from public.${t} where id = $1 returning 1`, [idOf(t)]), t).toEqual([])
    }
    expect(await errorAs(db, who(w), `select public.next_invoice_number($1)`, [A.clinicId])).toMatch(/not allowed/)
    expect(await errorAs(db, who(w), `select public.recalc_invoice_totals($1)`, [invoice.id])).toMatch(/permission denied/)
  })
})

describe('money: payments.read reads, payments.write writes', () => {
  it('payments.read alone: reads everything, changes nothing', async () => {
    const r = await member(A, ['payments.read'])
    for (const t of MONEY) expect(await rowsAs(db, who(r), `select 1 from public.${t} where id = $1`, [idOf(t)]), t).toHaveLength(1)
    expect(await errorAs(db, who(r), `insert into public.invoices (clinic_id, number, patsient) values ($1, 'R-1', 'X')`, [A.clinicId])).toMatch(/row-level security/)
    for (const t of MONEY) expect(await rowsAs(db, who(r), `update public.${t} set id = id where id = $1 returning 1`, [idOf(t)]), t).toEqual([])
    expect(await errorAs(db, who(r), `select public.next_invoice_number($1)`, [A.clinicId])).toMatch(/not allowed/)
  })

  it('payments.read + payments.write: makes an invoice with a line and a payment; the trigger keeps the totals', async () => {
    const w = await member(A, ['payments.read', 'payments.write'])
    const [{ n }] = await rowsAs<{ n: string }>(db, who(w), `select public.next_invoice_number($1) as n`, [A.clinicId])
    const [inv] = await rowsAs<{ id: string }>(db, who(w),
      `insert into public.invoices (clinic_id, number, patsient, vat_rate) values ($1, $2, 'Patsient', 24) returning id`, [A.clinicId, n])
    await rowsAs(db, who(w), `insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kroon', 2, 100) returning 1`, [inv.id])
    await rowsAs(db, who(w), `insert into public.payments (clinic_id, invoice_id, amount) values ($1, $2, 10) returning 1`, [A.clinicId, inv.id])
    const [tot] = await rowsAs<{ gross_total: string }>(db, who(w), `select gross_total from public.invoices where id = $1`, [inv.id])
    expect(Number(tot.gross_total)).toBe(248)
    expect(await rowsAs(db, who(w), `delete from public.payments where invoice_id = $1 returning 1`, [inv.id])).toHaveLength(1)
  })

  it('owners and organisation admins keep full access without any grant', async () => {
    const admin = await member(A, [], 'admin')
    for (const id of [A.ownerId, admin]) {
      for (const t of MONEY) expect(await rowsAs(db, who(id), `select 1 from public.${t} where id = $1`, [idOf(t)]), t).toHaveLength(1)
      expect(await errorAs(db, who(id), `select public.next_invoice_number($1)`, [A.clinicId])).toBeNull()
    }
  })

  it('another clinic, even with every money permission, sees none of it', async () => {
    const other = await member(B, ['payments.read', 'payments.write'])
    for (const t of MONEY) expect(await rowsAs(db, who(other), `select 1 from public.${t} where id = $1`, [idOf(t)]), t).toEqual([])
    expect(await errorAs(db, who(other), `select public.next_invoice_number($1)`, [A.clinicId])).toMatch(/not allowed/)
  })
})

describe('customers: everyone reads, jobs.write changes', () => {
  it('without jobs.write: reads, but cannot add, change or remove', async () => {
    const c = await makeRow(db, 'customers', A)
    const w = await member(A, ['jobs.read'])
    expect(await rowsAs(db, who(w), `select 1 from public.customers where id = $1`, [c.id])).toHaveLength(1)
    expect(await errorAs(db, who(w), `insert into public.customers (clinic_id, name) values ($1, 'Uus')`, [A.clinicId])).toMatch(/row-level security/)
    expect(await rowsAs(db, who(w), `update public.customers set name = 'X' where id = $1 returning 1`, [c.id])).toEqual([])
    expect(await rowsAs(db, who(w), `delete from public.customers where id = $1 returning 1`, [c.id])).toEqual([])
  })

  // sql/118: changing a client is the Clients page's work, so it needs View jobs as well (sql/test/customersAccess.test.ts).
  it('with jobs.write and jobs.read, and an admin without either: can', async () => {
    const c = await makeRow(db, 'customers', A)
    for (const id of [await member(A, ['jobs.write', 'jobs.read']), await member(A, [], 'admin')]) {
      expect(await errorAs(db, who(id), `insert into public.customers (clinic_id, name) values ($1, 'Uus')`, [A.clinicId])).toBeNull()
      expect(await rowsAs(db, who(id), `update public.customers set name = 'Y' where id = $1 returning 1`, [c.id])).toHaveLength(1)
    }
  })
})

describe('clinic settings: shared columns for everyone, the rest for owners and admins', () => {
  const SHARED = 'clinic_id, work_types, visit_types, materials, material_prices, machines, pipeline_stages, pricing, calendar, payroll, features, updated_at'

  beforeAll(async () => {
    await db.query(`insert into public.clinic_settings (clinic_id, email, material_costs, broneering, public_services, vestlus)
                    values ($1, '{"saatjaAadress":"arved@kliinik.ee","testAadress":null}', '{"Zirkoon":{"hind":12}}',
                            '{"visiiditasu":5}', '[{"id":"s1"}]', '{"sailitusKuud":12}')
                    on conflict (clinic_id) do update set email = excluded.email, material_costs = excluded.material_costs,
                      broneering = excluded.broneering, public_services = excluded.public_services, vestlus = excluded.vestlus`, [A.clinicId])
  })

  it('a worker reads the shared columns, but not `*` and not a private column', async () => {
    const w = await member(A, ['jobs.write'])
    expect(await rowsAs(db, who(w), `select ${SHARED} from public.clinic_settings`)).toHaveLength(1)
    expect(await errorAs(db, who(w), `select * from public.clinic_settings`)).toMatch(/permission denied/)
    for (const col of ['email', 'material_costs', 'broneering', 'public_services', 'vestlus']) {
      expect(await errorAs(db, who(w), `select ${col} from public.clinic_settings`), col).toMatch(/permission denied/)
    }
  })

  it('clinic_settings_private(): nothing for a worker, material costs for a payroll manager, everything for owners and admins', async () => {
    const priv = async (id: string) => (await rowsAs<{ p: Record<string, unknown> | null }>(db, who(id), `select public.clinic_settings_private() as p`))[0].p
    expect(await priv(await member(A, ['jobs.write', 'payments.read']))).toEqual({})
    expect(await priv(await member(A, ['payroll.manage']))).toEqual({ material_costs: { Zirkoon: { hind: 12 } } })
    for (const id of [A.ownerId, await member(A, [], 'admin')]) {
      expect(await priv(id)).toEqual({
        email: { saatjaAadress: 'arved@kliinik.ee', testAadress: null },
        material_costs: { Zirkoon: { hind: 12 } },
        broneering: { visiiditasu: 5 }, public_services: [{ id: 's1' }], vestlus: { sailitusKuud: 12 },
      })
    }
  })

  it('without the second factor, or for another clinic, nothing', async () => {
    expect((await rowsAs<{ p: unknown }>(db, { id: A.ownerId, mfa: false }, `select public.clinic_settings_private() as p`).catch(() => [{ p: null }]))[0].p).toBeNull()
    const other = await member(B, [], 'admin')
    expect((await rowsAs<{ p: unknown }>(db, who(other), `select public.clinic_settings_private() as p`))[0].p).toBeNull()
  })

  it('the owner still saves a private column, and the service role reads them all', async () => {
    expect(await rowsAs(db, who(A.ownerId), `update public.clinic_settings set email = '{"saatjaAadress":"uus@kliinik.ee"}' where clinic_id = $1 returning clinic_id`, [A.clinicId])).toHaveLength(1)
    const { rows } = await db.query<{ email: { saatjaAadress: string } }>(`select email from public.clinic_settings where clinic_id = $1`, [A.clinicId])
    expect(rows[0].email.saatjaAadress).toBe('uus@kliinik.ee')
  })
})

describe('deleting a job: jobs.delete', () => {
  /** A job of A's that `id` is the technician on, so they can read it without jobs.read. */
  async function theirJob(id: string): Promise<string> {
    const j = await makeRow(db, 'jobs', A)
    await db.query(`update public.jobs set assigned_to = $1 where id = $2`, [id, j.id])
    return j.id as string
  }
  const deletedAt = async (id: string) =>
    (await db.query<{ d: Date | null }>(`select deleted_at as d from public.jobs where id = $1`, [id])).rows[0].d

  it('jobs.write edits but does not delete, nor see the trash or restore', async () => {
    const w = await member(A, ['jobs.write'])
    const job = await theirJob(w)
    expect(await rowsAs(db, who(w), `update public.jobs set patsient = 'Muudetud' where id = $1 returning 1`, [job])).toHaveLength(1)
    expect(await rowsAs(db, who(w), `delete from public.jobs where id = $1 returning 1`, [job])).toEqual([])
    expect(await deletedAt(job)).toBeNull()
    await rowsAs(db, who(A.ownerId), `delete from public.jobs where id = $1 returning 1`, [job])
    expect(await rowsAs(db, who(w), `select * from public.deleted_jobs()`)).toEqual([])
    expect(await errorAs(db, who(w), `select public.restore_job($1)`, [job])).toMatch(/not found/i)
  })

  it('jobs.delete, an admin and the owner delete (softly) and restore', async () => {
    for (const id of [await member(A, ['jobs.delete']), await member(A, [], 'admin'), A.ownerId]) {
      const job = await theirJob(id)
      await rowsAs(db, who(id), `delete from public.jobs where id = $1 returning 1`, [job])
      expect(await deletedAt(job)).not.toBeNull()
      expect((await rowsAs<{ id: string }>(db, who(id), `select id from public.deleted_jobs()`)).map(r => r.id)).toContain(job)
      expect(await errorAs(db, who(id), `select public.restore_job($1)`, [job])).toBeNull()
      expect(await deletedAt(job)).toBeNull()
    }
  })

  it('setting deleted_at by an ordinary update is still refused (sql/091)', async () => {
    const w = await member(A, ['jobs.write'])
    const job = await theirJob(w)
    expect(await errorAs(db, who(w), `update public.jobs set deleted_at = now() where id = $1`, [job])).toMatch(/row-level security/)
  })
})

describe('a new technician\'s defaults', () => {
  const permsOf = async (id: string) => (await db.query<{ permission: string; granted: boolean }>(
    `select permission, granted from public.worker_permissions where profile_id = $1 order by 1`, [id])).rows

  it('an account made with the owner\'s invite gets jobs.write, stock.read, stock.write and nothing else', async () => {
    const [{ token }] = await rowsAs<{ token: string }>(db, who(A.ownerId), `select public.create_worker_invite() as token`)
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`${crypto.randomUUID()}@kliinik.test`, JSON.stringify({ full_name: 'Uus tehnik', invite_token: token })])
    expect(await permsOf(rows[0].id)).toEqual([
      { permission: 'jobs.write', granted: true }, { permission: 'stock.read', granted: true }, { permission: 'stock.write', granted: true },
    ])
    // No money, no deleting, no other people's jobs.
    expect(await rowsAs(db, who(rows[0].id), `select * from public.invoices`)).toEqual([])
  })

  it('an account made without an invite, and existing members, get nothing new', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`${crypto.randomUUID()}@kliinik.test`])
    expect(await permsOf(rows[0].id)).toEqual([])
    expect(await permsOf(A.workerId)).toEqual([])
  })

  it('the app\'s Technician preset is the same list as the database\'s', async () => {
    const { rows } = await db.query<{ p: string[] }>(`select public.technician_permissions() as p`)
    expect([...rows[0].p].sort()).toEqual([...TECHNICIAN_PRESET].sort())
  })
})

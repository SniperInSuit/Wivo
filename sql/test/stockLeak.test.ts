/**
 * Stock leak test (sql/093). A partner reaches stock in one way only:
 * `partner_stock()`, its own consignment goods on a clinic's shelf, when the
 * partnership shares stock. It must never reach, through stock or anything
 * else:
 *   - which job or patient its goods were used on (the use movement links
 *     the job inside the clinic),
 *   - the clinic's own goods, another owner's goods, the reasons and dates of
 *     single movements.
 * A new function that touches stock fails this file until it is added here.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, grant, publicTables, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant  // Tallinn — the shelf, the patient, the job
let B: Tenant  // Riga — partner, share_stock ON, owns consignment goods at Tallinn
let D: Tenant  // Daugavpils — partner, share_stock OFF, owns goods at Tallinn
let C: Tenant  // Cesis — no partnership
let jobId: string
let jobCode: string
let rigaItem: string

const NAME = 'Zelinda Quorrington'
const FORBIDDEN = () => [
  'zelinda', 'quorrington', jobId, jobCode,
  'own-lot-tallinn', 'daugavpils-lot', 'supplier-lot', 'secret-reason', 'straumann baltics',
]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  D = await createTenant(db, 'Daugavpils')
  C = await createTenant(db, 'Cesis')
  await grant(db, B, B.workerId, ['stock.read'])
  await db.query(`insert into public.partnership (org_a, org_b, status, roles, share_stock) values ($1, $2, 'active', array['supplier'], true)`, [A.clinicId, B.clinicId])
  await db.query(`insert into public.partnership (org_a, org_b, status, roles, share_stock) values ($1, $2, 'active', array['supplier'], false)`, [A.clinicId, D.clinicId])
  const p = await db.query<{ id: string }>(`insert into public.patients (clinic_id, nimi, synniaeg) values ($1, $2, '1984-07-19') returning id`, [A.clinicId, NAME])
  const j = await db.query<{ id: string; job_code: string }>(
    `insert into public.jobs (clinic_id, patsient, patient_id, status) values ($1, $2, $3, 'disain') returning id, job_code`, [A.clinicId, NAME, p.rows[0].id])
  jobId = j.rows[0].id
  jobCode = j.rows[0].job_code

  const add = async (lot: string, ownerOrg: string | null, supplier: string | null) =>
    (await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `select public.add_stock_item('implant', 'Straumann', 'BLT', '4.1x10', 'RC', $1, '2028-01-31', 10, 3, $2, $3) as id`,
      [lot, ownerOrg, supplier]))[0].id
  const own = await add('OWN-LOT-TALLINN', null, null)
  rigaItem = await add('RIGA-LOT-7', B.clinicId, null)
  await add('DAUGAVPILS-LOT', D.clinicId, null)
  await add('SUPPLIER-LOT', null, 'Straumann Baltics')
  const act = (sql: string, params: unknown[]) => rowsAs(db, { id: A.ownerId }, sql, params)
  await act(`select public.use_stock($1, 2, $2)`, [rigaItem, jobId])
  await act(`select public.use_stock($1, 1, $2)`, [own, jobId])
  await act(`select public.return_stock($1, 1, 'SECRET-REASON wrong size')`, [rigaItem])
  await act(`select public.buy_out_stock($1, 2)`, [rigaItem])
  await act(`select public.adjust_stock($1, -1, 'SECRET-REASON dropped')`, [rigaItem])
  await act(`select public.writeoff_stock($1, 1, 'damaged', 'SECRET-REASON cracked')`, [rigaItem])
  await act(`select public.set_stock_threshold($1, 5)`, [rigaItem])
}, 120_000)

describe('what a partner sees of its goods', () => {
  it('with share_stock on: its own goods only, as totals', async () => {
    for (const actor of [{ id: B.ownerId }, { id: B.workerId }]) {
      const rows = await rowsAs<Record<string, unknown>>(db, actor, `select * from public.partner_stock()`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        item_id: rigaItem, location_name: 'Tallinn', lot: 'RIGA-LOT-7', expiry_date: expect.anything(),
        received: 10, used: 2, returned: 1, bought: 2, written_off: 1, adjusted: -1, remaining: 3,
      })
      expect(Object.keys(rows[0]).some(k => /job|patient|reason|by|at$/.test(k))).toBe(false)
    }
  })

  it('with share_stock off: nothing, not even its own goods', async () => {
    expect(await rowsAs(db, { id: D.ownerId }, `select * from public.partner_stock()`)).toEqual([])
  })

  it('a stranger: nothing', async () => {
    expect(await rowsAs(db, { id: C.ownerId }, `select * from public.partner_stock()`)).toEqual([])
  })

  it('without stock.read in its own organisation: nothing', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('nostock@test.invalid') returning id`)
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [B.clinicId, rows[0].id])
    expect(await rowsAs(db, { id: rows[0].id }, `select * from public.partner_stock()`)).toEqual([])
  })

  it('the tables themselves return nothing to a partner', async () => {
    for (const t of ['stock_item', 'stock_movement', 'stock_levels', 'stock_product_levels', 'stock_threshold']) {
      expect(await rowsAs(db, { id: B.ownerId }, `select * from public.${t}`)).toEqual([])
    }
  })
})

describe('leak test: no job, no patient, nothing of the clinic\'s own, through anything', () => {
  /** Every function a signed-in user can call that reads or writes stock. */
  const COVERED = ['add_stock_item', 'adjust_stock', 'archive_stock_item', 'buy_out_stock', 'partner_stock',
    'receive_stock', 'record_inventory_count', 'return_stock', 'set_stock_threshold', 'update_stock_item', 'use_stock',
    'writeoff_stock']

  it('the sweep covers every function that touches stock', async () => {
    const { rows } = await db.query<{ proname: string }>(`
      select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('authenticated', p.oid, 'execute')
         and p.prosrc ~ '(stock_item|stock_movement|stock_levels|stock_qty|take_stock)'
       order by 1`)
    const missing = rows.map(r => r.proname).filter(f => !COVERED.includes(f))
    expect(missing, 'add these to the sweep below, then to COVERED').toEqual([])
  })

  it('every call, every table, every view, as each partner and the stranger', async () => {
    const tables = await publicTables(db)
    const { rows: views } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`)
    const actors: Actor[] = [{ id: B.ownerId }, { id: B.workerId }, { id: D.ownerId }, { id: C.ownerId }]
    for (const actor of actors) {
      const seen: unknown[] = []
      const run = async (sql: string, params: unknown[] = []) => {
        try { seen.push(await rowsAs(db, actor, sql, params)) } catch (e) { seen.push((e as Error).message) }
      }
      await run(`select * from public.partner_stock()`)
      await run(`select public.use_stock($1, 1, $2)`, [rigaItem, jobId])
      await run(`select public.receive_stock($1, 1)`, [rigaItem])
      await run(`select public.return_stock($1, 1)`, [rigaItem])
      await run(`select public.buy_out_stock($1, 1)`, [rigaItem])
      await run(`select public.adjust_stock($1, 1, 'x')`, [rigaItem])
      await run(`select public.archive_stock_item($1)`, [rigaItem])
      await run(`select public.writeoff_stock($1, 1, 'damaged')`, [rigaItem])
      await run(`select public.set_stock_threshold($1, 1)`, [rigaItem])
      await run(`select public.use_stock($1, 1, $2, 'override')`, [rigaItem, jobId])
      await run(`select public.update_stock_item($1, 'S', null, null, null, 'L', '2028-01-01')`, [rigaItem])
      await run(`select public.record_inventory_count(now(), $1)`, [JSON.stringify([{ item_id: rigaItem, counted: 0, reason: 'x' }])])
      await run(`select public.set_inventory_schedule(1, current_date)`)
      await run(`select public.add_stock_item('implant', 'S', null, null, null, 'L', '2028-01-01', 1, null, $1)`, [A.clinicId])
      for (const t of tables) await run(`select * from public.${t}`)
      for (const v of views) await run(`select * from public.${v.relname}`)

      const text = JSON.stringify(seen).toLowerCase()
      for (const bad of FORBIDDEN()) expect(text, `${bad} reached ${JSON.stringify(actor)}`).not.toContain(bad.toLowerCase())
    }
    // Nothing above changed the goods.
    const [r] = await rowsAs<{ remaining: number }>(db, { id: B.ownerId }, `select remaining from public.partner_stock()`)
    expect(r.remaining).toBe(3)
  })
})

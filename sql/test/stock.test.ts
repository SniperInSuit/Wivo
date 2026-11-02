/**
 * Stock (sql/093), spec Phase 2. Acceptance:
 *   - "Goods without an expiry date cannot be saved."
 *   - "Consignment goods are red a month before they are due" (the date is
 *     here; the colour is lib/stockWarnings).
 *   - Stock comes from movements; use on a job links the lot to the job.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant  // Tallinn
let B: Tenant  // Riga, partner
let C: Tenant  // Cesis, no partnership
let jobId: string

const owner = () => ({ id: A.ownerId })

async function add(opts: { lot?: string | null; expiry?: string | null; qty?: number; ownerOrg?: string | null; supplier?: string | null; due?: string | null; product?: string } = {}): Promise<string> {
  const [r] = await rowsAs<{ id: string }>(db, owner(),
    `select public.add_stock_item('implant', 'Straumann', 'BLT', '4.1x10', $1, $2, $3, $4, 2, $5, $6, $7) as id`,
    [opts.product ?? 'RC', opts.lot === undefined ? 'LOT-1' : opts.lot, opts.expiry === undefined ? '2028-01-31' : opts.expiry,
     opts.qty ?? 5, opts.ownerOrg ?? null, opts.supplier ?? null, opts.due ?? null])
  return r.id
}

const qty = async (item: string) =>
  (await rowsAs<{ qty: number }>(db, owner(), `select qty from public.stock_levels where id = $1`, [item]))[0]?.qty

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
  await db.query(`insert into public.partnership (org_a, org_b, status, roles, share_stock) values ($1, $2, 'active', array['supplier'], true)`,
    [A.clinicId, B.clinicId])
  const { rows } = await db.query<{ id: string }>(`insert into public.jobs (clinic_id, patsient, status) values ($1, 'Mari Maasikas', 'disain') returning id`, [A.clinicId])
  jobId = rows[0].id
  await db.query(`insert into public.patients (clinic_id, nimi) values ($1, 'Zelinda Quorrington')`, [A.clinicId])
}, 120_000)

describe('adding goods', () => {
  it('needs a lot number and an expiry date — through the function and the table', async () => {
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, null, null, '2028-01-01', 1)`)).toMatch(/lot number/)
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, null, '  ', '2028-01-01', 1)`)).toMatch(/lot number/)
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, null, 'L1', null, 1)`)).toMatch(/expiry/)
    await expect(db.query(`insert into public.stock_item (org_id, category, manufacturer, lot) values ($1, 'implant', 'S', 'L')`, [A.clinicId]))
      .rejects.toThrow(/expiry_date/)
  })

  it('needs a quantity, a known category and something to call it by', async () => {
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, null, 'L', '2028-01-01', 0)`)).toMatch(/more than zero/)
    expect(await errorAs(db, owner(), `select public.add_stock_item('crown', 'S', null, null, null, 'L', '2028-01-01', 1)`)).toMatch(/category/)
    expect(await errorAs(db, owner(), `select public.add_stock_item('other', null, null, null, null, 'L', '2028-01-01', 1)`)).toMatch(/manufacturer or a product/)
  })

  it('the quantity is the sum of the movements; more of the same lot is a movement too', async () => {
    const i = await add({ qty: 5 })
    expect(await qty(i)).toBe(5)
    await rowsAs(db, owner(), `select public.receive_stock($1, 3)`, [i])
    expect(await qty(i)).toBe(8)
    const kinds = await rowsAs<{ kind: string; delta: number }>(db, owner(), `select kind, delta from public.stock_movement where item_id = $1 order by at`, [i])
    expect(kinds).toEqual([{ kind: 'in', delta: 5 }, { kind: 'in', delta: 3 }])
  })

  it('needs stock.write; reading needs stock.read', async () => {
    const i = await add()
    expect(await errorAs(db, { id: A.workerId }, `select public.add_stock_item('implant', 'S', null, null, null, 'L', '2028-01-01', 1)`)).toMatch(/permission/)
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.stock_levels where id = $1`, [i])).toEqual([])
    await grant(db, A, A.workerId, ['stock.read'])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.stock_levels where id = $1`, [i])).toHaveLength(1)
    expect(await errorAs(db, { id: A.workerId }, `select public.use_stock($1, 1)`, [i])).toMatch(/permission/)
  })
})

describe('consignment', () => {
  it('from a partner: due in three months unless a date is given', async () => {
    const i = await add({ ownerOrg: B.clinicId })
    const { rows } = await db.query<{ due: string; expected: string }>(
      `select consignment_due::text as due, (current_date + interval '3 months')::date::text as expected from public.stock_item where id = $1`, [i])
    expect(rows[0].due).toBe(rows[0].expected)
    const j = await add({ supplier: 'Straumann Baltics', due: '2027-02-01' })
    expect((await db.query(`select consignment_due::text as d from public.stock_item where id = $1`, [j])).rows).toEqual([{ d: '2027-02-01' }])
  })

  it('a partner owner needs an active partnership', async () => {
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, null, 'L', '2028-01-01', 1, null, $1)`, [C.clinicId]))
      .toMatch(/partnership/)
  })

  it('return and buy out are for consignment goods only', async () => {
    const own = await add()
    expect(await errorAs(db, owner(), `select public.return_stock($1, 1)`, [own])).toMatch(/consignment/)
    expect(await errorAs(db, owner(), `select public.buy_out_stock($1, 1)`, [own])).toMatch(/consignment/)
  })

  it('return lowers the consignment stock', async () => {
    const i = await add({ ownerOrg: B.clinicId, qty: 4 })
    await rowsAs(db, owner(), `select public.return_stock($1, 1, 'wrong size')`, [i])
    expect(await qty(i)).toBe(3)
  })

  it('buy out: the goods leave the consignment item and arrive as our own, same lot and expiry', async () => {
    const i = await add({ ownerOrg: B.clinicId, qty: 4, lot: 'BUY-LOT' })
    const [{ id }] = await rowsAs<{ id: string }>(db, owner(), `select public.buy_out_stock($1, 3) as id`, [i])
    expect(await qty(i)).toBe(1)
    expect(await qty(id)).toBe(3)
    const { rows } = await db.query(`select owner_org, consignment_due, lot, expiry_date::text as e from public.stock_item where id = $1`, [id])
    expect(rows[0]).toEqual({ owner_org: null, consignment_due: null, lot: 'BUY-LOT', e: '2028-01-31' })
  })

  it('text on a partner\'s goods may not name one of our patients (the partner reads it)', async () => {
    const err = await rowsAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, 'for Quorrington', 'L', '2028-01-01', 1, null, $1)`, [B.clinicId])
      .then(() => null, (e: { code?: string }) => e.code)
    expect(err).toBe('WV001')
    // Our own goods are not shown to anyone else: not checked.
    expect(await errorAs(db, owner(), `select public.add_stock_item('implant', 'S', null, null, 'for Quorrington', 'L', '2028-01-01', 1)`)).toBeNull()
  })
})

describe('using goods', () => {
  it('on our own job: stock goes down and the movement carries the job', async () => {
    const i = await add({ qty: 3 })
    await rowsAs(db, owner(), `select public.use_stock($1, 2, $2)`, [i, jobId])
    expect(await qty(i)).toBe(1)
    const m = await rowsAs<{ job_id: string }>(db, owner(), `select job_id from public.stock_movement where item_id = $1 and kind = 'use'`, [i])
    expect(m).toEqual([{ job_id: jobId }])
  })

  it('never below zero', async () => {
    const i = await add({ qty: 1 })
    expect(await errorAs(db, owner(), `select public.use_stock($1, 2)`, [i])).toMatch(/Not enough/)
  })

  it('not on another organisation\'s job, nor a deleted one', async () => {
    const i = await add()
    const { rows } = await db.query<{ id: string }>(`insert into public.jobs (clinic_id, patsient, status) values ($1, 'X', 'disain') returning id`, [C.clinicId])
    expect(await errorAs(db, owner(), `select public.use_stock($1, 1, $2)`, [i, rows[0].id])).toMatch(/Job not found/)
    const { rows: own } = await db.query<{ id: string }>(`insert into public.jobs (clinic_id, patsient, status) values ($1, 'Y', 'disain') returning id`, [A.clinicId])
    await rowsAs(db, owner(), `delete from public.jobs where id = $1`, [own[0].id])  // soft delete (sql/089)
    expect(await errorAs(db, owner(), `select public.use_stock($1, 1, $2)`, [i, own[0].id])).toMatch(/Job not found/)
  })

  it('another organisation cannot use our goods', async () => {
    const i = await add({ ownerOrg: B.clinicId })
    expect(await errorAs(db, { id: B.ownerId }, `select public.use_stock($1, 1)`, [i])).toMatch(/Item not found/)
    expect(await errorAs(db, { id: C.ownerId }, `select public.receive_stock($1, 1)`, [i])).toMatch(/Item not found/)
  })
})

describe('corrections and history', () => {
  it('a correction needs a reason and cannot go below zero', async () => {
    const i = await add({ qty: 2 })
    expect(await errorAs(db, owner(), `select public.adjust_stock($1, -1, '  ')`, [i])).toMatch(/reason/)
    expect(await errorAs(db, owner(), `select public.adjust_stock($1, -3, 'broken')`, [i])).toMatch(/Not enough/)
    await rowsAs(db, owner(), `select public.adjust_stock($1, -1, 'dropped, not sterile')`, [i])
    expect(await qty(i)).toBe(1)
  })

  it('movements are never changed or removed by anyone signed in — even with full rights', async () => {
    const i = await add()
    const { rows } = await db.query<{ id: string }>(`select id from public.stock_movement where item_id = $1`, [i])
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: A.ownerId, role: 'authenticated' })])
    await expect(db.query(`update public.stock_movement set delta = 99 where id = $1`, [rows[0].id])).rejects.toThrow(/cannot be changed/)
    await expect(db.query(`delete from public.stock_movement where id = $1`, [rows[0].id])).rejects.toThrow(/cannot be removed/)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  })

  it('an item is archived only when empty; then it cannot be moved', async () => {
    const i = await add({ qty: 1 })
    expect(await errorAs(db, owner(), `select public.archive_stock_item($1)`, [i])).toMatch(/empty/)
    await rowsAs(db, owner(), `select public.use_stock($1, 1)`, [i])
    await rowsAs(db, owner(), `select public.archive_stock_item($1)`, [i])
    expect(await errorAs(db, owner(), `select public.receive_stock($1, 1)`, [i])).toMatch(/archived/)
  })

  it('editing keeps lot and expiry required, and sets the warning threshold', async () => {
    const i = await add()
    expect(await errorAs(db, owner(), `select public.update_stock_item($1, 'S', null, null, null, '', '2028-01-01', 1)`, [i])).toMatch(/lot number/)
    await rowsAs(db, owner(), `select public.update_stock_item($1, 'Straumann', 'BLT', '4.1x12', 'RC', 'LOT-9', '2029-01-01', 4)`, [i])
    expect((await db.query(`select size, lot, min_qty from public.stock_item where id = $1`, [i])).rows).toEqual([{ size: '4.1x12', lot: 'LOT-9', min_qty: 4 }])
  })
})

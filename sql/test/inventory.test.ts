/**
 * Inventory counts (sql/094). Spec acceptance: "An inventory difference
 * changes the stock only with a reason"; the history stays.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const owner = () => ({ id: A.ownerId })

async function item(qty: number): Promise<string> {
  const [r] = await rowsAs<{ id: string }>(db, owner(),
    `select public.add_stock_item('abutment', 'Nobel', null, null, null, 'L', '2028-01-01', $1) as id`, [qty])
  return r.id
}
const qty = async (id: string) => (await rowsAs<{ qty: number }>(db, owner(), `select qty from public.stock_levels where id = $1`, [id]))[0].qty
const count = (lines: unknown[]) =>
  rowsAs<{ id: string }>(db, owner(), `select public.record_inventory_count(now() - interval '10 minutes', $1) as id`, [JSON.stringify(lines)])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

describe('the schedule', () => {
  it('is set by someone with stock.write, for their organisation', async () => {
    await rowsAs(db, owner(), `select public.set_inventory_schedule(3, current_date - 1)`)
    const rows = await rowsAs<{ interval_months: number; overdue: boolean }>(db, owner(),
      `select interval_months, next_due < current_date as overdue from public.inventory_schedule`)
    expect(rows).toEqual([{ interval_months: 3, overdue: true }])
    expect(await errorAs(db, { id: A.workerId }, `select public.set_inventory_schedule(1, current_date)`)).toMatch(/permission/)
    expect(await errorAs(db, owner(), `select public.set_inventory_schedule(30, current_date)`)).toMatch(/interval_valid/)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.inventory_schedule`)).toEqual([])
  })

  it('moves on by its interval when a count is saved', async () => {
    await count([{ item_id: await item(1), counted: 1 }])
    const [r] = await rowsAs<{ ok: boolean }>(db, owner(),
      `select next_due = (current_date + interval '3 months')::date as ok from public.inventory_schedule`)
    expect(r.ok).toBe(true)
  })
})

describe('a count', () => {
  it('a difference without a reason is refused, and nothing is saved', async () => {
    const i = await item(5)
    expect(await errorAs(db, owner(), `select public.record_inventory_count(now(), $1)`, [JSON.stringify([{ item_id: i, counted: 4 }])]))
      .toMatch(/needs a reason/)
    expect(await qty(i)).toBe(5)
  })

  it('with a reason: the stock follows the count, and the history keeps both', async () => {
    const i = await item(5)
    const same = await item(2)
    const [{ id }] = await count([{ item_id: i, counted: 3, reason: 'two found expired' }, { item_id: same, counted: 2 }])
    expect(await qty(i)).toBe(3)
    expect(await qty(same)).toBe(2)
    const lines = await rowsAs(db, owner(), `select item_id, expected, counted, reason from public.inventory_count_line where count_id = $1 order by expected desc`, [id])
    expect(lines).toEqual([
      { item_id: i, expected: 5, counted: 3, reason: 'two found expired' },
      { item_id: same, expected: 2, counted: 2, reason: null },
    ])
    const moves = await rowsAs(db, owner(), `select item_id, kind, delta, reason from public.stock_movement where count_id = $1`, [id])
    expect(moves).toEqual([{ item_id: i, kind: 'adjust', delta: -2, reason: 'two found expired' }])
  })

  it('refuses an empty count, a negative number, an item twice, another organisation\'s item', async () => {
    const i = await item(1)
    expect(await errorAs(db, owner(), `select public.record_inventory_count(now(), '[]')`)).toMatch(/Nothing/)
    expect(await errorAs(db, owner(), `select public.record_inventory_count(now(), $1)`, [JSON.stringify([{ item_id: i, counted: -1, reason: 'x' }])])).toMatch(/negative/)
    expect(await errorAs(db, owner(), `select public.record_inventory_count(now(), $1)`, [JSON.stringify([{ item_id: i, counted: 1 }, { item_id: i, counted: 1 }])])).toMatch(/twice/)
    expect(await errorAs(db, { id: B.ownerId }, `select public.record_inventory_count(now(), $1)`, [JSON.stringify([{ item_id: i, counted: 0, reason: 'x' }])])).toMatch(/permission|not found/)
  })

  it('the history is the clinic\'s own', async () => {
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.inventory_count`)).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.inventory_count_line`)).toEqual([])
  })
})

/**
 * sql/107: the foreign keys a restore left out are put back — exactly the ones
 * the migrations define, nothing else — so PostgREST can again embed
 * invoices with their lines and payments (the owner's Invoices screen and the
 * Finance cards). PostgREST itself is not in this harness: what it needs is the
 * foreign key in pg_constraint, and that, plus the owner's read through RLS, is
 * what these tests check.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, makeRow, rowsAs, type Tenant } from './harness'

interface Fk { tbl: string; col: string; ref: string; ref_col: string; on_delete: string; valid: boolean }

async function foreignKeys(d: PGlite): Promise<Fk[]> {
  const { rows } = await d.query<Fk>(`
    select cl.relname as tbl, a.attname as col, rn.nspname || '.' || rc.relname as ref, ra.attname as ref_col,
           c.confdeltype::text as on_delete, c.convalidated as valid
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class rc on rc.oid = c.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and n.nspname = 'public'
     order by 1, 2, 3`)
  return rows
}

/** What PostgREST needs to embed `child` in `parent`: a foreign key from child to parent. */
async function relationship(d: PGlite, child: string, parent: string): Promise<boolean> {
  const { rows } = await d.query(`select 1 from pg_constraint where contype = 'f'
    and conrelid = ('public.' || $1)::regclass and confrelid = ('public.' || $2)::regclass`, [child, parent])
  return rows.length > 0
}

/** The test copy's state: every foreign key in public gone. */
async function dropAllForeignKeys(d: PGlite): Promise<void> {
  await d.exec(`do $$ declare r record; begin
    for r in select conrelid::regclass as t, conname from pg_constraint c join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
              where c.contype = 'f' and n.nspname = 'public' loop
      execute format('alter table %s drop constraint %I', r.t, r.conname);
    end loop; end $$;`)
}

const run107 = (d: PGlite) => applyMigrations(d, ['107_restore_foreign_keys.sql'])

describe('107 puts back exactly the foreign keys the migrations define', () => {
  it('a database that lost them all gets back the same 117, with the same columns, targets and ON DELETE', async () => {
    const d = await emptyDb()
    await applyMigrations(d, migrationFiles().filter(f => f < '107'))
    const before = await foreignKeys(d)
    expect(before).toHaveLength(117)
    await dropAllForeignKeys(d)
    expect(await foreignKeys(d)).toEqual([])
    expect(await relationship(d, 'invoice_lines', 'invoices')).toBe(false)
    await run107(d)
    expect(await foreignKeys(d)).toEqual(before)
    expect(await relationship(d, 'invoice_lines', 'invoices')).toBe(true)
    expect(await relationship(d, 'payments', 'invoices')).toBe(true)
  }, 120_000)
})

describe('on a complete database (production, a fresh one) it changes nothing', () => {
  it('no duplicate, nothing added, running it again neither — except the key sql/115 removed on purpose', async () => {
    const d = await freshDb()
    const before = await foreignKeys(d)
    await run107(d)
    await run107(d)
    // 107's list is fixed: it puts back audit_log.user_id, which sql/115 dropped so that deleting an account
    // keeps who made each change. Hence "do not run 107 again" (docs/AUDIT.md §2.7), and schema_check.sql
    // reports the key as "must be absent".
    const after = await foreignKeys(d)
    const added = after.filter(k => !before.some(b => JSON.stringify(b) === JSON.stringify(k)))
    expect(added.map(k => `${k.tbl}.${k.col}`)).toEqual(['audit_log.user_id'])
    expect(after.filter(k => !added.includes(k))).toEqual(before)
    const { rows } = await d.query<{ n: number }>(`select count(*)::int as n from pg_constraint c
      join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
      where c.contype = 'f' and n.nspname = 'public'`)
    expect(rows[0].n).toBe(117)
  }, 120_000)
})

describe('old rows that point at nothing do not stop it', () => {
  it('the key is added NOT VALID: it guards new rows and gives PostgREST the relationship', async () => {
    const d = await freshDb()
    await d.exec(`alter table public.invoice_lines drop constraint invoice_lines_invoice_id_fkey`)
    await d.query(`insert into public.invoice_lines (invoice_id, description) values (gen_random_uuid(), 'orphan')`)
    await run107(d)
    const fk = (await foreignKeys(d)).find(f => f.tbl === 'invoice_lines' && f.col === 'invoice_id')
    expect(fk).toMatchObject({ ref: 'public.invoices', ref_col: 'id', on_delete: 'c', valid: false })
    expect(await relationship(d, 'invoice_lines', 'invoices')).toBe(true)
    await expect(d.query(`insert into public.invoice_lines (invoice_id, description) values (gen_random_uuid(), 'new orphan')`))
      .rejects.toThrow(/foreign key/)
  }, 120_000)
})

describe('the owner loads invoices with their lines and payments', () => {
  let db: PGlite
  let A: Tenant

  beforeAll(async () => {
    db = await freshDb()
    await dropAllForeignKeys(db)   // as the test copy was
    await run107(db)
    A = await createTenant(db, 'Tallinn')
  }, 120_000)

  it('what Invoices asks for — invoices, lines:invoice_lines(*), payments(*) — comes back for the owner', async () => {
    const inv = await makeRow(db, 'invoices', A)
    await db.query(`insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kroon', 2, 100)`, [inv.id])
    await db.query(`insert into public.payments (clinic_id, invoice_id, amount) values ($1, $2, 50)`, [A.clinicId, inv.id])
    // The embedding PostgREST builds from the foreign keys, as the owner, through RLS.
    expect(await relationship(db, 'invoice_lines', 'invoices')).toBe(true)
    expect(await relationship(db, 'payments', 'invoices')).toBe(true)
    const rows = await rowsAs<{ id: string; lines: { description: string }[]; payments: { amount: string }[] }>(db, { id: A.ownerId }, `
      select i.id,
             coalesce((select json_agg(l) from public.invoice_lines l where l.invoice_id = i.id), '[]') as lines,
             coalesce((select json_agg(p) from public.payments p where p.invoice_id = i.id), '[]') as payments
        from public.invoices i where i.id = $1`, [inv.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].lines.map(l => l.description)).toEqual(['Kroon'])
    expect(rows[0].payments).toHaveLength(1)
  })
})

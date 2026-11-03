/**
 * sql/checks/schema_check.sql — the read-only check that a database matches
 * the migrations — is current, reads only, finds nothing on a database built
 * from the migrations, and finds each kind of drift.
 *
 * WRITE_SCHEMA_CHECK=1 regenerates it after a migration changes the schema.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './harness'
import { CATALOG_SQL, renderCheck, type CatalogRow } from './schemaCatalog'

const FILE = join(__dirname, '..', 'checks', 'schema_check.sql')
const TRIGGER_FILE = join(__dirname, '..', 'checks', 'trigger_check.sql')
let fresh: PGlite
let check: string
let triggerCheck: string

beforeAll(async () => {
  fresh = await freshDb()
  const { rows } = await fresh.query<CatalogRow>(`${CATALOG_SQL} order by 1, 2`)
  check = renderCheck(rows)
  triggerCheck = renderCheck(rows, ['trigger'])
  if (process.env.WRITE_SCHEMA_CHECK === '1') {
    writeFileSync(FILE, check)
    writeFileSync(TRIGGER_FILE, triggerCheck)
  }
}, 120_000)

interface Diff { kind: string; key: string; status: string }
const differences = async (d: PGlite, file = FILE): Promise<Diff[]> => (await d.query<Diff>(readFileSync(file, 'utf8'))).rows

describe('the schema check', () => {
  it('is current: what a database built from every migration has (else: WRITE_SCHEMA_CHECK=1)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(check)
    expect(readFileSync(TRIGGER_FILE, 'utf8')).toBe(triggerCheck)
  })

  it('covers every kind it says it does', () => {
    for (const kind of ['trigger', 'index', 'constraint', 'not null', 'default', 'identity', 'sequence owner', 'view', 'row security', 'policy']) {
      expect(check, kind).toContain(`('${kind}', '`)
    }
  })

  it('only reads: it runs in a read-only transaction', async () => {
    await fresh.exec('begin transaction read only')
    try {
      await expect(fresh.query(readFileSync(FILE, 'utf8'))).resolves.toBeTruthy()
      await expect(fresh.query(readFileSync(TRIGGER_FILE, 'utf8'))).resolves.toBeTruthy()
    } finally {
      await fresh.exec('rollback')
    }
  })

  it('finds nothing on a database built from the migrations', async () => {
    expect(await differences(fresh)).toEqual([])
    expect(await differences(fresh, TRIGGER_FILE)).toEqual([])
  })

  it('finds each kind of drift a restore can leave', async () => {
    const d = await freshDb()
    await d.exec(`
      drop trigger soft_delete_job on public.jobs;
      drop index public.audit_log_org_at_idx;
      alter table public.invoices drop constraint invoices_number_per_clinic;
      alter table public.jobs alter column delivery_status set default 'valmis';
      alter table public.jobs alter column created_at drop default;
      alter table public.customers alter column name drop not null;
      drop policy "mfa_required" on storage.objects;
      alter table public.notification disable row level security;
      alter view public.stock_levels reset (security_invoker);
      create index extra_idx on public.jobs (patsient);
    `)
    const found = (await differences(d)).map(r => `${r.status} ${r.kind} ${r.key}`)
    expect(found).toEqual(expect.arrayContaining([
      'missing trigger public.jobs.soft_delete_job',
      'missing index public.audit_log_org_at_idx',
      'missing constraint public.invoices.invoices_number_per_clinic',
      'differs default public.jobs.delivery_status',
      'missing default public.jobs.created_at',
      'missing not null public.customers.name',
      'missing policy storage.objects.mfa_required',
      'differs row security public.notification',
      'differs view public.stock_levels',
      'extra index public.extra_idx',
    ]))
    // The trigger check: the trigger alone.
    expect((await differences(d, TRIGGER_FILE)).map(r => `${r.status} ${r.kind} ${r.key}`))
      .toEqual(['missing trigger public.jobs.soft_delete_job'])
  }, 120_000)
})

/**
 * sql/test-copy/cleanup_2026-11-04.sql: on a database in the state the test
 * copy was in after 109 — rows pointing at deleted accounts, seven lost
 * revokes, a shared and a missing code prefix, a job without a code, invoice
 * totals that disagree with their lines — it puts right what the migrations
 * decide, so the schema check and the orphan check find nothing. What it must
 * not decide (a profile that still has work, an invoice already sent) is
 * named and left. It refuses a database without sql/107, and where there is
 * nothing to do it changes nothing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, makeRow, errorAs, SQL_DIR } from './harness'
import { CATALOG_SQL } from './schemaCatalog'

const CLEANUP = readFileSync(join(SQL_DIR, 'test-copy', 'cleanup_2026-11-04.sql'), 'utf8')
const SCHEMA_CHECK = readFileSync(join(SQL_DIR, 'checks', 'schema_check.sql'), 'utf8')
const ORPHAN_CHECK = readFileSync(join(SQL_DIR, 'checks', 'orphan_users.sql'), 'utf8')

const SEVEN = [
  'public.audit(uuid, text, text, jsonb)',
  'public.find_invite(uuid, text)',
  'public.platform_approve_partnership(uuid)',
  'public.notify_org(uuid, uuid, text, jsonb)',
  'public.mark_notifications_emailed(uuid[])',
  'public.pending_bug_reports(int)',
  'public.mark_bug_reports_emailed(uuid[])',
]

/** The cleanup's result: the table the SQL Editor shows. */
async function cleanup(d: PGlite): Promise<string[]> {
  const results = await d.exec(CLEANUP)
  return (results[results.length - 1].rows as { part: string; what: string }[]).map(r => `${r.part} | ${r.what}`)
}

async function schema(d: PGlite): Promise<string[]> {
  const { rows } = await d.query<{ kind: string; key: string; def: string }>(`${CATALOG_SQL} order by 1, 2`)
  return rows.map(r => `${r.kind} ${r.key} ${r.def}`)
}

const one = async <T>(d: PGlite, sql: string, params: unknown[] = []): Promise<T> => (await d.query<T>(sql, params)).rows[0]

/**
 * sql/107's two keys to auth.users dropped while `fn` deletes accounts, then
 * added back NOT VALID: what the test copy has.
 */
async function withoutTheKeys(d: PGlite, fn: () => Promise<void>): Promise<void> {
  const keys = (await d.query<{ tbl: string; conname: string; def: string }>(
    `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('profiles_id_fkey', 'clinics_created_by_fkey')`)).rows
  expect(keys).toHaveLength(2)
  for (const k of keys) await d.exec(`alter table public.${k.tbl} drop constraint ${k.conname}`)
  await fn()
  for (const k of keys) await d.exec(`alter table public.${k.tbl} add constraint ${k.conname} ${k.def} not valid`)
}

describe('on the test copy as the checks found it after 109', () => {
  it('puts it right: the schema check and the orphan check then find nothing', async () => {
    const d = await freshDb()
    const A = await createTenant(d, 'Tallinn')
    const tal = (await one<{ code_prefix: string }>(d, `select code_prefix from public.clinics where id = $1`, [A.clinicId])).code_prefix

    // 1. "Riga Test SIA" made while set_code_prefix was missing, by an account
    //    deleted later; the throwaway account of check-standin-auth.sh.
    await d.exec(`drop index public.clinics_code_prefix_key;
                  alter table public.clinics disable trigger set_code_prefix;`)
    const riga = (await one<{ id: string }>(d, `insert into public.clinics (name) values ('Riga Test SIA') returning id`)).id
    await d.exec(`alter table public.clinics enable trigger set_code_prefix`)
    const creator = await createUser(d, 'Riga creator')
    const throwaway = await createUser(d, 'Wivo check (delete me)')
    await withoutTheKeys(d, async () => {
      await d.query(`update public.clinics set created_by = $1 where id = $2`, [creator, riga])
      await d.query(`delete from public.profiles where id = $1`, [creator])
      await d.query(`delete from auth.users where id = any($1)`, [[creator, throwaway]])
    })

    // 2. The seven revokes the restore lost.
    for (const fn of SEVEN) await d.exec(`grant execute on function ${fn} to authenticated`)

    // 3. A second clinic with Tallinn's prefix, with a stand-in login; one for
    //    Tallinn too. A job in Riga, which has no prefix: it gets no code.
    const tallinn2 = (await one<{ id: string }>(d,
      `insert into public.clinics (name, code_prefix) values ('Tallinn Two', $1) returning id`, [tal])).id
    const standin = async (clinic: string, username: string): Promise<string> => {
      const id = await createUser(d, username)
      await d.query(`update auth.users set email = $1 where id = $2`, [`${username}.${tal.toLowerCase()}@nomail.wivodent.com`, id])
      await d.query(`update public.profiles set clinic_id = $1, username = $2 where id = $3`, [clinic, username, id])
      return id
    }
    const anna = await standin(tallinn2, 'anna')
    const mart = await standin(A.clinicId, 'mart')
    const job = await makeRow(d, 'jobs', { ...A, clinicId: riga })
    expect(job.job_code).toBeNull()

    // 4. A draft and a sent invoice whose lines were added without the recount.
    const invoice = async (status: string): Promise<string> => {
      const row = await makeRow(d, 'invoices', A)
      await d.query(`update public.invoices set vat_rate = 22, status = $1 where id = $2`, [status, row.id])
      return row.id as string
    }
    const draft = await invoice('mustand')
    const sent = await invoice('saadetud')
    await d.exec(`alter table public.invoice_lines disable trigger invoice_lines_recalc`)
    for (const id of [draft, sent]) {
      await d.query(`insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kroon', 2, 10.50)`, [id])
    }
    await d.exec(`alter table public.invoice_lines enable trigger invoice_lines_recalc`)
    const number = async (id: string): Promise<string> => (await one<{ number: string }>(d, `select number from public.invoices where id = $1`, [id])).number

    expect((await d.query(SCHEMA_CHECK)).rows.length).toBeGreaterThan(0)
    expect((await d.query(ORPHAN_CHECK)).rows).toHaveLength(2)

    const report = await cleanup(d)
    expect(report).toEqual([
      `1. deleted accounts | clinic "Riga Test SIA" (${riga}): created_by emptied; account ${creator} no longer exists`,
      `1. deleted accounts | profile "Wivo check (delete me)" (${throwaway}) deleted: its account no longer exists and nothing hung on it`,
      '1. deleted accounts | foreign key clinics.clinics_created_by_fkey validated',
      '1. deleted accounts | foreign key profiles.profiles_id_fkey validated',
      ...SEVEN.map(fn => expect.stringMatching(new RegExp(`^2\\. grants \\| ${fn.replace(/[().[\]]/g, '\\$&')}: signed-in users can no longer call it directly \\(sql/0[0-9]{2}\\)$`))),
      `3. code prefixes | clinic "Tallinn Two" (${tallinn2}): prefix ${tal} belonged to an older clinic too; now ${tal}2. 1 stand-in login(s) renamed with it (they sign in with the code ${tal.toLowerCase()}2); its job codes so far keep ${tal}`,
      `3. code prefixes | clinic "Riga Test SIA" (${riga}) had no prefix (made while the trigger was missing): now RIG`,
      '3. code prefixes | 1 job(s) with a clinic but no code got their clinic\'s next code',
      '3. code prefixes | unique index clinics_code_prefix_key built',
      `4. invoice totals | draft invoice ${await number(draft)} (${draft}): recounted from its lines, total 0.00 -> 25.62`,
      `4. invoice totals | invoice ${await number(sent)} (${sent}, saadetud) LEFT: its total 0.00 disagrees with its lines (25.62), but it is no longer a draft`,
    ])

    expect((await d.query(SCHEMA_CHECK)).rows).toEqual([])
    expect((await d.query(ORPHAN_CHECK)).rows).toEqual([])
    // The stand-in of the renamed clinic signs in with its new code; Tallinn's keeps its own.
    const email = async (id: string): Promise<string> => (await one<{ email: string }>(d, `select email from auth.users where id = $1`, [id])).email
    expect(await email(anna)).toBe(`anna.${tal.toLowerCase()}2@nomail.wivodent.com`)
    expect(await email(mart)).toBe(`mart.${tal.toLowerCase()}@nomail.wivodent.com`)
    expect((await one<{ job_code: string }>(d, `select job_code from public.jobs where id = $1`, [job.id])).job_code).toMatch(/^RIG-\d{2}-\d{4}$/)
    const gross = async (id: string): Promise<string> => (await one<{ g: string }>(d, `select gross_total::text as g from public.invoices where id = $1`, [id])).g
    expect(await gross(draft)).toBe('25.62')
    expect(await gross(sent)).toBe('0.00')
    expect(await errorAs(d, { id: A.ownerId }, `select public.audit($1, 'x', 'y', '{}')`, [A.clinicId])).toMatch(/permission denied/)

    // Once is enough: a second run changes nothing and names again only what it leaves.
    expect(await cleanup(d)).toEqual([report[report.length - 1]])
  }, 120_000)

  it('a profile that still has work is named and kept, and its key stays NOT VALID', async () => {
    const d = await freshDb()
    const A = await createTenant(d, 'Tallinn')
    const job = await makeRow(d, 'jobs', A)
    await d.query(`update public.jobs set assigned_to = $1 where id = $2`, [A.workerId, job.id])
    await withoutTheKeys(d, async () => {
      await d.query(`delete from auth.users where id = $1`, [A.workerId])
    })
    expect(await cleanup(d)).toEqual([
      `1. deleted accounts | profile "Tallinn worker" (${A.workerId}) LEFT: its account is gone, but it still has 1 job(s), 0 work-hour row(s), 0 rate(s) and 0 payout(s)`,
      '1. deleted accounts | foreign key clinics.clinics_created_by_fkey validated',
      '1. deleted accounts | foreign key profiles.profiles_id_fkey LEFT NOT VALID: a row still points at a missing account (above)',
    ])
    expect((await d.query(`select 1 from public.profiles where id = $1`, [A.workerId])).rows).toHaveLength(1)
  }, 120_000)
})

describe('elsewhere', () => {
  it('on a database with nothing to put right it changes nothing', async () => {
    const d = await freshDb()
    await createTenant(d, 'Tallinn')
    const before = await schema(d)
    expect(await cleanup(d)).toEqual(['- | nothing to do: this database has none of it'])
    expect(await schema(d)).toEqual(before)
  }, 120_000)

  it('refuses a database without sql/107\'s keys (production, until 2.1), changing nothing', async () => {
    const d = await freshDb()
    await d.exec(`alter table public.clinics drop constraint clinics_created_by_fkey;
                  grant execute on function public.audit(uuid, text, text, jsonb) to authenticated;`)
    await expect(cleanup(d)).rejects.toThrow(/Not the test copy/)
    const { rows: [{ may }] } = await d.query<{ may: boolean }>(
      `select has_function_privilege('authenticated', 'public.audit(uuid, text, text, jsonb)', 'execute') as may`)
    expect(may).toBe(true)
  }, 120_000)
})

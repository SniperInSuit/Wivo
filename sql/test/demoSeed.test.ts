/**
 * The demo clinic, run for real.
 *
 * sql/demo/seed.sql and sql/demo/reset.sql are pasted into a demo project's
 * SQL editor by hand, so nothing else would ever catch a wrong column name or
 * a value a check constraint refuses — and finding that out while showing the
 * app to Riga is the one moment it must not happen. PGlite replays every
 * migration and then runs the two files exactly as the editor would.
 *
 * It also checks the guards, which are the only reason these files are safe to
 * have in the repo at all: without the demo marker, with a clinic that is not
 * the demo one, or with a user outside the demo addresses, both files must
 * refuse — the reset file above all, because it deletes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, SQL_DIR } from './harness'

const PASSWORD = 'demo-password-not-a-secret'

const file = (name: string): string => readFileSync(join(SQL_DIR, 'demo', name), 'utf8')

/** The one edit the operator makes before pasting, made here. */
const prepare = (sql: string): string => sql.replaceAll('<DEMO_PASSWORD>', PASSWORD)

const MARKER = `
  create table if not exists public.wivo_demo (one boolean primary key default true);
  insert into public.wivo_demo values (true) on conflict do nothing;
`

async function run(db: PGlite, name: string): Promise<void> {
  await db.exec(prepare(file(name)))
}

/** The error a file raises, or null when it ran. */
async function refusal(db: PGlite, name: string): Promise<string | null> {
  try {
    await run(db, name)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const count = async (db: PGlite, sql: string): Promise<number> =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n)

describe('the demo clinic seeds, as the SQL editor would run it', () => {
  it('fills an empty demo database, and the second run adds nothing', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await run(db, 'seed.sql')

    expect(await count(db, 'public.clinics')).toBe(1)
    expect(await count(db, 'auth.users')).toBe(8)
    expect(await count(db, 'public.jobs')).toBe(5)
    expect(await count(db, 'public.patients')).toBe(3)
    expect(await count(db, 'public.customers')).toBe(2)
    expect(await count(db, 'public.stock_item')).toBe(3)
    expect(await count(db, 'public.stock_movement')).toBe(3)
    expect(await count(db, 'public.worker_rates')).toBe(2)
    // The number docs/DEMO-SETUP.md tells Kevin to expect on screen.
    expect(await count(db, 'public.worker_permissions')).toBe(22)
    expect(await count(db, 'public.work_hours')).toBe(2)

    // Seeding twice is what happens when a paste is repeated. It must not
    // double the clinic or the people — the jobs are the only rows without a
    // fixed id, and reset.sql is the way to start over.
    await run(db, 'seed.sql')
    expect(await count(db, 'public.clinics')).toBe(1)
    expect(await count(db, 'auth.users')).toBe(8)
    expect(await count(db, 'public.patients')).toBe(3)
    await db.close()
  }, 120_000)

  it('the clinic is Latvian and in English — the gate Riga will actually meet', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await run(db, 'seed.sql')
    const { rows } = await db.query<{ country: string; default_language: string; code_prefix: string }>(
      `select country, default_language, code_prefix from public.clinics`)
    expect(rows[0].country).toBe('LV')
    expect(rows[0].default_language).toBe('en')
    expect(rows[0].code_prefix).toBe('BS')
    await db.close()
  }, 120_000)

  it('every Riga role is there, with the permissions that role needs', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await run(db, 'seed.sql')

    const perms = async (email: string): Promise<string[]> => (
      await db.query<{ permission: string }>(
        `select wp.permission from public.worker_permissions wp
           join auth.users u on u.id = wp.profile_id
          where u.email = $1 order by 1`, [email])
    ).rows.map(r => r.permission)

    const { rows: owner } = await db.query<{ role: string; org_role: string }>(
      `select p.role, p.org_role from public.profiles p join auth.users u on u.id = p.id
        where u.email = 'owner@demo.wivodent.com'`)
    expect(owner[0]).toEqual({ role: 'owner', org_role: 'owner' })

    expect(await perms('accountant@demo.wivodent.com')).toEqual(['payments.read', 'payroll.manage'])
    expect(await perms('tech.manual@demo.wivodent.com')).toEqual(['jobs.write', 'stock.read', 'stock.write'])
    expect(await perms('secretary@demo.wivodent.com')).toContain('patients.read')

    // The two conditions that keep patient names away from the people who do
    // not need them (docs/WORKFLOW-STAGES.md §7). A later edit that hands the
    // manager jobs.read, or the accountant patients.read, breaks the promise
    // the demo is there to make — so it breaks here first.
    for (const email of ['manager@demo.wivodent.com', 'accountant@demo.wivodent.com']) {
      expect(await perms(email), email).not.toContain('jobs.read')
      expect(await perms(email), email).not.toContain('patients.read')
    }
    await db.close()
  }, 120_000)

  it('the jobs spread across the stages, and one is delivered and paid', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await run(db, 'seed.sql')
    const { rows } = await db.query<{ status: string }>(
      `select distinct status from public.jobs order by 1`)
    expect(rows.map(r => r.status)).toEqual(['disain', 'poleeri', 'print', 'valmis', 'varvi'])
    expect(await count(db, `public.jobs where makstud and delivery_status = 'yle_antud'`)).toBe(1)
    // Every job has a maker and a designer: the demo has to show pay, and pay
    // comes from those two fields until migration 122 puts it on the stages.
    expect(await count(db, 'public.jobs where assigned_to is null or designed_by is null')).toBe(0)
    await db.close()
  }, 120_000)

  it('the password placeholder is refused, so a demo with nobody in it is impossible', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    // Unreplaced — exactly what a hurried paste leaves behind.
    let message: string | null = null
    try {
      await db.exec(file('seed.sql'))
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/asendamata|12/)
    expect(await count(db, 'public.clinics')).toBe(0)
    await db.close()
  }, 120_000)

  it('no demo marker: both files refuse, and nothing happens', async () => {
    const db = await freshDb()
    expect(await refusal(db, 'seed.sql')).toMatch(/ei ole märgitud demoks/)
    expect(await refusal(db, 'reset.sql')).toMatch(/ei ole märgitud demoks/)
    expect(await count(db, 'public.clinics')).toBe(0)
    await db.close()
  }, 120_000)
})

describe('the guards that make a deleting file safe to keep in the repo', () => {
  it('a clinic that is not the demo one: both files refuse, and it survives', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await db.exec(`insert into public.clinics (name) values ('Päris kliinik')`)

    expect(await refusal(db, 'seed.sql')).toMatch(/ei ole demoandmebaas/)
    expect(await refusal(db, 'reset.sql')).toMatch(/KEELDUN kustutamast/)
    expect(await count(db, `public.clinics where name = 'Päris kliinik'`)).toBe(1)
    await db.close()
  }, 120_000)

  it('a user outside the demo addresses: both refuse, and the user survives', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await db.exec(`insert into auth.users (email) values ('kevin@wivodent.com')`)

    expect(await refusal(db, 'seed.sql')).toMatch(/väljaspool demo-aadresse/)
    expect(await refusal(db, 'reset.sql')).toMatch(/KEELDUN kustutamast/)
    expect(await count(db, `auth.users where email = 'kevin@wivodent.com'`)).toBe(1)
    await db.close()
  }, 120_000)

  it('reset empties the demo and seed fills it again — the whole round trip', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    await run(db, 'seed.sql')
    await run(db, 'reset.sql')

    for (const what of ['public.clinics', 'auth.users', 'public.jobs', 'public.patients',
                        'public.customers', 'public.stock_item', 'public.profiles',
                        'public.worker_permissions', 'public.clinic_settings']) {
      expect(await count(db, what), what).toBe(0)
    }
    // The marker stays: it describes the database, not the data in it.
    expect(await count(db, 'public.wivo_demo')).toBe(1)

    await run(db, 'seed.sql')
    expect(await count(db, 'public.jobs')).toBe(5)
    await db.close()
  }, 180_000)

  it('reset on an empty demo database says so instead of failing', async () => {
    const db = await freshDb()
    await db.exec(MARKER)
    expect(await refusal(db, 'reset.sql')).toBeNull()
    await db.close()
  }, 120_000)
})

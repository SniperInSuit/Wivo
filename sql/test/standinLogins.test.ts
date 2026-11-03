/**
 * sql/099: a stand-in address (an account made without an e-mail) is never
 * mailed, and the existing ones are confirmed once so nobody is locked out.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

const run099 = () => applyMigrations(db, ['099_standin_logins.sql'])

/** An account as GoTrue left it, in A's clinic, with that address and username. */
async function account(email: string, username: string | null, extra: { confirmed?: boolean; deleted?: boolean } = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at, deleted_at, raw_user_meta_data)
     values ($1, case when $2 then now() - interval '1 day' end, case when $3 then now() end, '{"full_name":"X"}')
     returning id`, [email, !!extra.confirmed, !!extra.deleted])
  const id = rows[0].id
  await db.query(`update public.profiles set clinic_id = $1, username = $2 where id = $3`, [A.clinicId, username, id])
  return id
}

const confirmedAt = async (id: string) =>
  (await db.query<{ at: Date | null }>(`select email_confirmed_at as at from auth.users where id = $1`, [id])).rows[0].at

describe('which addresses are stand-ins', () => {
  it('the Wivo domains and every example.com address; nothing else', async () => {
    const { rows } = await db.query<{ e: string; s: boolean }>(`
      select e, public.is_standin_email(e) as s from unnest(array[
        'tehnik.tal@nomail.wivodent.com', 'Tehnik@Example.com', 'x@example.com', 'a@wivo.invalid', 'a@wivo.local',
        'mari@kliinik.ee', 'no-reply@mail.wivodent.com', 'a@example.com.ee', 'a@notexample.com', '', null
      ]) e`)
    expect(Object.fromEntries(rows.map(r => [r.e ?? 'null', r.s]))).toEqual({
      'tehnik.tal@nomail.wivodent.com': true, 'Tehnik@Example.com': true, 'x@example.com': true,
      'a@wivo.invalid': true, 'a@wivo.local': true,
      'mari@kliinik.ee': false, 'no-reply@mail.wivodent.com': false, 'a@example.com.ee': false,
      'a@notexample.com': false, '': false, null: false,
    })
  })
})

describe('no notification e-mail to a stand-in', () => {
  it('is left out of the pending list, while a real address with the same notice is in it', async () => {
    const standin = await account('stand1@example.com', 'stand1', { confirmed: true })
    const newStandin = await account('stand2.tal@nomail.wivodent.com', 'stand2', { confirmed: true })
    const real = await account('real1@kliinik.ee', null, { confirmed: true })
    for (const u of [standin, newStandin, real]) {
      await db.query(`insert into public.notification (org_id, user_id, job_code, kind) values ($1, $2, 'TAL-26-0001', 'question')`,
        [A.clinicId, u])
    }
    const { rows } = await db.query<{ email: string }>(`select email from public.pending_notification_emails(1000)`)
    const emails = rows.map(r => r.email)
    expect(emails).toContain('real1@kliinik.ee')
    expect(emails).not.toContain('stand1@example.com')
    expect(emails).not.toContain('stand2.tal@nomail.wivodent.com')
  })

  it('stays for the service role only', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select * from public.pending_notification_emails()`)).toMatch(/permission denied/)
  })
})

describe('the one-time confirmation', () => {
  it('confirms exactly the Wivo stand-ins and leaves everything else as it was', async () => {
    const tehnik = await account('tehnik9@example.com', 'tehnik9')
    const mixedCase = await account('Mari.K@Example.com', 'mari.k')
    const older = await account('vana@wivo.invalid', 'vana')
    const real = await account('real2@kliinik.ee', null)
    const realWithUsername = await account('someone@kliinik.ee', 'someone')
    const notItsUsername = await account('other@example.com', 'different')
    const noUsername = await account('nobody@example.com', null)
    const deleted = await account('gone@example.com', 'gone', { deleted: true })
    const already = await account('done@example.com', 'done', { confirmed: true })
    const alreadyAt = await confirmedAt(already)

    await run099()

    for (const id of [tehnik, mixedCase, older]) expect(await confirmedAt(id)).not.toBeNull()
    for (const id of [real, realWithUsername, notItsUsername, noUsername, deleted]) expect(await confirmedAt(id)).toBeNull()
    expect(await confirmedAt(already)).toEqual(alreadyAt)
  })

  it('running it again changes nothing', async () => {
    const id = await account('again@example.com', 'again')
    await run099()
    const first = await confirmedAt(id)
    await run099()
    expect(await confirmedAt(id)).toEqual(first)
  })
})

describe('099 on production\'s base (000–091, without 092–098)', () => {
  it('applies', async () => {
    const d = await emptyDb()
    const files = migrationFiles().filter(f => f <= '091' || f.startsWith('099_'))
    expect(files.at(-1)).toMatch(/^099_/)
    await applyMigrations(d, files)
    const { rows } = await d.query<{ s: boolean }>(`select public.is_standin_email('a@example.com') as s`)
    expect(rows[0].s).toBe(true)
  }, 120_000)
})

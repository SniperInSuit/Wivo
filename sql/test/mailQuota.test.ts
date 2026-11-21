/**
 * Resend's sending limit (sql/125): a refused send is in the log, the owner
 * sees it in the bell once a day, and nobody but the service role writes it.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Elsewhere')
}, 120_000)

const hit = async (kind: string, source: string): Promise<number> =>
  (await db.query<{ n: number }>(`select public.record_mail_quota_hit($1, $2) as n`, [kind, source])).rows[0].n

describe('mail quota', () => {
  it('the first hit of the day is logged and tells each owner, once', async () => {
    expect(await hit('daily', 'notifications')).toBeGreaterThanOrEqual(2)
    expect(await hit('daily', 'team_invite')).toBe(0)
    expect(await hit('daily', 'notifications')).toBe(0)

    const { rows } = await db.query<{ refused: number; sources: string[] }>(
      `select refused, sources from public.mail_quota_hit where org_id = $1 and kind = 'daily'`, [A.clinicId])
    expect(rows).toEqual([{ refused: 3, sources: ['notifications', 'team_invite'] }])

    const told = await db.query<{ user_id: string; detail: { limit: string } }>(
      `select user_id, detail from public.notification where kind = 'mail_quota' and org_id = $1`, [A.clinicId])
    expect(told.rows.map(r => r.user_id)).toEqual([A.ownerId])
    expect(told.rows[0].detail.limit).toBe('daily')
  })

  it('the owner reads the log; a worker and another clinic do not', async () => {
    expect(await rowsAs(db, { id: A.ownerId }, `select org_id from public.mail_quota_hit`)).toEqual([{ org_id: A.clinicId }])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.mail_quota_hit`)).toEqual([])
    const seenByB = await rowsAs<{ org_id: string }>(db, { id: B.ownerId }, `select org_id from public.mail_quota_hit`)
    expect(seenByB.every(r => r.org_id === B.clinicId)).toBe(true)
  })

  it('nobody signed in writes the log or records a hit', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.record_mail_quota_hit('daily', 'x')`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select public.record_mail_quota_hit('daily', 'x')`)).toMatch(/permission denied/)
    const ins = await errorAs(db, { id: A.ownerId },
      `insert into public.mail_quota_hit (org_id, day, kind) values ($1, current_date, 'monthly')`, [A.clinicId])
    expect(ins).not.toBeNull()
    expect(await rowsAs(db, { id: A.ownerId }, `update public.mail_quota_hit set refused = 1 returning 1`)).toEqual([])
    expect(await rowsAs(db, { id: A.ownerId }, `delete from public.mail_quota_hit returning 1`)).toEqual([])
  })

  it('an unknown limit is refused', async () => {
    await expect(hit('hourly', 'notifications')).rejects.toThrow(/unknown limit/)
  })

  it('the notice is never e-mailed (it would be refused too), but goes to the phone', async () => {
    const mails = await db.query<{ kind: string }>(`select kind from public.pending_notification_emails(500)`)
    expect(mails.rows.some(r => r.kind === 'mail_quota')).toBe(false)
    const fn = await db.query<{ src: string }>(`select prosrc as src from pg_proc where proname = 'pending_pushes'`)
    expect(fn.rows[0].src).not.toMatch(/mail_quota/)
  })
})

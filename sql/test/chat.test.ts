/**
 * The chat schema (sql/065–067), checked as two tenants and as members and
 * non-members of a channel. The generic isolation test already proves tenant B
 * cannot read or change tenant A's chat rows. This file covers the other
 * direction — pushing rows INTO somebody else's space — and the in-clinic
 * privacy rules. Inventory and findings: docs/night-run/chat-inventory.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, makeRow, rowsAs, errorAs, as, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let chanA: string
let chanB: string
let dmA: string

async function channel(t: Tenant, kind: string, members: string[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.channels (clinic_id, kind, created_by) values ($1, $2, $3) returning id`,
    [t.clinicId, kind, members[0]])
  for (const m of members) {
    await db.query(`insert into public.channel_members (channel_id, profile_id) values ($1, $2)`, [rows[0].id, m])
  }
  return rows[0].id
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  chanA = await channel(A, 'grupp', [A.ownerId, A.workerId])
  chanB = await channel(B, 'grupp', [B.ownerId])
  const third = await createUser(db, 'Tallinn designer')
  await db.query(`update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, third])
  dmA = await channel(A, 'otse', [A.ownerId, third])
}, 120_000)

describe('members can use the chat', () => {
  it('a member posts and reads in their channel', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'Hello')`, [chanA, A.workerId])).toBeNull()
    expect((await rowsAs(db, { id: A.ownerId }, `select 1 from public.messages where channel_id = $1`, [chanA])).length).toBeGreaterThan(0)
  })

  it('a member marks the channel read', async () => {
    const r = await rowsAs(db, { id: A.workerId },
      `update public.channel_members set last_read_at = now() where channel_id = $1 and profile_id = $2 returning 1`, [chanA, A.workerId])
    expect(r).toHaveLength(1)
  })

  it('a member can tag a job of their own clinic that they can see', async () => {
    // The owner: a worker with no `jobs.read` cannot see the job, and a tag on a
    // job you cannot see is refused on purpose.
    const job = await makeRow(db, 'jobs', A)
    const [m] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'See job') returning id`, [chanA, A.ownerId])
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.message_jobs (message_id, job_id) values ($1, $2)`, [m.id, job.id])).toBeNull()
  })
})

describe('nothing can be pushed into another tenant', () => {
  it('a member cannot repoint their membership at another clinic\'s channel', async () => {
    await errorAs(db, { id: A.workerId },
      `update public.channel_members set channel_id = $1 where channel_id = $2 and profile_id = $3`, [chanB, chanA, A.workerId])
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.messages where channel_id = $1`, [chanB])).toEqual([])
    const { rows } = await db.query(`select 1 from public.channel_members where channel_id = $1 and profile_id = $2`, [chanB, A.workerId])
    expect(rows).toEqual([])
  })

  it('an author cannot move their message into another clinic\'s channel', async () => {
    const [m] = await rowsAs<{ id: string }>(db, { id: A.workerId },
      `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'Mine') returning id`, [chanA, A.workerId])
    await errorAs(db, { id: A.workerId }, `update public.messages set channel_id = $1 where id = $2`, [chanB, m.id])
    const { rows } = await db.query<{ channel_id: string }>(`select channel_id from public.messages where id = $1`, [m.id])
    expect(rows[0].channel_id).toBe(chanA)
  })

  it('a member cannot add a user of another clinic to their channel', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.channel_members (channel_id, profile_id) values ($1, $2)`, [chanA, B.workerId])).not.toBeNull()
  })

  it('nobody can open a channel for another clinic\'s job (and so block theirs)', async () => {
    const jobB = await makeRow(db, 'jobs', B)
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.channels (clinic_id, kind, job_id, created_by) values ($1, 'too', $2, $3)`,
      [A.clinicId, jobB.id, A.ownerId])).not.toBeNull()
  })

  it('nobody can tag another clinic\'s job in a message', async () => {
    const jobB = await makeRow(db, 'jobs', B)
    const [m] = await rowsAs<{ id: string }>(db, { id: A.workerId },
      `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'x') returning id`, [chanA, A.workerId])
    expect(await errorAs(db, { id: A.workerId },
      `insert into public.message_jobs (message_id, job_id) values ($1, $2)`, [m.id, jobB.id])).not.toBeNull()
  })
})

describe('in-clinic privacy', () => {
  it('a colleague cannot add themselves to somebody else\'s direct messages', async () => {
    expect(await errorAs(db, { id: A.workerId },
      `insert into public.channel_members (channel_id, profile_id) values ($1, $2)`, [dmA, A.workerId])).not.toBeNull()
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.messages where channel_id = $1`, [dmA])).toEqual([])
  })

  it('a member cannot promote their own membership role', async () => {
    await db.query(`update public.channel_members set role = 'vaatleja' where channel_id = $1 and profile_id = $2`, [chanA, A.workerId])
    await errorAs(db, { id: A.workerId },
      `update public.channel_members set role = 'liige' where channel_id = $1 and profile_id = $2`, [chanA, A.workerId])
    const { rows } = await db.query<{ role: string }>(
      `select role from public.channel_members where channel_id = $1 and profile_id = $2`, [chanA, A.workerId])
    expect(rows[0].role).toBe('vaatleja')
    await db.query(`update public.channel_members set role = 'liige' where channel_id = $1 and profile_id = $2`, [chanA, A.workerId])
  })

  it('an observer (vaatleja) reads but cannot post', async () => {
    const watcher = await createUser(db, 'Observer')
    await db.query(`update public.profiles set clinic_id = $1 where id = $2`, [A.clinicId, watcher])
    await db.query(`insert into public.channel_members (channel_id, profile_id, role) values ($1, $2, 'vaatleja')`, [chanA, watcher])
    expect((await rowsAs(db, { id: watcher }, `select 1 from public.messages where channel_id = $1`, [chanA])).length).toBeGreaterThan(0)
    expect(await errorAs(db, { id: watcher },
      `insert into public.messages (channel_id, author_id, body) values ($1, $2, 'hi')`, [chanA, watcher])).not.toBeNull()
  })

  it('the creator can read back the channel they just made (before adding members)', async () => {
    const r = await as(db, { id: A.ownerId }, async () => (await db.query(
      `insert into public.channels (clinic_id, kind, created_by) values ($1, 'grupp', $2) returning id`, [A.clinicId, A.ownerId])).rows)
    expect(r).toHaveLength(1)
  })
})

/**
 * sql/104: below the minimum app version, or without one, a signed-in user's
 * SAVES are refused with HTTP 426; reads go on; nothing changes while no
 * minimum is set. A guard against old builds, not a security control (the
 * version is a header) — so it must never let through what RLS would not.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, as, makeRow, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
}, 120_000)

afterEach(async () => { await db.query(`delete from public.app_min_version`) })

const setMin = (v: string, org: string | null = null, required = false) =>
  db.query(`select public.set_app_min_version($1, $2, 'test', $3)`, [v, required, org])

/**
 * What PostgREST does before a request: role and claims, the request's
 * method, path and headers, then the pre-request function. null = let through.
 */
async function request(actor: Actor, method: string, path: string, version?: string | null): Promise<{ code: string; message: string; detail?: string; hint?: string } | null> {
  const headers = JSON.stringify(version === undefined || version === null ? {} : { 'x-wivo-version': version })
  try {
    await as(db, actor, async () => {
      await db.query(`select set_config('request.method', $1, false), set_config('request.path', $2, false), set_config('request.headers', $3, false)`,
        [method, path, headers])
      await db.query(`select public.pre_request()`)
    })
    return null
  } catch (e) {
    const err = e as { code: string; message: string; detail?: string; hint?: string }
    return { code: err.code, message: err.message, detail: err.detail, hint: err.hint }
  }
}

const owner = (): Actor => ({ id: A.ownerId })

describe('versions compare as numbers', () => {
  it('2.0.10 is above 2.0.9; 2.1 is 2.1.0; missing or junk is below', async () => {
    const below = async (v: string | null, m: string) =>
      (await db.query<{ b: boolean }>(`select public.version_below($1, $2) as b`, [v, m])).rows[0].b
    expect(await below('2.0.10', '2.0.9')).toBe(false)
    expect(await below('2.0.9', '2.0.10')).toBe(true)
    expect(await below('2.1', '2.1.0')).toBe(false)
    expect(await below('2.1.0', '2.1.0')).toBe(false)
    expect(await below('2.0.3', '2.1.0')).toBe(true)
    expect(await below('10.0.0', '9.9.9')).toBe(false)
    expect(await below(null, '2.1.0')).toBe(true)
    expect(await below('dev', '2.1.0')).toBe(true)
    expect(await below('2.1.0-beta', '2.1.0')).toBe(false)
  })
})

describe('no minimum set: nothing changes', () => {
  it('an empty table lets every save through, with or without a version', async () => {
    expect(await request(owner(), 'POST', '/jobs', null)).toBeNull()
    expect(await request(owner(), 'PATCH', '/jobs', '1.0.0')).toBeNull()
  })
})

describe('with a minimum', () => {
  it('a save from an older build, or one without a version, is refused with 426 and a clear message', async () => {
    await setMin('2.1.0')
    for (const [method, path, version] of [['POST', '/jobs', '2.0.3'], ['PATCH', '/jobs', '2.0.9'], ['DELETE', '/jobs', null],
                                            ['PUT', '/customers', '2.0.3'], ['POST', '/rpc/move_job_stage', '2.0.3']] as const) {
      const r = await request(owner(), method, path, version)
      expect(r, `${method} ${path}`).toMatchObject({ code: 'PT426', hint: 'update_required', detail: '2.1.0' })
      expect(r!.message).toMatch(/^Update Wivo/)
    }
  })

  it('the same saves from a new enough build go through', async () => {
    await setMin('2.1.0')
    for (const v of ['2.1.0', '2.1.3', '2.10.0', '3.0.0']) {
      expect(await request(owner(), 'POST', '/jobs', v), v).toBeNull()
      expect(await request(owner(), 'POST', '/rpc/move_job_stage', v), v).toBeNull()
    }
  })

  it('reads go through for an old build: GET, and calls to functions that only read', async () => {
    await setMin('2.1.0')
    expect(await request(owner(), 'GET', '/jobs', '2.0.3')).toBeNull()
    expect(await request(owner(), 'HEAD', '/jobs', null)).toBeNull()
    for (const fn of ['job_files', 'team_accounts', 'deleted_jobs', 'has_mfa', 'app_min_version_for_me', 'clinic_settings_private']) {
      expect(await request(owner(), 'POST', `/rpc/${fn}`, '2.0.3'), fn).toBeNull()
    }
  })

  it('an old phone may still keep its notifications (the exempt list)', async () => {
    await setMin('2.1.0')
    expect(await request(owner(), 'POST', '/rpc/save_push_subscription', '2.0.3')).toBeNull()
  })

  it('anonymous and service-role requests are never checked', async () => {
    await setMin('2.1.0')
    expect(await request('anon', 'POST', '/rpc/anything', null)).toBeNull()
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false), set_config('request.method', 'POST', false),
                    set_config('request.path', '/jobs', false), set_config('request.headers', '{}', false)`)
    await expect(db.query(`select public.pre_request()`)).resolves.toBeTruthy()
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  })

  it('the second factor is still checked first: without it, refused for that, whatever the version', async () => {
    await setMin('2.1.0')
    const r = await request({ id: A.ownerId, mfa: false }, 'POST', '/jobs', '9.9.9')
    expect(r?.message).toMatch(/second factor first/)
  })

  it('an organisation\'s own row is used over the global one, for that organisation only', async () => {
    await setMin('2.0.0')
    await setMin('2.2.0', A.clinicId)
    expect(await request(owner(), 'POST', '/jobs', '2.1.0')).toMatchObject({ code: 'PT426', detail: '2.2.0' })
    expect(await request({ id: B.ownerId }, 'POST', '/jobs', '2.1.0')).toBeNull()
  })

  it('clearing the minimum switches it off at once', async () => {
    await setMin('2.1.0')
    expect(await request(owner(), 'POST', '/jobs', '2.0.3')).not.toBeNull()
    await db.query(`select public.clear_app_min_version()`)
    expect(await request(owner(), 'POST', '/jobs', '2.0.3')).toBeNull()
  })
})

describe('the setting itself', () => {
  it('members read what applies to them; nobody else\'s organisation row', async () => {
    await setMin('2.1.0', null, true)
    await setMin('2.3.0', B.clinicId)
    expect(await rowsAs(db, owner(), `select * from public.app_min_version_for_me()`)).toEqual([{ min_version: '2.1.0', required: true }])
    expect(await rowsAs(db, { id: B.workerId }, `select * from public.app_min_version_for_me()`)).toEqual([{ min_version: '2.3.0', required: false }])
    const seen = await rowsAs<{ org_id: string | null }>(db, owner(), `select org_id from public.app_min_version`)
    expect(seen.map(r => r.org_id)).toEqual([null])
  })

  it('no member can change it, nor call the setters; only the SQL Editor (database owner)', async () => {
    await setMin('2.1.0')
    expect(await errorAs(db, owner(), `insert into public.app_min_version (min_version) values ('0.0.1')`)).toMatch(/row-level security/)
    expect(await rowsAs(db, owner(), `update public.app_min_version set min_version = '0.0.1' returning 1`)).toEqual([])
    expect(await rowsAs(db, owner(), `delete from public.app_min_version returning 1`)).toEqual([])
    for (const fn of [`public.set_app_min_version('0.0.1')`, `public.clear_app_min_version()`, `public.app_min_version_of(null)`]) {
      expect(await errorAs(db, owner(), `select ${fn}`), fn).toMatch(/permission denied/)
    }
  })

  it('refuses something that is not a version; one global row and one per organisation', async () => {
    await expect(db.query(`select public.set_app_min_version('latest')`)).rejects.toThrow(/three numbers/)
    await setMin('2.1.0')
    await setMin('2.2.0')
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.app_min_version where org_id is null`)
    expect(rows[0].n).toBe(1)
  })

  it('carries the second-factor policy like every table', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from pg_policy
      where polrelid = 'public.app_min_version'::regclass and not polpermissive and polname = 'mfa_required'`)
    expect(rows[0].n).toBe(1)
  })
})

describe('the check script\'s probe', () => {
  it('only the service role may call it; it echoes the header and can answer as a refusal', async () => {
    expect(await errorAs(db, owner(), `select public.app_version_probe()`)).toMatch(/permission denied/)
    await db.query(`select set_config('request.headers', '{"x-wivo-version":"2.1.0"}', false)`)
    expect((await db.query<{ v: string }>(`select public.app_version_probe() as v`)).rows[0].v).toBe('2.1.0')
    await expect(db.query(`select public.app_version_probe(true)`)).rejects.toMatchObject({ code: 'PT426' })
    await db.query(`select set_config('request.headers', '', false)`)
  })
})

describe('what it never does', () => {
  it('a new enough version opens nothing RLS keeps shut', async () => {
    await setMin('2.1.0')
    const job = await makeRow(db, 'jobs', A)
    expect(await request({ id: B.ownerId }, 'PATCH', '/jobs', '9.9.9')).toBeNull()
    expect(await rowsAs(db, { id: B.ownerId }, `update public.jobs set patsient = 'X' where id = $1 returning 1`, [job.id])).toEqual([])
  })
})

/**
 * Job files (sql/072): rows and Storage objects under the same rules.
 * Spec: partner uploads only print/design, cannot delete, only add a new
 * version; downloads go through an RPC that writes an audit row; nothing is
 * really deleted. The Storage side is checked against `storage.objects` with
 * its policies, as a real authenticated user — what Storage itself does.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, as, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant  // owner of the job
let B: Tenant  // partner
let C: Tenant  // stranger
let jobId: string
const SHA = 'a'.repeat(64)

interface FileRow { id: string; storage_path: string; version: number; file_name: string }

const register = (actor: { id: string }, type: string, supersedes: string | null = null) =>
  rowsAs<FileRow>(db, actor,
    `select * from public.register_job_file($1, $2, $3, 1000, 'model/stl', 'stl', $4)`, [jobId, type, SHA, supersedes])
    .then(r => r[0])

/** What Storage does on upload: insert the object row as the user, under RLS. */
const upload = (actor: { id: string }, path: string) =>
  errorAs(db, actor, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [path, (actor as { id: string }).id])

const canSeeObject = (actor: { id: string }, path: string) =>
  rowsAs(db, actor, `select 1 from storage.objects where bucket_id = 'job-files' and name = $1`, [path]).then(r => r.length > 0)

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  C = await createTenant(db, 'Cesis')
  const { rows } = await db.query<{ id: string }>(
    `insert into public.partnership (org_a, org_b, status, roles) values ($1, $2, 'active', array['design']) returning id`,
    [A.clinicId, B.clinicId])
  const job = await makeRow(db, 'jobs', A)
  jobId = job.id as string
  await db.query(
    `insert into public.job_share (job_id, owner_org, partner_org, partnership_id, assigned_stages) values ($1, $2, $3, $4, array['disain'])`,
    [jobId, A.clinicId, B.clinicId, rows[0].id])
}, 120_000)

describe('uploading', () => {
  it('the owner registers, uploads to exactly that path, confirms', async () => {
    const f = await register({ id: A.ownerId }, 'scan')
    expect(f.storage_path).toBe(`${A.clinicId}/${jobId}/${f.id}`)
    expect(f.file_name).toMatch(/^[A-Z]+\d*-\d{2}-\d{4}_scan_v1\.stl$/)
    expect(await upload({ id: A.ownerId }, f.storage_path)).toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])).toBeNull()
  })

  it('nothing can be written to a path nobody registered', async () => {
    expect(await upload({ id: A.ownerId }, `${A.clinicId}/${jobId}/made-up`)).not.toBeNull()
  })

  it('a finished file cannot be overwritten', async () => {
    const f = await register({ id: A.ownerId }, 'photo')
    await upload({ id: A.ownerId }, f.storage_path)
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])
    expect(await errorAs(db, { id: A.ownerId },
      `update storage.objects set metadata = '{}' where name = $1 returning 1`, [f.storage_path]).then(async e => e ?? (await canSeeObject({ id: A.ownerId }, f.storage_path) ? 'visible' : null))).toBeNull()
    const { rows } = await db.query(`select 1 from storage.objects where name = $1`, [f.storage_path])
    expect(rows).toHaveLength(1)
  })

  it('confirming before the bytes are there is refused', async () => {
    const f = await register({ id: A.ownerId }, 'xray')
    expect(await errorAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])).toMatch(/not finished/)
  })
})

describe('partner uploads', () => {
  it('print and design: yes', async () => {
    for (const type of ['print', 'design']) {
      const f = await register({ id: B.workerId }, type)
      expect(await upload({ id: B.workerId }, f.storage_path)).toBeNull()
    }
  })

  it('scans, photos, x-rays: no', async () => {
    for (const type of ['scan', 'photo', 'xray', 'other']) {
      expect(await errorAs(db, { id: B.workerId },
        `select public.register_job_file($1, $2, $3, 1, null, 'png')`, [jobId, type, SHA])).toMatch(/Not allowed/)
    }
  })

  it('a partner cannot delete, but can add a new version', async () => {
    const f = await register({ id: B.workerId }, 'design')
    expect(await errorAs(db, { id: B.workerId }, `select public.delete_job_file($1)`, [f.id])).toMatch(/Not allowed/)
    const v2 = await register({ id: B.workerId }, 'design', f.id)
    expect(v2.version).toBe(2)
  })

  it('a stranger can do nothing', async () => {
    expect(await errorAs(db, { id: C.ownerId },
      `select public.register_job_file($1, 'print', $2, 1, null, 'stl')`, [jobId, SHA])).toMatch(/Not allowed/)
    expect(await errorAs(db, { id: C.ownerId }, `select * from public.job_files($1)`, [jobId])).not.toBeNull()
  })
})

describe('versions and soft delete', () => {
  it('a new version replaces the old one as active; the old one stays', async () => {
    const v1 = await register({ id: A.ownerId }, 'print')
    await upload({ id: A.ownerId }, v1.storage_path)
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [v1.id])
    const v2 = await register({ id: A.ownerId }, 'print', v1.id)
    await upload({ id: A.ownerId }, v2.storage_path)
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [v2.id])
    const { rows } = await db.query<{ id: string; is_active: boolean }>(
      `select id, is_active from public.job_file where id in ($1, $2)`, [v1.id, v2.id])
    expect(rows.find(r => r.id === v1.id)?.is_active).toBe(false)
    expect(rows.find(r => r.id === v2.id)?.is_active).toBe(true)
  })

  it('a version must keep the type', async () => {
    const f = await register({ id: A.ownerId }, 'scan')
    expect(await errorAs(db, { id: A.ownerId },
      `select public.register_job_file($1, 'photo', $2, 1, null, 'jpg', $3)`, [jobId, SHA, f.id])).toMatch(/same type/)
  })

  it('the owner deletes softly: gone from the list, row and object still there', async () => {
    const f = await register({ id: A.ownerId }, 'other')
    await upload({ id: A.ownerId }, f.storage_path)
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_job_file($1)`, [f.id])).toBeNull()
    const listed = await rowsAs<{ id: string }>(db, { id: A.ownerId }, `select id from public.job_files($1)`, [jobId])
    expect(listed.map(r => r.id)).not.toContain(f.id)
    const { rows } = await db.query(`select 1 from public.job_file where id = $1 and deleted_at is not null`, [f.id])
    expect(rows).toHaveLength(1)
    expect((await db.query(`select 1 from storage.objects where name = $1`, [f.storage_path])).rows).toHaveLength(1)
  })

  it('nobody deletes a stored object through the API', async () => {
    const { rows } = await db.query<{ name: string }>(`select name from storage.objects limit 1`)
    await errorAs(db, { id: A.ownerId }, `delete from storage.objects where name = $1`, [rows[0].name])
    expect((await db.query(`select 1 from storage.objects where name = $1`, [rows[0].name])).rows).toHaveLength(1)
  })
})

describe('downloading', () => {
  let file: FileRow

  beforeAll(async () => {
    file = await register({ id: A.ownerId }, 'scan')
    await upload({ id: A.ownerId }, file.storage_path)
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [file.id])
  })

  it('nobody can read an object without asking through the RPC first — not even its owner', async () => {
    expect(await canSeeObject({ id: A.ownerId }, file.storage_path)).toBe(false)
  })

  it('the RPC writes the audit row and opens a two-minute window', async () => {
    await rowsAs(db, { id: B.workerId }, `select public.request_file_download($1)`, [file.id])
    expect(await canSeeObject({ id: B.workerId }, file.storage_path)).toBe(true)
    expect(await canSeeObject({ id: C.ownerId }, file.storage_path)).toBe(false)
    for (const org of [A.clinicId, B.clinicId]) {
      const { rows } = await db.query(`select 1 from public.audit_log where org_id = $1 and action = 'download' and object = $2`, [org, 'file:' + file.id])
      expect(rows).toHaveLength(1)
    }
    await db.query(`update public.file_download_grant set expires_at = now() - interval '1 second'`)
    expect(await canSeeObject({ id: B.workerId }, file.storage_path)).toBe(false)
  })

  it('a stranger cannot get a grant', async () => {
    expect(await errorAs(db, { id: C.ownerId }, `select public.request_file_download($1)`, [file.id])).toMatch(/not found/)
  })

  it('both sides list the same files; the partner sees who uploaded, by organisation', async () => {
    const a = await rowsAs<{ id: string }>(db, { id: A.ownerId }, `select id from public.job_files($1)`, [jobId])
    const b = await rowsAs<{ id: string; uploaded_by_org_name: string }>(db, { id: B.workerId }, `select * from public.job_files($1)`, [jobId])
    expect(b.map(r => r.id).sort()).toEqual(a.map(r => r.id).sort())
    expect(b.some(r => r.uploaded_by_org_name === 'Riga')).toBe(true)
  })
})

describe('anon', () => {
  it('gets nothing', async () => {
    expect(await rowsAs(db, 'anon', `select 1 from storage.objects where bucket_id = 'job-files'`).catch(() => [])).toEqual([])
    expect(await as(db, 'anon', () => db.query(`select public.request_file_download(gen_random_uuid())`)).then(() => 'ok', () => 'refused')).toBe('refused')
  })
})

describe('previews (sql/073)', () => {
  it('the uploader stores a preview next to the file; readers get it with a grant and one audit row', async () => {
    const f = await register({ id: A.ownerId }, 'scan')
    await upload({ id: A.ownerId }, f.storage_path)
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])
    const [{ path }] = await rowsAs<{ path: string }>(db, { id: A.ownerId }, `select public.set_job_file_preview($1) as path`, [f.id])
    expect(path).toBe(f.storage_path + '.preview.png')
    expect(await upload({ id: A.ownerId }, path)).toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `select public.confirm_job_file_preview($1)`, [f.id])).toBeNull()

    expect(await canSeeObject({ id: B.workerId }, path)).toBe(false)
    const previews = await rowsAs<{ file_id: string }>(db, { id: B.workerId }, `select * from public.request_job_previews($1)`, [jobId])
    expect(previews.map(p => p.file_id)).toContain(f.id)
    expect(await canSeeObject({ id: B.workerId }, path)).toBe(true)
  })

  it('someone else cannot put a preview on your file, and a stranger gets none', async () => {
    const f = await register({ id: A.ownerId }, 'photo')
    expect(await errorAs(db, { id: B.workerId }, `select public.set_job_file_preview($1)`, [f.id])).toMatch(/not found/)
    expect(await upload({ id: B.workerId }, f.storage_path + '.preview.png')).not.toBeNull()
    expect(await errorAs(db, { id: C.ownerId }, `select * from public.request_job_previews($1)`, [jobId])).toMatch(/not found/)
  })
})

describe('export for the patient (sql/074)', () => {
  it('lists the patient\'s live files, grants them, and logs one export row', async () => {
    const { rows: [p] } = await db.query<{ id: string }>(`insert into public.patients (clinic_id, nimi) values ($1, 'Export Person') returning id`, [A.clinicId])
    await db.query(`update public.jobs set patient_id = $1 where id = $2`, [p.id, jobId])
    const files = await rowsAs<{ storage_path: string }>(db, { id: A.ownerId }, `select * from public.patient_export($1)`, [p.id])
    expect(files.length).toBeGreaterThan(0)
    expect(await canSeeObject({ id: A.ownerId }, files[0].storage_path)).toBe(true)
    const { rows } = await db.query<{ detail: { files: number } }>(
      `select detail from public.audit_log where action = 'export' and object = $1`, ['patient:' + p.id])
    expect(rows).toEqual([{ detail: { files: files.length } }])
  })

  it('another clinic cannot export someone else\'s patient', async () => {
    const { rows: [p] } = await db.query<{ id: string }>(`insert into public.patients (clinic_id, nimi) values ($1, 'Private') returning id`, [A.clinicId])
    expect(await errorAs(db, { id: B.ownerId }, `select * from public.patient_export($1)`, [p.id])).toMatch(/not found/)
  })
})

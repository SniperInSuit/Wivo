/**
 * sql/114 (docs/AUDIT.md): the audit log records edits to jobs, work items,
 * remakes, the patient's tooth chart and patients, permission changes and
 * file deletion. One entry per save, none when nothing changed; a job by its
 * code, a patient by id; free text and patient details only as "changed".
 * And the log is append-only for everyone, owners and the service key too.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, as, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

interface Entry { org_id: string; user_id: string | null; action: string; object: string; detail: Record<string, any> }

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Pärnu')
  await grant(db, A, A.workerId, ['jobs.read', 'jobs.write'])
}, 120_000)

const lastId = async () => (await db.query<{ n: string }>(`select coalesce(max(id), 0)::text as n from public.audit_log`)).rows[0].n
const since = async (mark: string) => (await db.query<Entry>(
  `select org_id, user_id, action, object, detail from public.audit_log where id > $1 order by id`, [mark])).rows

/** What one save, as `actor`, wrote to the log. */
async function saved(actor: string, sql: string, params: unknown[] = []): Promise<Entry[]> {
  const mark = await lastId()
  await as(db, { id: actor }, () => db.query(sql, params))
  return since(mark)
}

async function newJob(fields: Record<string, unknown> = {}): Promise<{ id: string; code: string }> {
  const cols = ['clinic_id', 'patsient', 'status', ...Object.keys(fields)]
  const vals = [A.clinicId, 'Mari Maasikas', 'disain', ...Object.values(fields).map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v)]
  const [row] = await rowsAs<{ id: string; job_code: string }>(db, { id: A.ownerId },
    `insert into public.jobs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, job_code`, vals)
  return { id: row.id, code: row.job_code }
}

const editJob = (id: string, set: string, params: unknown[] = [], actor = A.ownerId) =>
  saved(actor, `update public.jobs set ${set}, updated_at = now() where id = $1`, [id, ...params])

describe('the rules name every column', () => {
  it('jobs, patients and the tooth chart: each column has a rule, and each rule a column', async () => {
    const { rows } = await db.query<{ tbl: string; col: string; has_rule: boolean; has_col: boolean }>(`
      with cols as (select table_name::text as tbl, column_name::text as col from information_schema.columns
                     where table_schema = 'public' and table_name in ('jobs', 'patients', 'patient_teeth')),
           rules as (select tbl, col from public.audit_field_rules() where tbl in ('jobs', 'patients', 'patient_teeth'))
      select coalesce(c.tbl, r.tbl) as tbl, coalesce(c.col, r.col) as col, r.col is not null as has_rule, c.col is not null as has_col
        from cols c full join rules r on r.tbl = c.tbl and r.col = c.col
       where r.col is null or c.col is null`)
    // A new column needs a decision in audit_field_rules (sql/114): old → new, "changed", or skip.
    expect(rows).toEqual([])
  })
})

describe('the log is append-only for everyone', () => {
  let entry: string
  beforeAll(async () => {
    const j = await newJob()
    entry = (await db.query<{ id: string }>(`select id::text from public.audit_log where object = $1`, [`job:${j.id}`])).rows[0].id
  })

  it('an owner, through the API: no insert, update, delete', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `update public.audit_log set object = 'x' where id = $1`, [entry])).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.ownerId }, `delete from public.audit_log where id = $1`, [entry])).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.audit_log (org_id, action, object) values ($1, 'view', 'job:x')`, [A.clinicId])).toMatch(/permission denied/)
  })

  it('the service key and anon: the same, and no truncate', async () => {
    for (const role of ['service_role', 'anon']) {
      await db.exec(`set role ${role}`)
      try {
        for (const sql of [`update public.audit_log set object = 'x' where id = ${entry}`,
                           `delete from public.audit_log where id = ${entry}`,
                           `truncate public.audit_log`]) {
          await expect(db.exec(sql)).rejects.toThrow(/permission denied/)
        }
      } finally {
        await db.exec('reset role')
      }
    }
  })

  it('the SQL Editor: refused too', async () => {
    await expect(db.exec(`update public.audit_log set object = 'x' where id = ${entry}`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`delete from public.audit_log where id = ${entry}`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`truncate public.audit_log`)).rejects.toThrow(/append-only/)
    expect((await db.query(`select 1 from public.audit_log where id = $1 and object like 'job:%'`, [entry])).rows).toHaveLength(1)
  })

  it('only the database itself: a deleted account keeps its entries without a name; a deleted clinic takes its own', async () => {
    const C = await createTenant(db, 'Tartu')
    const [p] = await rowsAs<{ id: string }>(db, { id: C.ownerId },
      `insert into public.patients (clinic_id, nimi) values ($1, 'X') returning id`, [C.clinicId])
    await db.query(`delete from auth.users where id = $1`, [C.ownerId])
    const left = await db.query<{ user_id: string | null }>(`select user_id from public.audit_log where object = $1`, [`patient:${p.id}`])
    expect(left.rows).toEqual([{ user_id: null }])

    const { rows: [d] } = await db.query<{ id: string }>(`insert into public.clinics (name) values ('Viljandi') returning id`)
    await db.query(`select public.audit($1, 'view', 'job:x')`, [d.id])
    await db.query(`delete from public.clinics where id = $1`, [d.id])
    expect((await db.query(`select 1 from public.audit_log where org_id = $1`, [d.id])).rows).toEqual([])
  })
})

describe('a job', () => {
  it('created: one entry, by its code', async () => {
    const mark = await lastId()
    const j = await newJob()
    expect(await since(mark)).toEqual([
      { org_id: A.clinicId, user_id: A.ownerId, action: 'create', object: `job:${j.id}`, detail: { job_code: j.code } },
    ])
  })

  it('teeth, material and description in one save: one entry, old → new, the text only "changed"', async () => {
    const j = await newJob({ hambad: '11,21', materjal: 'Zirkoon', kirjeldus: 'Vana kirjeldus' })
    const e = await editJob(j.id, `hambad = '21,11,22', materjal = 'E.max', kirjeldus = 'Patsient Mari Maasikas soovib heledamat'`)
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ action: 'edit', object: `job:${j.id}`, user_id: A.ownerId })
    expect(e[0].detail).toEqual({
      job_code: j.code,
      changes: {
        hambad: { old: '11,21', new: '11,21,22' },
        materjal: { old: 'Zirkoon', new: 'E.max' },
        kirjeldus: 'changed',
      },
    })
  })

  it('saved with nothing changed: no entry (teeth reordered, an empty text, an unticked box, 100 as 100.00)', async () => {
    const j = await newJob({ hambad: '11,21', varv: 'A2', kiirtoo: false, hind: 100 })
    expect(await editJob(j.id, `hambad = '21, 11', varv = ' A2 ', kiirtoo = false, hind = 100.00, too = ''`)).toEqual([])
    expect(await editJob(j.id, `status = status`)).toEqual([])
  })

  it('the patient\'s name on the job, notes and typed ids: only "changed", never the text', async () => {
    const j = await newJob()
    const e = await editJob(j.id,
      `patsient = 'Jaan Tamm', customer_ref = 'Tamm 2', print_id = 'PR-1', markused = '[{"id":"n1","tekst":"Jaan helistas"}]'`)
    expect(e[0].detail.changes).toEqual({ patsient: 'changed', customer_ref: 'changed', print_id: 'changed', markused: 'added' })
    expect(JSON.stringify(e[0].detail)).not.toMatch(/Jaan|Tamm|PR-1|helistas/)
  })

  it('who does it, the price and paid: old → new', async () => {
    const j = await newJob({ hind: 100, makstud: false })
    const e = await editJob(j.id, `assigned_to = $2, designed_by = $3, hind = 120, makstud = true`, [A.workerId, A.ownerId])
    expect(e[0].detail.changes).toEqual({
      assigned_to: { old: null, new: A.workerId },
      designed_by: { old: null, new: A.ownerId },
      hind: { old: '100', new: '120' },
      makstud: { old: 'false', new: 'true' },
    })
  })

  it('a technician\'s save is theirs', async () => {
    const j = await newJob()
    const e = await editJob(j.id, `varv = 'A3'`, [], A.workerId)
    expect(e).toMatchObject([{ action: 'edit', user_id: A.workerId, detail: { changes: { varv: { old: null, new: 'A3' } } } }])
  })

  it('work items: added, changed and removed, each named by its work type and teeth', async () => {
    const crown = { id: 'w1', too: 'Kroon', hambad: '11,21', materjal: 'Zirkoon' }
    const j = await newJob({ work_items: [crown] })
    let e = await editJob(j.id, `work_items = $2`, [JSON.stringify([crown, { id: 'w2', too: 'Kroon', hambad: '22' }])])
    expect(e[0].detail.work_items).toEqual([{ item: 'Kroon 22', change: 'added' }])

    e = await editJob(j.id, `work_items = $2`, [JSON.stringify([
      { ...crown, materjal: 'E.max', note: 'Mari Maasikas: heledam', designed_by: null }, { id: 'w2', too: 'Kroon', hambad: '22' }])])
    expect(e[0].detail.work_items).toEqual([{ item: 'Kroon 11,21', changes: {
      materjal: { old: 'Zirkoon', new: 'E.max' }, note: 'changed', designed_by: { old: 'job', new: null } } }])
    expect(JSON.stringify(e[0].detail)).not.toMatch(/Maasikas|heledam/)

    e = await editJob(j.id, `work_items = $2`, [JSON.stringify([{ id: 'w2', too: 'Kroon', hambad: '22' }])])
    expect(e[0].detail.work_items).toEqual([{ item: 'Kroon 11,21', change: 'removed' }])
  })
})

describe('a job\'s stage', () => {
  it('alone, on the board: a stage move as before, no edit (with the finished date it stamps)', async () => {
    const j = await newJob()
    const e = await editJob(j.id, `status = 'print', valmis_kuupaev = current_date`)
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'stage_move', object: `job:${j.id}`,
                         detail: { from: 'disain', to: 'print' } }])
  })

  it('in the same save as other changes: one edit entry with the stage; "stage move" search finds it', async () => {
    const j = await newJob({ hambad: '11' })
    const e = await editJob(j.id, `status = 'print', hambad = '11,12'`)
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ action: 'edit', detail: { changes: {
      status: { old: 'disain', new: 'print' }, hambad: { old: '11', new: '11,12' } } } })
    const found = await rowsAs<{ object: string }>(db, { id: A.ownerId },
      `select object from public.audit_search(p_action => 'stage_move', p_job_code => $1)`, [j.code])
    expect(found).toEqual([{ object: `job:${j.id}` }])
  })

  it('through move_job_stage: its own stage move, no edit', async () => {
    const j = await newJob()
    const e = await saved(A.ownerId, `select public.move_job_stage($1, 'print')`, [j.id])
    expect(e.map(x => x.action)).toEqual(['stage_move'])
  })
})

describe('a remake', () => {
  const rev = { id: 'r1', ts: '2026-11-01T10:00:00Z', note: 'Mari Maasikas: värv vale', hambad: '11', status: 'disain' }

  it('added, then changed: by its number; its note only "changed"', async () => {
    const j = await newJob()
    let e = await editJob(j.id, `revisions = $2`, [JSON.stringify([rev])])
    expect(e[0].detail.remakes).toEqual([{ remake: 1, change: 'added' }])
    e = await editJob(j.id, `revisions = $2`, [JSON.stringify([{ ...rev, hambad: '11,12', note: 'uus', reasons: ['varv'] }])])
    expect(e[0].detail.remakes).toEqual([{ remake: 1, changes: {
      hambad: { old: '11', new: '11,12' }, note: 'changed', reasons: { old: null, new: 'varv' } } }])
    expect(JSON.stringify(e[0].detail)).not.toMatch(/Maasikas|uus/)
  })

  it('its stage through move_revision_stage: that move only; in its form: part of the edit', async () => {
    const j = await newJob({ revisions: [rev] })
    expect((await saved(A.ownerId, `select public.move_revision_stage($1, 'r1', 'print')`, [j.id])).map(x => x.action))
      .toEqual(['stage_move'])
    const e = await editJob(j.id, `revisions = $2`, [JSON.stringify([{ ...rev, status: 'disain' }])])
    expect(e[0]).toMatchObject({ action: 'edit', detail: { remakes: [{ remake: 1, changes: { status: { old: 'print', new: 'disain' } } }] } })
  })
})

describe('deleting and restoring a job: their own entries, not an edit', () => {
  it('delete, then restore', async () => {
    const j = await newJob()
    expect((await saved(A.ownerId, `delete from public.jobs where id = $1`, [j.id])).map(x => x.action)).toEqual(['delete'])
    expect((await saved(A.ownerId, `select public.restore_job($1)`, [j.id])).map(x => x.action)).toEqual(['restore'])
  })
})

describe('a patient', () => {
  let patient: string

  it('created: by id, nothing about them', async () => {
    const mark = await lastId()
    ;[{ id: patient }] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.patients (clinic_id, nimi, telefon, email) values ($1, 'Mari Maasikas', '+372 5555 1234', 'mari@example.ee') returning id`,
      [A.clinicId])
    expect(await since(mark)).toEqual([
      { org_id: A.clinicId, user_id: A.ownerId, action: 'create', object: `patient:${patient}`, detail: {} }])
  })

  it('edited: which fields changed, never their content; consent old → new', async () => {
    const e = await saved(A.ownerId, `update public.patients
       set nimi = 'Mari Kask', telefon = '+372 5555 9999', allergiad = 'lateks', turundusnousolek = 'jah' where id = $1`, [patient])
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'edit', object: `patient:${patient}`, detail: { changes: {
      nimi: 'changed', telefon: 'changed', allergiad: 'changed', turundusnousolek: { old: 'kysimata', new: 'jah' } } } }])
    expect(await saved(A.ownerId, `update public.patients set nimi = 'Mari Kask', updated_at = now() where id = $1`, [patient])).toEqual([])
  })

  it('the tooth chart: one entry per click, by tooth number; the same click again, none', async () => {
    const tooth = (fdi: number, staatus: string, markus: string | null = null) => saved(A.ownerId,
      `insert into public.patient_teeth (patient_id, fdi, staatus, markus) values ($1, $2, $3, $4)
       on conflict (patient_id, fdi) do update set staatus = excluded.staatus, markus = excluded.markus, updated_at = now()`,
      [patient, fdi, staatus, markus])
    expect(await tooth(16, 'ravi')).toMatchObject([{ action: 'edit', object: `patient:${patient}`,
      detail: { tooth: 16, changes: { staatus: { old: null, new: 'ravi' } } } }])
    expect(await tooth(16, 'ravi')).toEqual([])
    const e = await tooth(16, 'puudub', 'Mari ütles: eemaldati 2020')
    expect(e[0].detail).toEqual({ tooth: 16, changes: { staatus: { old: 'ravi', new: 'puudub' }, markus: 'changed' } })
    expect(await saved(A.ownerId, `delete from public.patient_teeth where patient_id = $1 and fdi = 16`, [patient]))
      .toMatchObject([{ detail: { tooth: 16, changes: { staatus: { old: 'puudub', new: null }, markus: 'changed' } } }])
  })

  it('deleted: one entry; their jobs unlinked and chart removed with it are not separate entries', async () => {
    const j = await newJob({ patient_id: patient })
    await saved(A.ownerId, `insert into public.patient_teeth (patient_id, fdi, staatus) values ($1, 21, 'terve')`, [patient])
    const e = await saved(A.ownerId, `delete from public.patients where id = $1`, [patient])
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'delete', object: `patient:${patient}`, detail: {} }])
    expect((await db.query<{ patient_id: string | null }>(`select patient_id from public.jobs where id = $1`, [j.id])).rows[0].patient_id).toBeNull()
  })
})

describe('what follows from a deletion is that deletion\'s entry, not an edit', () => {
  it('a client deleted: their jobs\' link is emptied, no job edit', async () => {
    const [c] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.customers (clinic_id, name) values ($1, 'Hambakliinik OÜ') returning id`, [A.clinicId])
    const j = await newJob({ customer_id: c.id })
    expect(await saved(A.ownerId, `delete from public.customers where id = $1`, [c.id])).toEqual([])
    expect((await db.query<{ customer_id: string | null }>(`select customer_id from public.jobs where id = $1`, [j.id])).rows[0].customer_id).toBeNull()
  })

  it('an account deleted: account_deleted only, not its permissions one by one', async () => {
    const [{ id }] = (await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ('uus@test.invalid', '{"full_name":"Uus"}') returning id`)).rows
    await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'technician' where id = $2`, [A.clinicId, id])
    await grant(db, A, id, ['jobs.read'])
    expect((await saved(A.ownerId, `select public.admin_delete_worker($1)`, [id])).map(e => e.action)).toEqual(['account_deleted'])
  })
})

describe('permissions', () => {
  const upsert = (rows: [string, boolean][]) => saved(A.ownerId,
    `insert into public.worker_permissions (profile_id, clinic_id, permission, granted)
     select $1, $2, p, g from unnest($3::text[], $4::boolean[]) as t(p, g)
     on conflict (profile_id, permission) do update set granted = excluded.granted`,
    [A.workerId, A.clinicId, rows.map(r => r[0]), rows.map(r => r[1])])

  it('one switch: who granted which permission to whom', async () => {
    expect(await upsert([['patients.read', true]])).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'permission',
      object: `user:${A.workerId}`, detail: { granted: ['patients.read'] } }])
    expect(await upsert([['patients.read', false]])).toMatchObject([{ detail: { removed: ['patients.read'] } }])
  })

  it('the preset, in one save: one entry; nothing changed, none', async () => {
    const e = await upsert([['patients.read', true], ['jobs.write', true], ['finance.read', false]])
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'permission', object: `user:${A.workerId}`,
      detail: { granted: ['patients.read'] } }])
    expect(await upsert([['patients.read', true], ['jobs.write', true]])).toEqual([])
  })

  it('removed from the team: what they had, removed', async () => {
    const e = await saved(A.ownerId, `delete from public.worker_permissions where profile_id = $1`, [A.workerId])
    expect(e).toMatchObject([{ action: 'permission', detail: { removed: ['jobs.read', 'jobs.write', 'patients.read'] } }])
    await grant(db, A, A.workerId, ['jobs.read', 'jobs.write'])
  })

  it('a member\'s role: old → new', async () => {
    const e = await saved(A.ownerId, `update public.profiles set org_role = 'admin' where id = $1`, [A.workerId])
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'permission', object: `user:${A.workerId}`,
      detail: { role: { old: 'technician', new: 'admin' } } }])
    await saved(A.ownerId, `update public.profiles set org_role = 'technician' where id = $1`, [A.workerId])
  })
})

describe('deleting a file', () => {
  it('under its job: the kind and version, never the name', async () => {
    const j = await newJob()
    const { rows: [f] } = await db.query<{ id: string }>(`
      insert into public.job_file (job_id, org_id, type, sha256, size, file_name, storage_path)
      values ($1, $2, 'design', $3, 10, $4, $5) returning id`,
      [j.id, A.clinicId, 'a'.repeat(64), `${j.code}_design_v1.stl`, `${A.clinicId}/${j.id}/x`])
    const e = await saved(A.ownerId, `select public.delete_job_file($1)`, [f.id])
    expect(e).toEqual([{ org_id: A.clinicId, user_id: A.ownerId, action: 'file_deleted', object: `job:${j.id}`,
      detail: { file: f.id, type: 'design', version: 1 } }])
    expect(await saved(A.ownerId, `select public.delete_job_file($1)`, [f.id])).toEqual([])
  })
})

describe('who reads them', () => {
  it('only the clinic\'s owners and admins, of their own clinic: not a technician, another clinic or anon', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select * from public.audit_search()`)).toMatch(/admin/)
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.audit_log`)).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.audit_log where org_id = $1`, [A.clinicId])).toEqual([])
    expect(await errorAs(db, 'anon', `select 1 from public.audit_log`)).toMatch(/permission denied/)
  })

  it('a partner clinic gets nothing from edits', async () => {
    expect((await db.query(`select 1 from public.audit_log where org_id = $1 and action in ('edit', 'create', 'permission', 'file_deleted')`,
      [B.clinicId])).rows).toEqual([])
  })

  it('no function reads the log except the ones that check the reader (a console added later fails here first)', async () => {
    const { rows } = await db.query<{ name: string }>(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ~ 'from\\s+public\\.audit_log' order by 1`)
    // audit_entries, audit_search and audit_people refuse anyone but the clinic's own owners and admins
    // (sql/078, 105). Two only look for an entry and return nothing from it: record_mfa_factors, to write
    // each authenticator once (sql/097); audit_permissions_deleted, for the account_deleted entry (sql/114).
    expect(rows.map(r => r.name)).toEqual(['audit_entries', 'audit_people', 'audit_permissions_deleted', 'audit_search', 'record_mfa_factors'])
  })

  it('no entry names the patient: no name, phone or e-mail anywhere in the log', async () => {
    const { rows } = await db.query<{ d: string }>(`select detail::text as d from public.audit_log`)
    for (const { d } of rows) expect(d).not.toMatch(/Maasikas|Mari Kask|5555|mari@example|lateks/)
  })
})

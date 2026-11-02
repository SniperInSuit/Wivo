/**
 * sql/092: a partner never learns who the patient is (the lawyer's locked
 * decision, 2 November 2026: no personal data crosses borders between
 * clinics; a partner sees only job information).
 *
 *  - Full visibility is off, for referrals too, and the tables refuse it.
 *  - The owner's staff cannot save the patient's name or a personal code into
 *    text a partner reads (SQLSTATE WV001), and a job whose text already
 *    names the patient cannot be shared.
 *  - Text from before (or from any path around the checks) is redacted on
 *    the way out.
 *  - The leak test: everything a partner can call or select, as a partner,
 *    contains no identity, no contacts, no birth date, no medical card, no
 *    visit notes and no patient prices. A new partner-reachable function
 *    fails this file until it is added to the sweep.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, as, grant, publicTables, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant  // Tallinn — owns the patient and the jobs
let B: Tenant  // Riga — partner
let patientId: string

const NAME = 'Zelinda Quorrington'
const CODE = '48407190123'           // shaped like an Estonian isikukood
const LV_CODE = '190784-12345'       // shaped like a Latvian personas kods
const SHA = 'a'.repeat(64)

/** Nothing in a partner's results may contain any of these. */
const FORBIDDEN = [
  'zelinda', 'quorrington', CODE, LV_CODE, '1984-07-19', '5123 4567', '51234567',
  'chart-secret', 'allergy-secret', 'visit-secret', 'markused-secret', 'wi-note-secret', 'rev-note-secret',
  '98765.43', '87654.32', '76543.21',  // decimals: a random uuid never contains a dot
]

async function job(extra: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = {
    clinic_id: A.clinicId, patsient: NAME, patient_id: patientId, status: 'disain', hind: 98765.43, too: 'Kroon',
    hambad: '11,21', kirjeldus: 'Zirconia, check the contacts',
    markused: JSON.stringify([{ id: 'n1', ts: '2026-10-01', autor: 'x', tekst: 'MARKUSED-SECRET' }]),
    work_items: JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', note: 'WI-NOTE-SECRET' }]),
    revisions: JSON.stringify([{ id: 'r1', ts: '2026-10-01', note: 'REV-NOTE-SECRET', price: 87654.32, status: 'disain',
      extra_costs: [{ nimi: 'screw', summa: 76543.21 }] }]),
    ...extra,
  }
  const cols = Object.keys(base)
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(base))
  return rows[0].id
}

const share = (j: string, caseType = 'lab_work', visibility: string | null = null) =>
  rowsAs(db, { id: A.ownerId }, `select public.share_job($1, $2, $3, 'design', array['disain', 'print'], $4, true, 80)`,
    [j, B.clinicId, caseType, visibility])

/** The SQLSTATE a statement raises as `actor`, or null. */
async function codeAs(actor: Actor, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await as(db, actor, () => db.query(sql, params))
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown'
  }
}

/** Writes as if from before sql/092: the guards are off for the duration. */
async function legacy(fn: () => Promise<unknown>): Promise<void> {
  await db.exec(`alter table public.jobs disable trigger guard_partner_visible_job_text;
                 alter table public.messages disable trigger guard_partner_visible_message;`)
  try { await fn() } finally {
    await db.exec(`alter table public.jobs enable trigger guard_partner_visible_job_text;
                   alter table public.messages enable trigger guard_partner_visible_message;`)
  }
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
  B = await createTenant(db, 'Riga')
  await grant(db, A, A.workerId, ['jobs.read', 'jobs.write'])
  await grant(db, B, B.workerId, ['jobs.read', 'jobs.write'])
  await db.query(
    `insert into public.partnership (org_a, org_b, status, roles, dpa_reference)
     values ($1, $2, 'active', array['design', 'surgery'], 'DPA')`, [A.clinicId, B.clinicId])
  const p = await db.query<{ id: string }>(
    `insert into public.patients (clinic_id, nimi, synniaeg, telefon, email, ravikaart, allergiad, markmed)
     values ($1, $2, '1984-07-19', '+372 5123 4567', 'zelinda@example.test', 'CHART-SECRET', 'ALLERGY-SECRET', $3)
     returning id`, [A.clinicId, NAME, `isikukood ${CODE}`])
  patientId = p.rows[0].id
  await db.query(
    `insert into public.visits (clinic_id, patient_id, patsient, algus, markus) values ($1, $2, $3, now(), 'VISIT-SECRET')`,
    [A.clinicId, patientId, NAME])
}, 120_000)

describe('full visibility is off', () => {
  it('lab work asked as full is partial', async () => {
    const j = await job()
    await share(j, 'lab_work', 'full')
    const { rows } = await db.query(`select visibility from public.job_share where job_id = $1`, [j])
    expect(rows).toEqual([{ visibility: 'partial' }])
  })

  it('a referral keeps its consent mark but is partial', async () => {
    const j = await job()
    await share(j, 'referral', 'full')
    const { rows } = await db.query(`select case_type, visibility, consent_by from public.job_share where job_id = $1`, [j])
    expect(rows).toEqual([{ case_type: 'referral', visibility: 'partial', consent_by: A.ownerId }])
    const [row] = await rowsAs(db, { id: B.workerId }, `select patient_name, patient_phone, patient_email from public.partner_job_view where job_id = $1`, [j])
    expect(row).toEqual({ patient_name: null, patient_phone: null, patient_email: null })
  })

  it('the tables refuse full, whatever writes them', async () => {
    const j = await job()
    await share(j)
    await expect(db.query(`update public.job_share set visibility = 'full' where job_id = $1`, [j])).rejects.toThrow(/job_share_partial_only/)
    await expect(db.query(`update public.partnership set default_visibility = 'full'`)).rejects.toThrow(/partnership_partial_only/)
  })
})

describe('the owner\'s staff cannot write the patient into what a partner reads', () => {
  const update = (j: string, set: string, params: unknown[] = []) =>
    codeAs({ id: A.ownerId }, `update public.jobs set ${set} where id = $1`, [j, ...params])

  it('description: first name, last name, a case ending, a personal code', async () => {
    const j = await job()
    await share(j)
    expect(await update(j, `kirjeldus = 'Call Zelinda first'`)).toBe('WV001')
    expect(await update(j, `kirjeldus = 'from QUORRINGTON'`)).toBe('WV001')
    expect(await update(j, `kirjeldus = 'Quorringtonile kiiresti'`)).toBe('WV001')
    expect(await update(j, `kirjeldus = $2`, [`ik ${CODE}`])).toBe('WV001')
    expect(await update(j, `kirjeldus = $2`, [`pk ${LV_CODE}`])).toBe('WV001')
    expect(await update(j, `kirjeldus = 'Zirconia, A2, rush'`)).toBeNull()
  })

  it('work items and revisions as the partner sees them; their notes are not shown, so not checked', async () => {
    const j = await job()
    await share(j)
    expect(await update(j, `work_items = $2`, [JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', materjal: 'for Zelinda' }])])).toBe('WV001')
    expect(await update(j, `revisions = $2`, [JSON.stringify([{ id: 'r1', status: 'disain', materjal: 'Quorrington' }])])).toBe('WV001')
    expect(await update(j, `revisions = $2`, [JSON.stringify([{ id: 'r1', status: 'disain', note: 'Zelinda called' }])])).toBeNull()
  })

  it('a job that is not shared is not checked', async () => {
    const j = await job()
    expect(await update(j, `kirjeldus = 'Call Zelinda first'`)).toBeNull()
  })

  it('a job whose text already names the patient is not shared until it is fixed', async () => {
    const j = await job({ kirjeldus: 'Zelinda wants it whiter' })
    expect(await codeAs({ id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [j, B.clinicId])).toBe('WV001')
    await db.query(`update public.jobs set kirjeldus = 'wants it whiter' where id = $1`, [j])
    expect(await codeAs({ id: A.ownerId }, `select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [j, B.clinicId])).toBeNull()
  })

  it('old text does not block an unrelated save (a stage move)', async () => {
    const j = await job()
    await share(j)
    await legacy(() => db.query(`update public.jobs set kirjeldus = 'Zelinda wants it whiter' where id = $1`, [j]))
    expect(await codeAs({ id: A.ownerId }, `select public.move_job_stage($1, 'print')`, [j])).toBeNull()
    expect(await update(j, `kirjeldus = 'Zelinda wants it much whiter'`)).toBe('WV001')
  })

  it('the job thread: the owner\'s messages are checked, new and edited; the partner\'s are not', async () => {
    const j = await job()
    await share(j)
    const post = (actor: Actor, body: string) => codeAs(actor, `select public.post_job_comment($1, $2, false)`, [j, body])
    expect(await post({ id: A.ownerId }, 'Zelinda asked for A1')).toBe('WV001')
    expect(await post({ id: A.workerId }, `code ${CODE}`)).toBe('WV001')
    expect(await post({ id: A.ownerId }, 'Patient asked for A1')).toBeNull()
    // A partner that guessed a name would learn it from a refusal.
    expect(await post({ id: B.workerId }, 'Zelinda?')).toBeNull()
    const [m] = (await db.query<{ id: string }>(
      `select m.id from public.messages m join public.channels c on c.id = m.channel_id
        where c.job_id = $1 and m.author_id = $2`, [j, A.ownerId])).rows
    await expect(db.query(`update public.messages set body = 'Zelinda asked for A1' where id = $1`, [m.id])).rejects.toThrow(/patient's name/)
  })

  it('an unshared job\'s thread is not checked', async () => {
    const j = await job()
    expect(await codeAs({ id: A.ownerId }, `select public.post_job_comment($1, 'Zelinda asked for A1', false)`, [j])).toBeNull()
  })

  it('the refusal does not quote the name (errors end up in logs and bug reports)', async () => {
    const j = await job()
    await share(j)
    const msg = await errorAs(db, { id: A.ownerId }, `update public.jobs set kirjeldus = 'Call Zelinda' where id = $1`, [j])
    expect(msg).toMatch(/Remove the patient's name or personal code/)
    expect(msg).not.toMatch(/zelinda/i)
  })
})

describe('text from before is redacted on the way out', () => {
  it('description, work items and the thread read ••• for the partner; the owner reads the original', async () => {
    const j = await job()
    await share(j)
    await legacy(async () => {
      await db.query(`update public.jobs set kirjeldus = $2, work_items = $3 where id = $1`,
        [j, `Zelinda Quorrington ${CODE} wants it whiter`, JSON.stringify([{ id: 'w1', too: 'Kroon', hambad: '11', materjal: 'Quorrington zirconia' }])])
      await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, 'Zelinda called again', false)`, [j])
    })
    const [row] = await rowsAs<{ description: string; work_items: { materjal: string }[] }>(db, { id: B.workerId },
      `select description, work_items from public.partner_job_view where job_id = $1`, [j])
    expect(row.description).toBe('••• ••• ••• wants it whiter')
    expect(row.work_items[0].materjal).toBe('••• zirconia')
    const partnerThread = await rowsAs<{ body: string }>(db, { id: B.workerId }, `select body from public.job_thread($1)`, [j])
    expect(partnerThread.map(m => m.body)).toEqual(['••• called again'])
    const ownerThread = await rowsAs<{ body: string }>(db, { id: A.ownerId }, `select body from public.job_thread($1)`, [j])
    expect(ownerThread.map(m => m.body)).toEqual(['Zelinda called again'])
  })
})

describe('leak test: nothing that identifies the patient reaches a partner, through anything', () => {
  /** Every function a partner can call that reads or acts on a shared job. */
  const COVERED = [
    'confirm_job_file', 'confirm_job_file_preview', 'job_file_name', 'job_files', 'job_thread', 'move_job_stage',
    'move_revision_stage', 'open_partner_job', 'partner_jobs', 'post_job_comment', 'preview_slot_open',
    'register_job_file', 'request_file_download', 'request_job_previews', 'resolve_question', 'set_job_file_preview',
    'share_job', 'unshare_job', 'upload_slot_open',
  ]

  it('the sweep covers every partner-reachable function', async () => {
    const { rows } = await db.query<{ proname: string }>(`
      select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('authenticated', p.oid, 'execute')
         and p.prosrc ~ '(my_share|job_share|partner_jobs|partner_sees|may_read_job_files|may_use_job_thread|may_upload_job_file)'
       order by 1`)
    const missing = rows.map(r => r.proname).filter(f => !COVERED.includes(f))
    expect(missing, 'add these to the sweep below, then to COVERED').toEqual([])
  })

  it('as the partner\'s admin and worker: every call, every table, every view, Storage', async () => {
    // A shared job carrying everything at once: identity in old text and in
    // an old message, a file with a preview, a question, notifications.
    const j = await job()
    await share(j)
    await legacy(async () => {
      await db.query(`update public.jobs set kirjeldus = $2 where id = $1`, [j, `${NAME} ${CODE} ${LV_CODE}, A2`])
      await rowsAs(db, { id: A.ownerId }, `select public.post_job_comment($1, $2, true)`, [j, `Is ${NAME} ok with A2?`])
    })
    const [f] = await rowsAs<{ id: string; storage_path: string }>(db, { id: A.ownerId },
      `select * from public.register_job_file($1, 'photo', $2, 1000, 'image/jpeg', 'jpg')`, [j, SHA])
    await rowsAs(db, { id: A.ownerId }, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [f.storage_path, A.ownerId])
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file($1)`, [f.id])
    const [{ path: previewPath }] = await rowsAs<{ path: string }>(db, { id: A.ownerId }, `select public.set_job_file_preview($1) as path`, [f.id])
    await rowsAs(db, { id: A.ownerId }, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [previewPath, A.ownerId])
    await rowsAs(db, { id: A.ownerId }, `select public.confirm_job_file_preview($1)`, [f.id])
    const [q] = (await db.query<{ id: string }>(
      `select m.id from public.messages m join public.channels c on c.id = m.channel_id where c.job_id = $1 and m.is_question`, [j])).rows

    const tables = await publicTables(db)
    const { rows: views } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`)

    for (const actor of [{ id: B.ownerId, mfa: true }, { id: B.workerId }]) {
      const seen: unknown[] = []
      const run = async (sql: string, params: unknown[] = []) => {
        try { seen.push(await rowsAs(db, actor, sql, params)) } catch (e) { seen.push((e as Error).message) }
      }
      await run(`select * from public.partner_job_view`)
      await run(`select * from public.partner_jobs()`)
      await run(`select * from public.open_partner_job($1)`, [j])
      await run(`select * from public.job_thread($1)`, [j])
      await run(`select * from public.job_files($1)`, [j])
      await run(`select public.job_file_name($1)`, [f.id])
      await run(`select public.request_file_download($1)`, [f.id])
      await run(`select * from public.request_job_previews($1)`, [j])
      await run(`select public.resolve_question($1)`, [q.id])
      await run(`select public.post_job_comment($1, 'design attached', false)`, [j])
      await run(`select * from public.register_job_file($1, 'design', $2, 10, 'model/stl', 'stl')`, [j, SHA])
      await run(`select public.confirm_job_file($1)`, [f.id])
      await run(`select public.set_job_file_preview($1)`, [f.id])
      await run(`select public.confirm_job_file_preview($1)`, [f.id])
      await run(`select public.upload_slot_open($1)`, [f.storage_path])
      await run(`select public.preview_slot_open($1)`, [previewPath])
      await run(`select public.move_revision_stage($1, 'r1', 'print')`, [j])
      await run(`select public.move_job_stage($1, 'print')`, [j])
      await run(`select public.share_job($1, $2, 'lab_work', 'design', array['disain'])`, [j, A.clinicId])
      await run(`select public.unshare_job($1, $2)`, [j, B.clinicId])
      await run(`select * from public.open_questions()`)
      await run(`select * from public.partner_orgs()`)
      await run(`select * from public.audit_entries(1000)`)
      for (const t of tables) await run(`select * from public.${t}`)
      for (const v of views) await run(`select * from public.${v.relname}`)
      await run(`select * from storage.objects`)

      const text = JSON.stringify(seen).toLowerCase()
      // The sweep really reached the job: its code and the redaction marks are there.
      expect(text).toContain('•••')
      for (const bad of FORBIDDEN) expect(text, `${bad} reached the partner`).not.toContain(bad.toLowerCase())
    }
  })
})

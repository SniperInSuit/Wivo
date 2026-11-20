/**
 * sql/124: a job's stage keeps its pay kind (docs/WORKFLOW-STAGES.md §10).
 *
 * Copied from the job's template when the stage is made, by every path that
 * makes one; the same as shared/workflow's materialiseTemplate; never moved by
 * a later change to the template; never twice on one job; readable by a stage
 * person without jobs.read (the reason it is copied), and by nobody in another
 * clinic. The backfill fills existing stages from their template and leaves
 * the old jobs (nobody on their stages) paying as before.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  freshDb, emptyDb, applyMigrations, migrationFiles, createTenant, createUser, rowsAs, grant, type Tenant,
} from './harness'
import { materialiseTemplate, type TemplateStage, type PayRole } from '../../shared/workflow/workflow'

let db: PGlite
let A: Tenant
let B: Tenant
let doctor: string
let tech: string      // on stages, no jobs.read
let designer: string
let crown: string

const STAGES = ['skaneering', 'disain', 'freesimine', 'printimine', 'parandus', 'kvaliteet', 'valmis']

interface Spec { key: string; payRole?: PayRole | null; people?: string[]; optional?: boolean }

async function member(d: PGlite, t: Tenant, name: string, perms: string[]): Promise<string> {
  const id = await createUser(d, name)
  await d.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [t.clinicId, id])
  await grant(d, t, id, perms)
  return id
}

async function makeTemplate(d: PGlite, t: Tenant, name: string, stages: Spec[]): Promise<string> {
  const id = (await d.query<{ id: string }>(
    `insert into public.workflow_template (org_id, name) values ($1, $2) returning id`, [t.clinicId, name])).rows[0].id
  for (const [i, s] of stages.entries()) {
    const sid = (await d.query<{ id: string }>(
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position, optional, pay_role)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [t.clinicId, id, s.key, i, s.optional ?? false, s.payRole ?? null])).rows[0].id
    for (const p of s.people ?? []) {
      await d.query(`insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`,
        [sid, p, t.clinicId])
    }
  }
  return id
}

async function setStages(d: PGlite, t: Tenant) {
  await d.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                 on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
    [t.clinicId, JSON.stringify(STAGES.map(key => ({ key })))])
}

const createJob = async (actor: string, job: Record<string, unknown>, switches: Record<string, boolean> = {}) =>
  (await rowsAs<{ id: string }>(db, { id: actor },
    `select * from public.create_job($1::jsonb, $2::jsonb)`, [JSON.stringify(job), JSON.stringify(switches)]))[0].id

/** stage_key → pay_role, as the database holds them. */
async function payRoles(d: PGlite, job: string): Promise<Record<string, string | null>> {
  const rows = (await d.query<{ stage_key: string; pay_role: string | null }>(
    `select stage_key, pay_role from public.job_stage where job_id = $1 order by position`, [job])).rows
  return Object.fromEntries(rows.map(r => [r.stage_key, r.pay_role]))
}

const CROWN: Spec[] = [
  { key: 'skaneering' },
  { key: 'disain', payRole: 'disain' },
  { key: 'freesimine', payRole: 'too' },
  { key: 'printimine', payRole: 'mudel' },
  { key: 'kvaliteet', optional: true },
  { key: 'valmis' },
]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Elsewhere')
  await setStages(db, A)
  doctor = await member(db, A, 'Dr Ozola', ['jobs.read', 'jobs.write'])
  tech = await member(db, A, 'Janis', ['stock.read'])
  designer = await member(db, A, 'Liga', ['stock.read'])
  CROWN[1].people = [designer]
  CROWN[2].people = [tech]
  crown = await makeTemplate(db, A, 'Crown, lab', CROWN)
}, 120_000)

describe('a new job\'s stages take their pay kind from the template', () => {
  it('create_job: each stage its template stage\'s pay kind, the others none', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    expect(await payRoles(db, j)).toEqual({
      skaneering: null, disain: 'disain', freesimine: 'too', printimine: 'mudel', valmis: null,
    })
  })

  it('the same as shared/workflow\'s materialiseTemplate', async () => {
    const tpl: TemplateStage[] = CROWN.map((s, i) => ({
      stageKey: s.key, position: i, task: null, optional: s.optional ?? false, defaultOn: false,
      onlyIf: [], orderer: false, payRole: s.payRole ?? null, people: s.people ?? [],
    }))
    for (const switches of [{}, { kvaliteet: true }]) {
      const j = await createJob(doctor, { patsient: 'P', template_id: crown }, switches)
      const plan = materialiseTemplate({ stages: tpl, facts: {}, orderedBy: doctor, switches })
      expect(await payRoles(db, j)).toEqual(Object.fromEntries(plan.map(p => [p.stageKey, p.payRole])))
    }
  })

  it('a job without a template (an older build\'s insert) uses the clinic\'s default template', async () => {
    const def = (await db.query<{ id: string }>(
      `select id from public.workflow_template where org_id = $1 and is_default`, [A.clinicId])).rows[0].id
    await db.query(`update public.workflow_template_stage set pay_role = 'too' where template_id = $1 and stage_key = 'freesimine'`, [def])
    const j = (await rowsAs<{ id: string }>(db, { id: doctor },
      `insert into public.jobs (clinic_id, patsient, status) values ($1, 'P', 'skaneering') returning id`, [A.clinicId]))[0].id
    const roles = await payRoles(db, j)
    expect(roles.freesimine).toBe('too')
    expect(Object.values(roles).filter(Boolean)).toEqual(['too'])
    await db.query(`update public.workflow_template_stage set pay_role = null where template_id = $1`, [def])
  })

  it('a stage added to the job later takes its pay kind from the job\'s template; a key the template lacks, none', async () => {
    const tpl = await makeTemplate(db, A, 'Short', [{ key: 'skaneering' }, { key: 'valmis' }, { key: 'parandus', payRole: 'muudatus', optional: true }])
    const j = await createJob(doctor, { patsient: 'P', template_id: tpl })
    expect(await payRoles(db, j)).toEqual({ skaneering: null, valmis: null })
    await rowsAs(db, { id: A.ownerId }, `select public.add_job_stage($1, 'parandus', 'skaneering')`, [j])
    await rowsAs(db, { id: A.ownerId }, `select public.add_job_stage($1, 'freesimine', 'skaneering')`, [j])
    const roles = await payRoles(db, j)
    expect(roles.parandus).toBe('muudatus')
    expect(roles.freesimine).toBeNull()
  })

  it('copied, not referenced: moving a pay kind in the template later does not move it on a job already made', async () => {
    const tpl = await makeTemplate(db, A, 'Movable', [{ key: 'disain', payRole: 'too' }, { key: 'freesimine' }, { key: 'valmis' }])
    const j = await createJob(doctor, { patsient: 'P', template_id: tpl })
    await db.query(`update public.workflow_template_stage set pay_role = null where template_id = $1 and stage_key = 'disain'`, [tpl])
    await db.query(`update public.workflow_template_stage set pay_role = 'too' where template_id = $1 and stage_key = 'freesimine'`, [tpl])
    expect(await payRoles(db, j)).toEqual({ disain: 'too', freesimine: null, valmis: null })
  })

  it('never twice on one job: a second stage with a pay kind the job has gets none', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    await db.query(`insert into public.job_stage (org_id, job_id, stage_key, position, pay_role) values ($1, $2, 'parandus', 9, 'too')`,
      [A.clinicId, j])
    expect((await payRoles(db, j)).parandus).toBeNull()
  })

  it('only the four pay kinds', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    await expect(db.query(`update public.job_stage set pay_role = 'bonus' where job_id = $1 and stage_key = 'skaneering'`, [j]))
      .rejects.toThrow(/job_stage_pay_role_valid/)
  })
})

describe('who reads it', () => {
  it('a stage person without jobs.read reads the pay kinds of their job (not the template)', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    const rows = await rowsAs<{ stage_key: string; pay_role: string | null }>(db, { id: tech },
      `select stage_key, pay_role from public.job_stage where job_id = $1 and pay_role is not null order by position`, [j])
    expect(rows).toEqual([
      { stage_key: 'disain', pay_role: 'disain' },
      { stage_key: 'freesimine', pay_role: 'too' },
      { stage_key: 'printimine', pay_role: 'mudel' },
    ])
    // ...which is the point: the template itself is closed to them.
    expect(await rowsAs(db, { id: tech }, `select pay_role from public.workflow_template_stage where template_id = $1`, [crown])).toEqual([])
  })

  it('and with it, who is on those stages', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    const rows = await rowsAs<{ stage_key: string; profile_id: string }>(db, { id: tech },
      `select s.stage_key, p.profile_id from public.job_stage s join public.job_stage_person p on p.job_stage_id = s.id
        where s.job_id = $1 and s.pay_role is not null order by s.position`, [j])
    expect(rows).toEqual([{ stage_key: 'disain', profile_id: designer }, { stage_key: 'freesimine', profile_id: tech }])
  })

  it('another clinic reads none of it', async () => {
    const j = await createJob(doctor, { patsient: 'P', template_id: crown })
    for (const id of [B.ownerId, B.workerId]) {
      expect(await rowsAs(db, { id }, `select pay_role from public.job_stage where job_id = $1`, [j])).toEqual([])
    }
  })
})

describe('the backfill', () => {
  it('fills existing stages from their template; the old jobs keep nobody on their stages', async () => {
    const before = migrationFiles().filter(f => f < '124')
    expect(migrationFiles()).toContain('124_job_stage_pay_role.sql')
    const d = await emptyDb()
    await applyMigrations(d, before)
    const t = await createTenant(d, 'Before')
    await setStages(d, t)
    const owner = t.ownerId
    const tpl = await makeTemplate(d, t, 'Lab', [{ key: 'disain', payRole: 'disain', people: [owner] }, { key: 'freesimine', payRole: 'too' }, { key: 'valmis' }])
    const madeFromTemplate = (await d.query<{ id: string }>(
      `insert into public.jobs (clinic_id, patsient, status, template_id) values ($1, 'P', 'disain', $2) returning id`, [t.clinicId, tpl])).rows[0].id
    const old = (await d.query<{ id: string }>(
      `insert into public.jobs (clinic_id, patsient, status, assigned_to) values ($1, 'Q', 'freesimine', $2) returning id`, [t.clinicId, owner])).rows[0].id
    // Before 124 there is no column at all.
    await expect(d.query(`select pay_role from public.job_stage limit 1`)).rejects.toThrow(/pay_role/)

    await applyMigrations(d, ['124_job_stage_pay_role.sql'])
    expect(await payRoles(d, madeFromTemplate)).toEqual({ disain: 'disain', freesimine: 'too', valmis: null })
    // The old job: the default template has no pay kinds, and nobody is on its stages.
    expect(Object.values(await payRoles(d, old)).every(r => r === null)).toBe(true)
    const people = (await d.query<{ n: number }>(
      `select count(*)::int as n from public.job_stage_person p join public.job_stage s on s.id = p.job_stage_id where s.job_id = $1`, [old])).rows[0].n
    expect(people).toBe(0)

    // Running it again changes nothing (if not exists / only nulls).
    await applyMigrations(d, ['124_job_stage_pay_role.sql'])
    expect(await payRoles(d, madeFromTemplate)).toEqual({ disain: 'disain', freesimine: 'too', valmis: null })
  }, 120_000)
})

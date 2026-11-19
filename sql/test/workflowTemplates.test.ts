/**
 * sql/122: workflow templates and a job's own stages (docs/WORKFLOW-STAGES.md).
 *
 * 1. The backfill: on a database as it was before 122, every clinic gets a
 *    default template from its own stages, and every job keeps its stage, its
 *    people and its money exactly, with job_stage rows and NO job_stage_person
 *    rows, so it moves (§5) and pays (§10) as before.
 * 2. The leak test: no other clinic reads or writes a row of any new table,
 *    and inside a clinic only "Manage stages" changes a template, only people
 *    of that clinic go on it, and nobody writes a job's stages directly.
 * 3. What the database itself refuses: a pay kind twice in one template, an
 *    unknown rule, a changed orderer.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  emptyDb, applyMigrations, migrationFiles, freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant,
} from './harness'

const NEW_TABLES = ['workflow_template', 'workflow_template_stage', 'workflow_template_stage_person',
  'clinic_stage_default', 'job_stage', 'job_stage_person']

describe('the backfill keeps every existing job as it was', () => {
  let db: PGlite
  let A: Tenant
  let B: Tenant
  const before: Record<string, Record<string, unknown>> = {}
  let jobs: { inList: string; removedStage: string; other: string }
  let auditBefore = 0

  beforeAll(async () => {
    db = await emptyDb()
    await applyMigrations(db, migrationFiles().filter(f => f < '122'))
    A = await createTenant(db, 'Tallinn')
    B = await createTenant(db, 'Riga')
    await db.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                    on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
      [A.clinicId, JSON.stringify([{ key: 'vastuvott' }, { key: 'disain' }, { key: 'print' }, { key: 'valmis' }])])
    const job = async (clinic: string, status: string) => (await db.query<{ id: string }>(
      `insert into public.jobs (clinic_id, patsient, status, assigned_to, designed_by, hind, work_items)
       values ($1, 'Test Patient', $2, $3, $3, 120.50, '[{"too":"kroon","hambad":"11"}]'::jsonb) returning id`,
      [clinic, status, clinic === A.clinicId ? A.workerId : B.workerId])).rows[0].id
    jobs = { inList: await job(A.clinicId, 'disain'), removedStage: await job(A.clinicId, 'poleeri'), other: await job(B.clinicId, 'print') }
    for (const id of Object.values(jobs)) {
      before[id] = (await db.query<Record<string, unknown>>(`select * from public.jobs where id = $1`, [id])).rows[0]
    }
    auditBefore = (await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log`)).rows[0].n
    await applyMigrations(db, migrationFiles().filter(f => f >= '122'))
  }, 180_000)

  it('each clinic has one default template, from its own stages or the built-in list', async () => {
    const { rows } = await db.query<{ org_id: string; keys: string[] }>(`
      select t.org_id, array_agg(s.stage_key order by s.position) as keys
        from public.workflow_template t join public.workflow_template_stage s on s.template_id = t.id
       where t.is_default group by t.org_id`)
    const byOrg = Object.fromEntries(rows.map(r => [r.org_id, r.keys]))
    expect(byOrg[A.clinicId]).toEqual(['vastuvott', 'disain', 'print', 'valmis'])
    expect(byOrg[B.clinicId]).toEqual(['disain', 'print', 'poleeri', 'puhasta', 'varvi', 'valmis'])
    const { rows: stages } = await db.query(`select 1 from public.workflow_template_stage where pay_role is not null or orderer or optional`)
    expect(stages).toEqual([])
  })

  it('every job row is untouched: its stage, its people, its money, even updated_at; template null = the default', async () => {
    for (const [id, old] of Object.entries(before)) {
      const now = (await db.query<Record<string, unknown>>(`select * from public.jobs where id = $1`, [id])).rows[0]
      for (const col of Object.keys(old)) expect(now[col], `${id}.${col}`).toEqual(old[col])
      expect(now.ordered_by).toBeNull()
      expect(now.template_id).toBeNull()
    }
  })

  it('every job has its stages, in the template\'s order, and its current stage even if the template lost it', async () => {
    const keys = async (id: string) => (await db.query<{ stage_key: string }>(
      `select stage_key from public.job_stage where job_id = $1 order by position`, [id])).rows.map(r => r.stage_key)
    expect(await keys(jobs.inList)).toEqual(['vastuvott', 'disain', 'print', 'valmis'])
    expect(await keys(jobs.removedStage)).toEqual(['vastuvott', 'disain', 'print', 'valmis', 'poleeri'])
    expect(await keys(jobs.other)).toEqual(['disain', 'print', 'poleeri', 'puhasta', 'varvi', 'valmis'])
  })

  it('and nobody on any of them: the move rule and pay stay today\'s', async () => {
    expect((await db.query(`select 1 from public.job_stage_person`)).rows).toEqual([])
    expect((await db.query(`select 1 from public.job_stage where started_at is not null or done_at is not null or skipped_at is not null`)).rows).toEqual([])
  })

  it('the backfill writes nothing to the audit log: no person changed anything', async () => {
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log`)).rows[0].n).toBe(auditBefore)
  })

  it('running the migration again changes nothing', async () => {
    const count = async () => (await db.query<{ n: number }>(
      `select (select count(*) from public.workflow_template) + (select count(*) from public.job_stage) as n`)).rows[0].n
    const n = await count()
    await applyMigrations(db, ['122_workflow_templates.sql'])
    expect(await count()).toBe(n)
  })
})

describe('leak test: the new tables', () => {
  let db: PGlite
  let A: Tenant
  let B: Tenant
  let template: string
  let tStage: string
  let jobA: string
  let jStage: string
  let stageEditor: string
  let jobsWriter: string
  let nobody: string

  beforeAll(async () => {
    db = await freshDb()
    A = await createTenant(db, 'Tallinn')
    B = await createTenant(db, 'Riga')
    const member = async (name: string, perms: string[]) => {
      const id = await createUser(db, name)
      await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, id])
      await grant(db, A, id, perms)
      return id
    }
    stageEditor = await member('Stage editor', ['pipeline.write'])
    jobsWriter = await member('Technician', ['jobs.write'])
    nobody = await member('No rights', [])

    template = (await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.workflow_template (org_id, name) values ($1, 'Crown, lab') returning id`, [A.clinicId]))[0].id
    tStage = (await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position, pay_role)
       values ($1, $2, 'disain', 0, 'disain') returning id`, [A.clinicId, template]))[0].id
    await rowsAs(db, { id: A.ownerId },
      `insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`,
      [tStage, A.workerId, A.clinicId])
    await rowsAs(db, { id: A.ownerId },
      `insert into public.clinic_stage_default (org_id, stage_key, profile_id) values ($1, 'print', $2)`, [A.clinicId, A.workerId])
    jobA = (await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, status) values ($1, 'Zelinda Quorrington', 'disain') returning id`, [A.clinicId]))[0].id
    // The job's own stages are written by the database when it is created (sql/123).
    jStage = (await db.query<{ id: string }>(
      `select id from public.job_stage where job_id = $1 and stage_key = 'disain'`, [jobA])).rows[0].id
    await db.query(`insert into public.job_stage_person (job_stage_id, profile_id, org_id) values ($1, $2, $3)`, [jStage, A.workerId, A.clinicId])
  }, 120_000)

  it('another clinic reads nothing of any new table, and changes nothing', async () => {
    for (const actor of [{ id: B.ownerId }, { id: B.workerId }, 'anon' as const]) {
      // A's rows (B has its own default template since sql/123).
      for (const t of NEW_TABLES) {
        expect(await rowsAs(db, actor, `select * from public.${t} where org_id = $1`, [A.clinicId]).catch(() => []), `${t}`).toEqual([])
        expect(await rowsAs(db, actor, `update public.${t} set org_id = org_id where org_id = $1 returning 1`, [A.clinicId]).catch(() => []), `${t}`).toEqual([])
        expect(await rowsAs(db, actor, `delete from public.${t} where org_id = $1 returning 1`, [A.clinicId]).catch(() => []), `${t}`).toEqual([])
      }
    }
  })

  it('another clinic cannot add to A\'s template, nor put a row under its own clinic that points at it', async () => {
    expect(await errorAs(db, { id: B.ownerId },
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position) values ($1, $2, 'x', 9)`,
      [A.clinicId, template])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId },
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position) values ($1, $2, 'x', 9)`,
      [B.clinicId, template])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId },
      `insert into public.job_stage (org_id, job_id, stage_key, position) values ($1, $2, 'x', 9)`, [B.clinicId, jobA])).not.toBeNull()
  })

  it('inside the clinic: whoever works with jobs reads the templates; nobody without rights does', async () => {
    // Crown, lab and the clinic's default template (sql/123: made with the clinic).
    expect(await rowsAs(db, { id: jobsWriter }, `select id from public.workflow_template`)).toHaveLength(2)
    expect(await rowsAs(db, { id: stageEditor }, `select id from public.workflow_template_stage where template_id = $1`, [template])).toHaveLength(1)
    for (const t of ['workflow_template', 'workflow_template_stage', 'workflow_template_stage_person', 'clinic_stage_default']) {
      expect(await rowsAs(db, { id: nobody }, `select * from public.${t}`), t).toEqual([])
    }
  })

  it('only "Manage stages" changes a template', async () => {
    expect(await errorAs(db, { id: jobsWriter },
      `insert into public.workflow_template (org_id, name) values ($1, 'Mine')`, [A.clinicId])).not.toBeNull()
    expect(await rowsAs(db, { id: jobsWriter }, `update public.workflow_template set name = 'x' returning 1`)).toEqual([])
    expect(await errorAs(db, { id: stageEditor },
      `insert into public.workflow_template (org_id, name) values ($1, 'Surgical guide')`, [A.clinicId])).toBeNull()
  })

  it('a template names only people of its own clinic', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`,
      [tStage, B.workerId, A.clinicId])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.clinic_stage_default (org_id, stage_key, profile_id) values ($1, 'x', $2)`, [A.clinicId, B.ownerId])).not.toBeNull()
  })

  it('a job\'s stages: read with the job, written by nobody through the API, not even the owner', async () => {
    // The default template's six stages (sql/123 wrote them with the job).
    expect(await rowsAs(db, { id: A.ownerId }, `select id from public.job_stage`)).toHaveLength(6)
    // The worker on design (above) and on print: the clinic's default person for it, copied at creation.
    expect(await rowsAs(db, { id: A.ownerId }, `select profile_id from public.job_stage_person`)).toHaveLength(2)
    expect(await rowsAs(db, { id: nobody }, `select * from public.job_stage`)).toEqual([])
    expect(await rowsAs(db, { id: nobody }, `select * from public.job_stage_person`)).toEqual([])
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.job_stage (org_id, job_id, stage_key, position) values ($1, $2, 'print', 1)`, [A.clinicId, jobA])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.job_stage_person (job_stage_id, profile_id, org_id) values ($1, $2, $3)`, [jStage, A.ownerId, A.clinicId])).not.toBeNull()
    expect(await rowsAs(db, { id: A.ownerId }, `update public.job_stage set done_at = now() returning 1`)).toEqual([])
    expect(await rowsAs(db, { id: A.ownerId }, `delete from public.job_stage_person returning 1`)).toEqual([])
  })

  it('without the second factor: nothing', async () => {
    for (const t of NEW_TABLES) {
      expect(await rowsAs(db, { id: A.ownerId, mfa: false }, `select * from public.${t}`).catch(() => []), t).toEqual([])
    }
  })
})

describe('what the database refuses', () => {
  let db: PGlite
  let A: Tenant
  let template: string

  beforeAll(async () => {
    db = await freshDb()
    A = await createTenant(db, 'Tallinn')
    template = (await db.query<{ id: string }>(
      `insert into public.workflow_template (org_id, name) values ($1, 'Crown, office') returning id`, [A.clinicId])).rows[0].id
  }, 120_000)

  const addStage = (key: string, position: number, extra = '', values = '') => rowsAs(db, { id: A.ownerId },
    `insert into public.workflow_template_stage (org_id, template_id, stage_key, position${extra}) values ($1, $2, $3, $4${values})`,
    [A.clinicId, template, key, position])

  it('a pay kind on a second stage of the same template', async () => {
    await addStage('disain', 0, ', pay_role', `, 'disain'`)
    await expect(addStage('freesimine', 1, ', pay_role', `, 'disain'`)).rejects.toThrow(/pay_role_once/)
    await expect(addStage('freesimine', 1, ', pay_role', `, 'too'`)).resolves.toBeTruthy()
  })

  it('a pay kind that is not one, a rule that is not one, a switch with a rule, default_on without a switch', async () => {
    await expect(addStage('a', 10, ', pay_role', `, 'technician'`)).rejects.toThrow(/pay_role_valid/)
    await expect(addStage('b', 11, ', only_if', `, array['someday']`)).rejects.toThrow(/only_if_valid/)
    await expect(addStage('c', 12, ', optional, only_if', `, true, array['digital']`)).rejects.toThrow(/switch_or_rule/)
    await expect(addStage('d', 13, ', default_on', `, true`)).rejects.toThrow(/default_on_valid/)
    await expect(addStage('fotogramm', 14, ', only_if, orderer', `, array['digital', 'implants_gt_1'], true`)).resolves.toBeTruthy()
  })

  it('the orderer is whoever created the job, and stays that', async () => {
    const [job] = await rowsAs<{ id: string; ordered_by: string }>(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, status, ordered_by) values ($1, 'P', 'disain', $2) returning id, ordered_by`,
      [A.clinicId, A.workerId])
    expect(job.ordered_by).toBe(A.ownerId)
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set ordered_by = $2 where id = $1`, [job.id, A.workerId]))
      .toMatch(/cannot be changed/)
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set hind = 10 where id = $1`, [job.id])).toBeNull()
  })

  it('a job\'s template must be its own clinic\'s; the rule fields take only their values', async () => {
    const B = await createTenant(db, 'Riga')
    await expect(db.query(`insert into public.jobs (clinic_id, patsient, status, template_id) values ($1, 'P', 'x', $2)`, [B.clinicId, template]))
      .rejects.toThrow(/jobs_template_fk/)
    await expect(db.query(`insert into public.jobs (clinic_id, patsient, status, impression_type) values ($1, 'P', 'x', 'scan')`, [A.clinicId]))
      .rejects.toThrow(/impression_type_valid/)
    await expect(db.query(`insert into public.jobs (clinic_id, patsient, status, production_method) values ($1, 'P', 'x', 'cast')`, [A.clinicId]))
      .rejects.toThrow(/production_method_valid/)
  })

  it('files of type ct and project are accepted', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'job_file_type_valid'`)
    expect(rows[0].def).toContain(`'ct'`)
    expect(rows[0].def).toContain(`'project'`)
  })
})

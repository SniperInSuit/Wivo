/**
 * sql/123: workflow templates, part 2 (docs/WORKFLOW-STAGES.md, plan 3).
 *
 * A job made from its template (and the SQL plan equals shared/workflow's),
 * the default template following the clinic's stages, who may move a job
 * (§5), done and "I started" (§4), editing a job's stages (§2.4), who is told
 * (§3, §3.1), who sees a job (§3.2), files.write (§7.3), and the leak test:
 * another clinic gets nothing of any of it.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant, type Actor } from './harness'
import { materialiseTemplate, type TemplateStage, type OnlyIfRule, type PayRole } from '../../shared/workflow/workflow'

let db: PGlite
let A: Tenant
let B: Tenant
let doctor: string    // creates jobs: jobs.read + jobs.write
let doctor2: string
let itPerson: string  // files.write only
let tech1: string     // the technician's defaults: jobs.write, stock.*
let tech2: string
let stranger: string  // jobs.write, on no stage
let crown: string     // "Crown, lab"
const SHA = 'a'.repeat(64)

const STAGES = ['skaneering', 'vastuvott', 'fotogramm', 'disain', 'freesimine', 'vahamudel', 'kvaliteet', 'viimistlus', 'valmis']

interface StageSpec {
  key: string; optional?: boolean; defaultOn?: boolean; onlyIf?: OnlyIfRule[]; orderer?: boolean
  payRole?: PayRole | null; people?: string[]; task?: string
}

async function member(name: string, perms: string[]): Promise<string> {
  const id = await createUser(db, name)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, id])
  await grant(db, A, id, perms)
  return id
}

async function makeTemplate(name: string, stages: StageSpec[]): Promise<string> {
  const t = (await db.query<{ id: string }>(
    `insert into public.workflow_template (org_id, name) values ($1, $2) returning id`, [A.clinicId, name])).rows[0].id
  for (const [i, s] of stages.entries()) {
    const id = (await db.query<{ id: string }>(
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position, task, optional, default_on, only_if, orderer, pay_role)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [A.clinicId, t, s.key, i, s.task ?? null, s.optional ?? false, s.defaultOn ?? false, s.onlyIf ?? [], s.orderer ?? false, s.payRole ?? null])).rows[0].id
    for (const p of s.people ?? []) {
      await db.query(`insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`, [id, p, A.clinicId])
    }
  }
  return t
}

async function createJob(actor: Actor, job: Record<string, unknown>, switches: Record<string, boolean> = {}) {
  return (await rowsAs<{ id: string; status: string; template_id: string; ordered_by: string }>(db, actor,
    `select * from public.create_job($1::jsonb, $2::jsonb)`, [JSON.stringify(job), JSON.stringify(switches)]))[0]
}

/** The job's stages, as the database holds them. */
async function stagesOf(job: string) {
  return (await db.query<{ stage_key: string; position: number; skipped: boolean; done_by: string | null; people: string[] }>(
    `select s.stage_key, s.position, s.skipped_at is not null as skipped, s.done_by,
            coalesce(array_agg(p.profile_id::text order by p.profile_id) filter (where p.profile_id is not null), '{}') as people
       from public.job_stage s left join public.job_stage_person p on p.job_stage_id = s.id
      where s.job_id = $1 group by s.id order by s.position`, [job])).rows
}

const keys = async (job: string) => (await stagesOf(job)).map(s => s.stage_key)
const statusOf = async (job: string) => (await db.query<{ status: string }>(`select status from public.jobs where id = $1`, [job])).rows[0].status
const move = (actor: Actor, job: string, to: string) => errorAs(db, actor, `select public.move_job_stage($1, $2)`, [job, to])
const canMove = async (actor: Actor, job: string, to: string) =>
  (await rowsAs<{ ok: boolean }>(db, actor, `select public.can_move_stage($1, $2) as ok`, [job, to]))[0].ok
const notes = async (user: string, job: string) => (await db.query<{ kind: string; detail: Record<string, unknown> }>(
  `select kind, detail from public.notification where user_id = $1 and job_id = $2 order by created_at, kind`, [user, job])).rows
const clearNotes = () => db.query(`delete from public.notification`)
/** Put a job (made as the database) at a stage, without moving it through anyone. */
const placeAt = (job: string, stage: string) => db.query(`update public.jobs set status = $2 where id = $1`, [job, stage])

const CROWN: StageSpec[] = [
  { key: 'skaneering', orderer: true },
  { key: 'vastuvott' },  // IT: the clinic's default person for intake
  { key: 'fotogramm', onlyIf: ['digital', 'implants_gt_1'], orderer: true },
  { key: 'disain', people: [], payRole: 'disain', task: 'Design the crown' },
  { key: 'freesimine', people: [], payRole: 'too' },
  { key: 'vahamudel', optional: true },
  { key: 'kvaliteet', optional: true, defaultOn: false },
  { key: 'viimistlus', people: [], payRole: 'mudel' },
  { key: 'valmis' },
]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Elsewhere')
  doctor = await member('Dr Ozola', ['jobs.read', 'jobs.write', 'patients.read', 'patients.write'])
  doctor2 = await member('Dr Berzina', ['jobs.read', 'jobs.write'])
  itPerson = await member('IT', ['files.write'])
  tech1 = await member('Janis', ['jobs.write', 'stock.read', 'stock.write'])
  tech2 = await member('Liga', ['jobs.write', 'stock.read', 'stock.write'])
  stranger = await member('Someone', ['jobs.write'])
  await db.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                  on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
    [A.clinicId, JSON.stringify(STAGES.map(key => ({ key })))])
  await db.query(`insert into public.clinic_stage_default (org_id, stage_key, profile_id) values ($1, 'vastuvott', $2)`, [A.clinicId, itPerson])
  CROWN[3].people = [tech1]
  CROWN[4].people = [tech1]
  CROWN[7].people = [tech2]
  crown = await makeTemplate('Crown, lab', CROWN)
}, 120_000)

// ── 1. A job from its template ──────────────────────────────────────────────

describe('a job made from its template', () => {
  it('digital with two implants: photogrammetry is in; the orderer, the template\'s people and the clinic default are copied', async () => {
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown, impression_type: 'digital', implant_count: 2 })
    expect(j.ordered_by).toBe(doctor)
    expect(j.status).toBe('skaneering')  // none sent: the job's first stage
    const s = await stagesOf(j.id)
    expect(s.map(x => x.stage_key)).toEqual(['skaneering', 'vastuvott', 'fotogramm', 'disain', 'freesimine', 'viimistlus', 'valmis'])
    expect(s.map(x => x.position)).toEqual([0, 1, 2, 3, 4, 5, 6])
    const people = Object.fromEntries(s.map(x => [x.stage_key, x.people]))
    expect(people.skaneering).toEqual([doctor])
    expect(people.vastuvott).toEqual([itPerson])
    expect(people.fotogramm).toEqual([doctor])
    expect(people.disain).toEqual([tech1])
    expect(people.viimistlus).toEqual([tech2])
    expect(people.valmis).toEqual([])
  })

  it('conventional: photogrammetry stays out; a switch ticked at creation comes in', async () => {
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown, impression_type: 'conventional', implant_count: 3 },
      { vahamudel: true })
    expect(await keys(j.id)).toEqual(['skaneering', 'vastuvott', 'disain', 'freesimine', 'vahamudel', 'viimistlus', 'valmis'])
  })

  it('the SQL plan is shared/workflow\'s materialiseTemplate, for every combination of facts and switches', async () => {
    const tpl: TemplateStage[] = CROWN.map((s, i) => ({
      stageKey: s.key, position: i, task: s.task ?? null, optional: s.optional ?? false, defaultOn: s.defaultOn ?? false,
      onlyIf: s.onlyIf ?? [], orderer: s.orderer ?? false, payRole: s.payRole ?? null, people: s.people ?? [],
    }))
    for (const impression of ['digital', 'conventional', null] as const) {
      for (const implants of [0, 2, null]) {
        for (const switches of [{}, { vahamudel: true, kvaliteet: true }, { vahamudel: false }]) {
          const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown, impression_type: impression, implant_count: implants }, switches)
          const expected = materialiseTemplate({
            stages: tpl, facts: { impressionType: impression, implantCount: implants }, orderedBy: doctor, switches,
            clinicDefaults: { vastuvott: [itPerson] },
          })
          const got = await stagesOf(j.id)
          expect(got.map(s => ({ stageKey: s.stage_key, position: s.position, people: s.people })),
            JSON.stringify({ impression, implants, switches }))
            .toEqual(expected.map(e => ({ stageKey: e.stageKey, position: e.position, people: [...e.people].sort() })))
        }
      }
    }
  }, 60_000)

  it('copied, not referenced: changing the template later changes no job made from it', async () => {
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown })
    const before = await stagesOf(j.id)
    const disain = (await db.query<{ id: string }>(`select id from public.workflow_template_stage where template_id = $1 and stage_key = 'disain'`, [crown])).rows[0].id
    await db.query(`insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`, [disain, tech2, A.clinicId])
    expect(await stagesOf(j.id)).toEqual(before)
    await db.query(`delete from public.workflow_template_stage_person where template_stage_id = $1 and profile_id = $2`, [disain, tech2])
  })

  it('a job inserted directly (an older build) gets the default template\'s stages; nobody on them but the clinic default', async () => {
    const [j] = await rowsAs<{ id: string }>(db, { id: doctor },
      `insert into public.jobs (clinic_id, patsient, status) values ($1, 'P', 'disain') returning id`, [A.clinicId])
    const s = await stagesOf(j.id)
    expect(s.map(x => x.stage_key)).toEqual(STAGES)
    expect(s.filter(x => x.people.length).map(x => x.stage_key)).toEqual(['vastuvott'])
  })

  it('a stage the template lacks, sent as the status, joins the end', async () => {
    const t = await makeTemplate('Short', [{ key: 'disain', people: [tech1] }])
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: t, status: 'valmis' })
    expect(await keys(j.id)).toEqual(['disain', 'valmis'])
  })

  it('refused: an archived template, another clinic\'s, an unknown field, a switch that is not true or false', async () => {
    const t = await makeTemplate('Old', [{ key: 'disain' }])
    await db.query(`update public.workflow_template set archived_at = now() where id = $1`, [t])
    await expect(createJob({ id: doctor }, { patsient: 'P', template_id: t })).rejects.toThrow(/archived/)
    const bt = (await db.query<{ id: string }>(`select id from public.workflow_template where org_id = $1`, [B.clinicId])).rows[0].id
    await expect(createJob({ id: doctor }, { patsient: 'P', template_id: bt })).rejects.toThrow()
    await expect(createJob({ id: doctor }, { patsient: 'P', price: 1 })).rejects.toThrow(/Unknown job field/)
    await expect(createJob({ id: doctor }, { patsient: 'P' }, { vahamudel: 'yes' } as never)).rejects.toThrow(/true or false/)
  })

  it('runs as the caller: without jobs.write, no job; into another clinic, no job', async () => {
    await expect(createJob({ id: itPerson }, { patsient: 'P' })).rejects.toThrow()
    await expect(createJob({ id: doctor }, { patsient: 'P', clinic_id: B.clinicId })).rejects.toThrow()
    expect((await db.query(`select 1 from public.jobs where clinic_id = $1 and patsient = 'P'`, [B.clinicId])).rows).toEqual([])
  })

  it('"new job, you are on stage X": the bell only, once per person, their first stage; not the creator', async () => {
    await clearNotes()
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown })
    expect(await notes(doctor, j.id)).toEqual([])
    expect(await notes(itPerson, j.id)).toEqual([{ kind: 'stage_assigned', detail: { stage: 'vastuvott', new: true } }])
    expect(await notes(tech1, j.id)).toEqual([{ kind: 'stage_assigned', detail: { stage: 'disain', new: true } }])
    expect(await notes(tech2, j.id)).toEqual([{ kind: 'stage_assigned', detail: { stage: 'viimistlus', new: true } }])
    await db.query(`insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/w1', 'k', 'a')`,
      [A.clinicId, tech1])
    expect((await db.query(`select * from public.pending_pushes() where kind = 'stage_assigned'`)).rows).toEqual([])
    expect((await db.query(`select * from public.pending_notification_emails() where kind = 'stage_assigned'`)).rows).toEqual([])
  })

  it('someone the job already names as its technician is not told twice', async () => {
    await clearNotes()
    const j = await createJob({ id: doctor }, { patsient: 'P', template_id: crown, assigned_to: tech1 })
    expect(await notes(tech1, j.id)).toEqual([{ kind: 'assigned', detail: { role: 'technician' } }])
  })
})

// ── 2. The default template ─────────────────────────────────────────────────

describe('the default template follows the clinic\'s stages', () => {
  const defaultKeys = async (org: string) => (await db.query<{ stage_key: string }>(
    `select s.stage_key from public.workflow_template t join public.workflow_template_stage s on s.template_id = t.id
      where t.org_id = $1 and t.is_default order by s.position`, [org])).rows.map(r => r.stage_key)

  it('a new clinic has one, with the built-in stages', async () => {
    const C = await createTenant(db, 'New clinic')
    expect(await defaultKeys(C.clinicId)).toEqual(['disain', 'print', 'poleeri', 'puhasta', 'varvi', 'valmis'])
  })

  it('saving the stages adds, removes and orders; what is set on a stage that stays is kept', async () => {
    const C = await createTenant(db, 'Another')
    const tpl = (await db.query<{ id: string }>(`select id from public.workflow_template where org_id = $1 and is_default`, [C.clinicId])).rows[0].id
    await db.query(`update public.workflow_template_stage set task = 'Keep me', pay_role = 'disain' where template_id = $1 and stage_key = 'disain'`, [tpl])
    await db.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                    on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
      [C.clinicId, JSON.stringify([{ key: 'vastuvott' }, { key: 'valmis' }, { key: 'disain' }, { key: 'disain' }])])
    expect(await defaultKeys(C.clinicId)).toEqual(['vastuvott', 'valmis', 'disain'])
    const { rows } = await db.query<{ task: string; pay_role: string }>(
      `select task, pay_role from public.workflow_template_stage where template_id = $1 and stage_key = 'disain'`, [tpl])
    expect(rows[0]).toEqual({ task: 'Keep me', pay_role: 'disain' })
  })
})

// ── 3. Who may move a job (§5) ──────────────────────────────────────────────

describe('who may move a job', () => {
  let j: string

  beforeAll(async () => {
    j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
    await placeAt(j, 'disain')
  })

  it('the current stage\'s person: yes, forward or back', async () => {
    expect(await canMove({ id: tech1 }, j, 'freesimine')).toBe(true)
    expect(await canMove({ id: tech1 }, j, 'vastuvott')).toBe(true)
  })

  it('anyone else with jobs.write: no, through the RPC and through a direct update', async () => {
    // A stranger who cannot even read the job, and a doctor who reads every job.
    expect(await canMove({ id: stranger }, j, 'freesimine')).toBe(false)
    expect(await move({ id: stranger }, j, 'freesimine')).toMatch(/may not move/)
    expect(await canMove({ id: doctor2 }, j, 'freesimine')).toBe(false)
    expect(await move({ id: doctor2 }, j, 'freesimine')).toMatch(/may not move/)
    expect(await errorAs(db, { id: doctor2 }, `update public.jobs set status = 'freesimine' where id = $1`, [j])).toMatch(/may not move/)
    expect(await statusOf(j)).toBe('disain')
  })

  it('the target stage\'s person pulls it from the stage right before; not from further back', async () => {
    // freesimine is tech1's too; viimistlus is tech2's, and freesimine is right before it.
    expect(await canMove({ id: tech2 }, j, 'viimistlus')).toBe(false)  // from disain: too far
    await placeAt(j, 'freesimine')
    expect(await canMove({ id: tech2 }, j, 'viimistlus')).toBe(true)
    expect(await move({ id: tech2 }, j, 'viimistlus')).toBeNull()
    expect(await statusOf(j)).toBe('viimistlus')
  })

  it('skipped stages do not count as "right before"; a skipped stage cannot be entered', async () => {
    const k = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown }, { kvaliteet: true })).id
    // ... freesimine, kvaliteet, viimistlus: skip kvaliteet, and tech2 pulls from freesimine.
    expect(await errorAs(db, { id: A.ownerId }, `select public.set_job_stage_skipped($1, 'kvaliteet', true)`, [k])).toBeNull()
    await placeAt(k, 'freesimine')
    expect(await canMove({ id: tech2 }, k, 'viimistlus')).toBe(true)
    expect(await canMove({ id: tech1 }, k, 'kvaliteet')).toBe(false)
    expect(await canMove({ id: A.ownerId }, k, 'kvaliteet')).toBe(false)
  })

  it('the owner: yes, anywhere the job has', async () => {
    expect(await canMove({ id: A.ownerId }, j, 'skaneering')).toBe(true)
    expect(await canMove({ id: A.ownerId }, j, 'print')).toBe(false)  // not one of this job's stages
  })

  it('IT, without jobs.write, moves the job from intake and from nowhere else', async () => {
    const k = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
    await placeAt(k, 'vastuvott')
    expect(await move({ id: itPerson }, k, 'disain')).toBeNull()
    expect(await move({ id: itPerson }, k, 'freesimine')).toMatch(/may not move/)
    // And not by a direct update: that still needs jobs.write.
    await placeAt(k, 'vastuvott')
    expect(await rowsAs(db, { id: itPerson }, `update public.jobs set status = 'disain' where id = $1 returning 1`, [k])).toEqual([])
  })

  it('a job with nobody on its stages: today\'s rule, jobs.write moves it, nothing without', async () => {
    const [{ id: k }] = await rowsAs<{ id: string }>(db, { id: doctor },
      `insert into public.jobs (clinic_id, patsient, status, template_id) values ($1, 'P', 'disain', $2) returning id`,
      [A.clinicId, await makeTemplate('Nobody', [{ key: 'disain' }, { key: 'valmis' }])])
    expect(await canMove({ id: doctor2 }, k, 'valmis')).toBe(true)
    expect(await move({ id: doctor2 }, k, 'valmis')).toBeNull()
    expect(await rowsAs(db, { id: doctor2 }, `update public.jobs set status = 'disain' where id = $1 returning status`, [k]))
      .toEqual([{ status: 'disain' }])
    expect(await move({ id: itPerson }, k, 'valmis')).toMatch(/No permission/)
    // can_move_stage answers only about a job one can read.
    expect(await canMove({ id: stranger }, k, 'valmis')).toBe(false)
  })

  it('every move is in the audit log', async () => {
    const { rows } = await db.query(`select 1 from public.audit_log where action = 'stage_move' and object = $1
                                      and detail ->> 'to' = 'viimistlus'`, ['job:' + j])
    expect(rows).toHaveLength(1)
  })
})

// ── 4. Done and "I started" (§4) ────────────────────────────────────────────

describe('done, and "I started"', () => {
  let j: string

  beforeAll(async () => {
    j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
    await placeAt(j, 'disain')
  })

  it('leaving a stage for a later one marks it done by the mover; going back clears the stage entered', async () => {
    await move({ id: tech1 }, j, 'freesimine')
    let s = Object.fromEntries((await stagesOf(j)).map(x => [x.stage_key, x]))
    expect(s.disain.done_by).toBe(tech1)
    await move({ id: tech1 }, j, 'disain')
    s = Object.fromEntries((await stagesOf(j)).map(x => [x.stage_key, x]))
    expect(s.disain.done_by).toBeNull()
    expect(s.freesimine.done_by).toBeNull()  // sent back, not done
  })

  it('"I started": the stage\'s person; the first stays; every press is audited', async () => {
    const [first] = await rowsAs<{ started_by: string; stage_key: string }>(db, { id: tech1 }, `select * from public.start_job_stage($1)`, [j])
    expect(first).toMatchObject({ started_by: tech1, stage_key: 'disain' })
    const [again] = await rowsAs<{ started_by: string }>(db, { id: A.ownerId }, `select * from public.start_job_stage($1)`, [j])
    expect(again.started_by).toBe(tech1)
    const { rows } = await db.query<{ first: string }>(
      `select detail ->> 'first' as first from public.audit_log where action = 'stage_start' and object = $1 order by id`, ['job:' + j])
    expect(rows.map(r => r.first)).toEqual(['true', 'false'])
  })

  it('"I started": not someone else\'s stage, not another clinic', async () => {
    expect(await errorAs(db, { id: tech2 }, `select public.start_job_stage($1)`, [j])).toMatch(/not yours/)
    expect(await errorAs(db, { id: stranger }, `select public.start_job_stage($1)`, [j])).toMatch(/not found/i)
    expect(await errorAs(db, { id: B.ownerId }, `select public.start_job_stage($1)`, [j])).toMatch(/not found/i)
  })
})

// ── 5. Editing a job's stages (§2.4) ────────────────────────────────────────

describe('editing a job\'s stages', () => {
  let j: string

  beforeAll(async () => {
    j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
  })

  it('jobs.write alone may not: putting yourself on a stage would give you its moves and its pay', async () => {
    expect(await errorAs(db, { id: stranger }, `select public.set_job_stage_people($1, 'disain', $2)`, [j, [stranger]])).toMatch(/Not allowed/)
    expect(await errorAs(db, { id: tech1 }, `select public.set_job_stage_skipped($1, 'disain', true)`, [j])).toMatch(/Not allowed/)
  })

  it('the doctor who ordered it may; a person of another clinic cannot be put on it', async () => {
    await clearNotes()
    expect(await errorAs(db, { id: doctor }, `select public.set_job_stage_people($1, 'disain', $2)`, [j, [tech1, tech2]])).toBeNull()
    expect((await stagesOf(j)).find(s => s.stage_key === 'disain')!.people).toEqual([tech1, tech2].sort())
    expect(await notes(tech2, j)).toEqual([{ kind: 'stage_assigned', detail: { stage: 'disain', new: false } }])
    expect(await notes(tech1, j)).toEqual([])
    expect(await errorAs(db, { id: doctor }, `select public.set_job_stage_people($1, 'disain', $2)`, [j, [B.workerId]])).toMatch(/Only members/)
    expect(await errorAs(db, { id: doctor2 }, `select public.set_job_stage_people($1, 'disain', $2)`, [j, [doctor2]])).toMatch(/Not allowed/)
  })

  it('another clinic\'s owner (owner and organisation admin there) changes nothing and is told nothing', async () => {
    const before = await stagesOf(j)
    const b = { id: B.ownerId }
    expect(await errorAs(db, b, `select public.set_job_stage_people($1, 'disain', $2)`, [j, [B.ownerId]])).toMatch(/Not allowed/)
    expect(await errorAs(db, b, `select public.set_job_stage_skipped($1, 'vahamudel', true)`, [j])).toMatch(/Not allowed/)
    expect(await errorAs(db, b, `select public.add_job_stage($1, 'vahamudel', null)`, [j])).toMatch(/Not allowed/)
    expect(await errorAs(db, b, `select public.move_job_stage($1, 'disain')`, [j])).toMatch(/not found/i)
    expect((await rowsAs<{ ok: boolean }>(db, b, `select public.may_edit_job_stages($1) as ok`, [j]))[0].ok).toBe(false)
    expect(await canMove(b, j, 'vastuvott')).toBe(false)
    expect(await rowsAs(db, b, `select public.job_first_stage($1::jsonb, '{}'::jsonb) as s`, [JSON.stringify({ template_id: crown })]))
      .toEqual([{ s: null }])
    expect(await stagesOf(j)).toEqual(before)
  })

  it('a stage is added after another, and the rest move down', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.add_job_stage($1, 'vahamudel', 'disain')`, [j])).toBeNull()
    expect(await keys(j)).toEqual(['skaneering', 'vastuvott', 'disain', 'vahamudel', 'freesimine', 'viimistlus', 'valmis'])
    expect(await errorAs(db, { id: A.ownerId }, `select public.add_job_stage($1, 'nonsense', null)`, [j])).toMatch(/Unknown stage/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.add_job_stage($1, 'disain', null)`, [j])).toMatch(/already has/)
  })

  it('the stage the job is at cannot be skipped; every change is in the audit log', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.set_job_stage_skipped($1, 'skaneering', true)`, [j])).toMatch(/cannot be skipped/)
    const { rows } = await db.query<{ change: string }>(
      `select detail ->> 'change' as change from public.audit_log where action = 'stage_edit' and object = $1 order by id`, ['job:' + j])
    expect(rows.map(r => r.change)).toEqual(['people', 'added'])
  })
})

// ── 6. Who is told (§3, §3.1) ───────────────────────────────────────────────

describe('who is told', () => {
  it('"your turn": the target stage\'s people; not the mover; not the previous stage\'s own person', async () => {
    const j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
    await placeAt(j, 'vastuvott')
    await clearNotes()
    await move({ id: itPerson }, j, 'disain')
    expect(await notes(tech1, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'vastuvott', to: 'disain', role: 'stage' } }])
    expect(await notes(itPerson, j)).toEqual([])
    await clearNotes()
    // tech1 is on design and on milling: moved by the owner, they hear nothing from themselves.
    await move({ id: A.ownerId }, j, 'freesimine')
    expect(await notes(tech1, j)).toEqual([])
  })

  it('a stage with nobody: the job\'s technician, as before; a job with nobody at all: the owner', async () => {
    const t = await makeTemplate('Half', [{ key: 'disain', people: [tech1] }, { key: 'valmis' }])
    const j = (await createJob({ id: doctor }, { patsient: 'P', template_id: t, assigned_to: tech2 })).id
    await clearNotes()
    await move({ id: tech1 }, j, 'valmis')
    expect(await notes(tech2, j)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'valmis', role: 'technician' } }])
    expect(await notes(A.ownerId, j)).toEqual([])

    const k = (await createJob({ id: doctor }, { patsient: 'P', template_id: t })).id
    await clearNotes()
    await move({ id: tech1 }, k, 'valmis')
    expect(await notes(A.ownerId, k)).toEqual([{ kind: 'stage_reached', detail: { from: 'disain', to: 'valmis', role: 'owner' } }])
  })

  it('the others on the job: only who asked for every stage, bell and e-mail, never a push; nothing of a skipped stage', async () => {
    const j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
    await placeAt(j, 'vastuvott')
    await clearNotes()
    await move({ id: itPerson }, j, 'disain')
    expect(await notes(tech2, j)).toEqual([])  // switch off by default
    expect(await notes(doctor, j)).toEqual([])

    expect(await errorAs(db, { id: tech2 }, `select public.set_notify_every_stage(true)`)).toBeNull()
    expect(await errorAs(db, { id: doctor }, `select public.set_notify_every_stage(true)`)).toBeNull()
    await db.query(`delete from public.push_subscription`)
    await db.query(`insert into public.push_subscription (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/w2', 'k', 'a')`,
      [A.clinicId, tech2])
    await clearNotes()
    await move({ id: tech1 }, j, 'freesimine')
    expect(await notes(tech2, j)).toEqual([{ kind: 'stage_progress', detail: { from: 'disain', to: 'freesimine' } }])
    expect(await notes(doctor, j)).toEqual([{ kind: 'stage_progress', detail: { from: 'disain', to: 'freesimine' } }])
    expect(await notes(tech1, j)).toEqual([])  // the mover
    const emails = (await db.query<{ kind: string; job_id: string }>(`select kind, job_id from public.pending_notification_emails()`)).rows
    expect(emails.filter(e => e.job_id === j && e.kind === 'stage_progress')).toHaveLength(2)
    expect((await db.query(`select 1 from public.pending_pushes() where kind = 'stage_progress'`)).rows).toEqual([])

    // The doctor's stages skipped: they are no longer on the job's flow.
    await db.query(`update public.job_stage set skipped_at = now() where job_id = $1 and stage_key in ('skaneering')`, [j])
    await db.query(`update public.job_stage set skipped_at = now() where job_id = $1 and stage_key in ('fotogramm')`, [j])
    await clearNotes()
    await move({ id: tech1 }, j, 'disain')
    expect(await notes(doctor, j)).toEqual([])
    expect(await notes(tech2, j)).toHaveLength(1)
    await rowsAs(db, { id: tech2 }, `select public.set_notify_every_stage(false)`)
    await rowsAs(db, { id: doctor }, `select public.set_notify_every_stage(false)`)
  })

  it('the switch is one\'s own: readable, and set only for oneself', async () => {
    await rowsAs(db, { id: tech2 }, `select public.set_notify_every_stage(true)`)
    expect(await rowsAs(db, { id: tech1 }, `select notify_every_stage from public.profiles where id = $1`, [tech2]))
      .toEqual([{ notify_every_stage: true }])
    expect(await rowsAs(db, { id: tech1 }, `select notify_every_stage from public.profiles where id = $1`, [tech1]))
      .toEqual([{ notify_every_stage: false }])
    await rowsAs(db, { id: tech2 }, `select public.set_notify_every_stage(false)`)
  })

  it('no notification carries the patient', async () => {
    const { rows } = await db.query<{ detail: string }>(`select detail::text from public.notification`)
    for (const r of rows) expect(r.detail).not.toMatch(/patsient|"P"/)
  })
})

// ── 7. Who sees a job (§3.2) ────────────────────────────────────────────────

describe('who sees a job', () => {
  let j: string

  beforeAll(async () => {
    j = (await createJob({ id: doctor }, { patsient: 'Zelinda Quorrington', template_id: crown })).id
  })

  it('a technician without jobs.read sees the job, its stages and its people from the start, before their turn', async () => {
    expect(await statusOf(j)).toBe('skaneering')
    expect(await rowsAs(db, { id: tech2 }, `select patsient from public.jobs where id = $1`, [j])).toEqual([{ patsient: 'Zelinda Quorrington' }])
    expect(await rowsAs(db, { id: tech2 }, `select stage_key from public.job_stage where job_id = $1`, [j])).toHaveLength(6)
    expect((await rowsAs(db, { id: tech2 }, `select profile_id from public.job_stage_person p join public.job_stage s on s.id = p.job_stage_id where s.job_id = $1`, [j])).length)
      .toBeGreaterThan(3)
  })

  it('someone on no stage, without jobs.read, does not', async () => {
    expect(await rowsAs(db, { id: stranger }, `select 1 from public.jobs where id = $1`, [j])).toEqual([])
    expect(await rowsAs(db, { id: stranger }, `select 1 from public.job_stage where job_id = $1`, [j])).toEqual([])
  })

  it('taken off the stage, or the stage skipped: no longer', async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.set_job_stage_people($1, 'viimistlus', '{}')`, [j])
    expect(await rowsAs(db, { id: tech2 }, `select 1 from public.jobs where id = $1`, [j])).toEqual([])
    await rowsAs(db, { id: A.ownerId }, `select public.set_job_stage_people($1, 'viimistlus', $2)`, [j, [tech2]])
    expect(await rowsAs(db, { id: tech2 }, `select 1 from public.jobs where id = $1`, [j])).toHaveLength(1)
    await rowsAs(db, { id: A.ownerId }, `select public.set_job_stage_skipped($1, 'viimistlus', true)`, [j])
    expect(await rowsAs(db, { id: tech2 }, `select 1 from public.jobs where id = $1`, [j])).toEqual([])
    await rowsAs(db, { id: A.ownerId }, `select public.set_job_stage_skipped($1, 'viimistlus', false)`, [j])
  })

  it('another clinic\'s people never, even if put on a stage by the database', async () => {
    const s = (await db.query<{ id: string }>(`select id from public.job_stage where job_id = $1 and stage_key = 'valmis'`, [j])).rows[0].id
    await db.query(`insert into public.job_stage_person (job_stage_id, profile_id, org_id) values ($1, $2, $3)`, [s, B.workerId, A.clinicId])
    for (const actor of [{ id: B.workerId }, { id: B.ownerId }]) {
      expect(await rowsAs(db, actor, `select 1 from public.jobs where id = $1`, [j])).toEqual([])
      expect(await rowsAs(db, actor, `select 1 from public.job_stage where job_id = $1`, [j])).toEqual([])
      expect(await rowsAs(db, actor, `select 1 from public.job_stage_person where org_id = $1`, [A.clinicId])).toEqual([])
      expect(await canMove(actor, j, 'vastuvott')).toBe(false)
      expect(await move(actor, j, 'vastuvott')).toMatch(/not found/i)
      expect(await errorAs(db, actor, `select public.set_job_stage_people($1, 'valmis', '{}')`, [j])).toMatch(/Not allowed/)
      expect(await errorAs(db, actor, `select public.add_job_stage($1, 'vahamudel', null)`, [j])).toMatch(/Not allowed/)
    }
    await db.query(`delete from public.job_stage_person where profile_id = $1`, [B.workerId])
  })

  it('without the second factor: nothing', async () => {
    expect(await rowsAs(db, { id: tech2, mfa: false }, `select 1 from public.jobs where id = $1`, [j]).catch(() => [])).toEqual([])
  })
})

// ── 8. files.write (§7.3) ───────────────────────────────────────────────────

describe('files.write', () => {
  let j: string
  const register = (actor: Actor, job: string, supersedes: string | null = null) => errorAs(db, actor,
    `select public.register_job_file($1, 'scan', $2, 1000, 'model/stl', 'stl', $3)`, [job, SHA, supersedes])

  beforeAll(async () => {
    j = (await createJob({ id: doctor }, { patsient: 'P', template_id: crown })).id
  })

  it('adds a file to a job the person is on a stage of', async () => {
    expect(await register({ id: itPerson }, j)).toBeNull()
    expect(await rowsAs(db, { id: itPerson }, `select type from public.job_file where job_id = $1`, [j])).toEqual([{ type: 'scan' }])
  })

  it('not to a job they are not on; not without files.write; not as a new version of a file', async () => {
    const other = (await createJob({ id: doctor }, { patsient: 'P', template_id: await makeTemplate('No IT', [{ key: 'disain', people: [tech1] }]) })).id
    expect(await register({ id: itPerson }, other)).toMatch(/Not allowed/)
    const noFiles = await member('No files', [])
    const s = (await db.query<{ id: string }>(`select id from public.job_stage where job_id = $1 and stage_key = 'vastuvott'`, [j])).rows[0].id
    await db.query(`insert into public.job_stage_person (job_stage_id, profile_id, org_id) values ($1, $2, $3)`, [s, noFiles, A.clinicId])
    expect(await register({ id: noFiles }, j)).toMatch(/Not allowed/)
    const f = (await db.query<{ id: string }>(`select id from public.job_file where job_id = $1`, [j])).rows[0].id
    expect(await register({ id: itPerson }, j, f)).toMatch(/replace/)
  })

  it('does not edit the job, delete a file, or read money', async () => {
    expect(await rowsAs(db, { id: itPerson }, `update public.jobs set kirjeldus = 'x' where id = $1 returning 1`, [j])).toEqual([])
    const f = (await db.query<{ id: string }>(`select id from public.job_file where job_id = $1`, [j])).rows[0].id
    expect(await errorAs(db, { id: itPerson }, `select public.delete_job_file($1)`, [f])).toMatch(/Not allowed/)
    expect(await rowsAs(db, { id: itPerson }, `select 1 from public.invoices`).catch(() => [])).toEqual([])
    expect(await rowsAs(db, { id: itPerson }, `select 1 from public.payments`).catch(() => [])).toEqual([])
  })

  it('another clinic adds nothing', async () => {
    expect(await register({ id: B.ownerId }, j)).toMatch(/Not allowed/)
  })
})

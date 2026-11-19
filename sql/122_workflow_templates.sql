-- ============================================================================
-- Wivo — migration 122: workflow templates, a job's own stages, and who is on them
-- Run AFTER sql/121. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/WORKFLOW-STAGES.md (plan 3), slice 1: the schema only. Moving a job,
-- notifications and pay do not read any of this yet (slice 2), so every
-- clinic works exactly as before after this migration.
--
-- 1. A clinic's stages stay where they are (clinic_settings.pipeline_stages).
--    A TEMPLATE is a procedure built from them: ordered stages, each with its
--    default people, its task text and whether it is optional (§2.2–2.6a).
--      workflow_template                 the procedure ("Crown, lab")
--      workflow_template_stage           its stages, in order
--      workflow_template_stage_person    the named people on a template stage
--      clinic_stage_default              the clinic's fall-back person per stage
--
-- 2. A JOB gets its own copy (§2.3: copied, never referenced, so changing a
--    template never changes who did last month's work):
--      job_stage                         the job's stages, in order
--      job_stage_person                  who is on each of them
--    Only database functions write these (slice 2); RLS here lets a person
--    read the stages of a job they can read, and write nothing.
--
-- 3. jobs gets template_id, ordered_by (the doctor who created the job,
--    §2.6a) and the four fields the template rules read (§2.5). ordered_by is
--    the creator: set on insert from the signed-in person, never changed.
--
-- 4. job_file accepts two more types: `ct` (a CT series as one ZIP, §6.2) and
--    `project` (a design project, §6.1).
--
-- 5. Every clinic gets a DEFAULT template from its current stages (§2.7), and
--    every existing job gets job_stage rows from it, so it reads as before.
--    The jobs rows themselves are not touched: template_id null means the
--    clinic's default template.
--    The backfill writes NO job_stage_person rows: a job with none keeps
--    today's move rule (§5) and pays from assigned_to / designed_by exactly
--    as before (§10). The default template's stages have no pay_role either,
--    for the same reason.
--
-- Decided here, where the plan left it open:
--   - only_if is a LIST (text[]), not one name: photogrammetry needs two rules
--     at once (digital AND implants_gt_1, §2.5).
--   - A stage is optional (a switch) or has rules, not both; default_on only
--     on an optional stage.
--
-- Tests: sql/test/workflowTemplates.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. Templates ────────────────────────────────────────────────────────────

create table if not exists public.workflow_template (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workflow_template_name_unique unique (org_id, name),
  constraint workflow_template_id_org unique (id, org_id),
  constraint workflow_template_name_valid check (length(btrim(name)) between 1 and 120)
);
create unique index if not exists workflow_template_one_default
  on public.workflow_template (org_id) where is_default;

create table if not exists public.workflow_template_stage (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  template_id uuid not null,
  stage_key   text not null,
  position    int not null,
  task        text,
  optional    boolean not null default false,
  default_on  boolean not null default false,
  only_if     text[] not null default '{}',
  orderer     boolean not null default false,
  pay_role    text,
  constraint workflow_template_stage_template_fk foreign key (template_id, org_id)
    references public.workflow_template (id, org_id) on delete cascade,
  constraint workflow_template_stage_id_org unique (id, org_id),
  constraint workflow_template_stage_position_unique unique (template_id, position),
  constraint workflow_template_stage_key_unique unique (template_id, stage_key),
  constraint workflow_template_stage_key_valid check (length(btrim(stage_key)) between 1 and 80),
  constraint workflow_template_stage_task_valid check (task is null or length(task) <= 2000),
  -- The closed list of §2.5. A new rule is a line here and in shared/workflow.
  constraint workflow_template_stage_only_if_valid check (
    only_if <@ array['digital', 'conventional', 'implants_gt_1', 'print', 'mill', 'printed_model']::text[]),
  constraint workflow_template_stage_switch_or_rule check (not (optional and cardinality(only_if) > 0)),
  constraint workflow_template_stage_default_on_valid check (not default_on or optional),
  -- The pay kinds of lib/earnings.ts (RateScope), §10.
  constraint workflow_template_stage_pay_role_valid check (
    pay_role is null or pay_role in ('too', 'disain', 'mudel', 'muudatus'))
);
-- Each pay kind on at most one stage of a template (§10): saving a second fails.
create unique index if not exists workflow_template_stage_pay_role_once
  on public.workflow_template_stage (template_id, pay_role) where pay_role is not null;

create table if not exists public.workflow_template_stage_person (
  template_stage_id uuid not null,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  org_id            uuid not null references public.clinics(id) on delete cascade,
  primary key (template_stage_id, profile_id),
  constraint workflow_template_stage_person_stage_fk foreign key (template_stage_id, org_id)
    references public.workflow_template_stage (id, org_id) on delete cascade
);

create table if not exists public.clinic_stage_default (
  org_id     uuid not null references public.clinics(id) on delete cascade,
  stage_key  text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (org_id, stage_key, profile_id)
);

-- ── 2. A job's own stages ───────────────────────────────────────────────────

create table if not exists public.job_stage (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.clinics(id) on delete cascade,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  stage_key  text not null,
  position   int not null,
  task       text,
  skipped_at timestamptz,
  started_at timestamptz,
  started_by uuid,
  done_at    timestamptz,
  done_by    uuid,
  created_at timestamptz not null default now(),
  constraint job_stage_key_unique unique (job_id, stage_key),
  constraint job_stage_id_org unique (id, org_id),
  constraint job_stage_task_valid check (task is null or length(task) <= 2000)
);
create index if not exists job_stage_job_idx on public.job_stage (job_id, position);

create table if not exists public.job_stage_person (
  job_stage_id uuid not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  org_id       uuid not null references public.clinics(id) on delete cascade,
  added_by     uuid,
  added_at     timestamptz not null default now(),
  primary key (job_stage_id, profile_id),
  constraint job_stage_person_stage_fk foreign key (job_stage_id, org_id)
    references public.job_stage (id, org_id) on delete cascade
);
create index if not exists job_stage_person_profile_idx on public.job_stage_person (profile_id);

-- ── 3. jobs ─────────────────────────────────────────────────────────────────

alter table public.jobs
  add column if not exists template_id       uuid,
  add column if not exists ordered_by        uuid,
  add column if not exists impression_type   text,
  add column if not exists implant_count     int,
  add column if not exists production_method text,
  add column if not exists printed_model     boolean;

-- The default is set AFTER the column exists, so existing jobs keep a null
-- orderer (nobody knows who created them) instead of whoever runs this.
alter table public.jobs alter column ordered_by set default auth.uid();

alter table public.jobs drop constraint if exists jobs_template_fk;
alter table public.jobs add constraint jobs_template_fk foreign key (template_id, clinic_id)
  references public.workflow_template (id, org_id);
alter table public.jobs drop constraint if exists jobs_impression_type_valid;
alter table public.jobs add constraint jobs_impression_type_valid
  check (impression_type is null or impression_type in ('digital', 'conventional'));
alter table public.jobs drop constraint if exists jobs_implant_count_valid;
alter table public.jobs add constraint jobs_implant_count_valid
  check (implant_count is null or implant_count between 0 and 64);
alter table public.jobs drop constraint if exists jobs_production_method_valid;
alter table public.jobs add constraint jobs_production_method_valid
  check (production_method is null or production_method in ('print', 'mill'));

/**
 * The orderer is whoever created the job (§2.6a), and stays that. A signed-in
 * insert gets the caller, whatever it sent; a change later is refused. With no
 * signed-in user (the SQL editor, a service function) both are left alone.
 */
create or replace function public.guard_job_orderer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ordered_by := auth.uid();
  elsif new.ordered_by is distinct from old.ordered_by then
    raise exception 'The person who ordered a job cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_job_orderer() from public, anon, authenticated;

drop trigger if exists guard_job_orderer on public.jobs;
create trigger guard_job_orderer
  before insert or update of ordered_by on public.jobs
  for each row execute function public.guard_job_orderer();

-- What an edit of the new columns records (sql/114): the same function, with
-- them added. auditEdits.test.ts fails for a jobs column without a rule.
create or replace function public.audit_field_rules()
returns table (tbl text, col text, rule text)
language sql
immutable
set search_path = public
as $$
  values
    -- jobs: the work, the people, the dates, the links, the money
    ('jobs', 'too', 'value'), ('jobs', 'materjal', 'value'), ('jobs', 'varv', 'value'),
    ('jobs', 'kondivarv', 'value'), ('jobs', 'masina', 'value'), ('jobs', 'hambad', 'teeth'),
    ('jobs', 'kiirtoo', 'value'), ('jobs', 'mudel', 'value'), ('jobs', 'materjali_yhikud', 'value'),
    ('jobs', 'assigned_to', 'member'), ('jobs', 'designed_by', 'member'),
    ('jobs', 'kuupaev', 'value'), ('jobs', 'valmis_aeg', 'value'), ('jobs', 'valmis_kuupaev', 'value'),
    ('jobs', 'delivery_status', 'value'), ('jobs', 'delivered_at', 'value'),
    ('jobs', 'customer_id', 'value'), ('jobs', 'patient_id', 'value'),
    ('jobs', 'hind', 'value'), ('jobs', 'disain_hind', 'value'), ('jobs', 'makstud', 'value'),
    ('jobs', 'makse_kuupaev', 'value'), ('jobs', 'extras', 'value'), ('jobs', 'kulu_yle', 'value'),
    ('jobs', 'rev_hambad', 'teeth'), ('jobs', 'rev_varv', 'value'), ('jobs', 'uus_valmis', 'value'),
    ('jobs', 'status', 'stage'),
    -- jobs: typed by hand, so it could name someone
    ('jobs', 'patsient', 'changed'), ('jobs', 'kirjeldus', 'changed'), ('jobs', 'muudatused', 'changed'),
    ('jobs', 'customer_ref', 'changed'), ('jobs', 'print_id', 'changed'), ('jobs', 'disain_id', 'changed'),
    ('jobs', 'mudel_id', 'changed'), ('jobs', 'extra_costs', 'changed'), ('jobs', 'markused', 'notes'),
    ('jobs', 'work_items', 'items'), ('jobs', 'revisions', 'remakes'),
    -- jobs: the database's own, or with an entry of their own (delete, restore)
    ('jobs', 'id', 'skip'), ('jobs', 'clinic_id', 'skip'), ('jobs', 'job_code', 'skip'),
    ('jobs', 'created_at', 'skip'), ('jobs', 'updated_at', 'skip'),
    ('jobs', 'deleted_at', 'skip'), ('jobs', 'deleted_by', 'skip'),
    -- jobs: the template and the fields its rules read (sql/122). The orderer
    -- never changes (guard_job_orderer), so it has nothing to record.
    ('jobs', 'template_id', 'value'), ('jobs', 'impression_type', 'value'),
    ('jobs', 'implant_count', 'value'), ('jobs', 'production_method', 'value'),
    ('jobs', 'printed_model', 'value'), ('jobs', 'ordered_by', 'skip'),

    -- a work item (jobs.work_items[], and a remake's)
    ('work_item', 'too', 'value'), ('work_item', 'hambad', 'teeth'), ('work_item', 'bridge', 'value'),
    ('work_item', 'materjal', 'value'), ('work_item', 'masina', 'value'), ('work_item', 'implantaadid', 'teeth'),
    ('work_item', 'kruvi', 'value'), ('work_item', 'kruvid', 'value'), ('work_item', 'designed_by', 'member'),
    ('work_item', 'disain_hambad', 'teeth'), ('work_item', 'note', 'changed'), ('work_item', 'id', 'skip'),

    -- a remake (jobs.revisions[])
    ('remake', 'reasons', 'value'), ('remake', 'reason', 'value'), ('remake', 'hambad', 'teeth'),
    ('remake', 'purunenud_hambad', 'teeth'), ('remake', 'varv', 'value'), ('remake', 'kondivarv', 'value'),
    ('remake', 'materjal', 'value'), ('remake', 'deadline', 'value'), ('remake', 'price', 'value'),
    ('remake', 'kiirtoo', 'value'), ('remake', 'mudel', 'value'), ('remake', 'taspidev', 'value'),
    ('remake', 'uusi_tarvikuid', 'value'), ('remake', 'materjali_yhikud', 'value'),
    ('remake', 'assigned_to', 'member'), ('remake', 'designed_by', 'member'),
    ('remake', 'valmis_kuupaev', 'value'), ('remake', 'status', 'stage'), ('remake', 'work_items', 'items'),
    ('remake', 'note', 'changed'), ('remake', 'extra_costs', 'changed'), ('remake', 'print_id', 'changed'),
    ('remake', 'disain_id', 'changed'), ('remake', 'mudel_id', 'changed'),
    ('remake', 'id', 'skip'), ('remake', 'ts', 'skip'),

    -- patients: who they are is never recorded, only that it changed
    ('patients', 'turundusnousolek', 'value'),
    ('patients', 'nimi', 'changed'), ('patients', 'synniaeg', 'changed'), ('patients', 'telefon', 'changed'),
    ('patients', 'email', 'changed'), ('patients', 'arst', 'changed'), ('patients', 'kliinik', 'changed'),
    ('patients', 'ravikaart', 'changed'), ('patients', 'allergiad', 'changed'), ('patients', 'eelistused', 'changed'),
    ('patients', 'lougad', 'changed'), ('patients', 'markmed', 'changed'), ('patients', 'varvi_eelistus', 'changed'),
    ('patients', 'markused', 'notes'), ('patients', 'lougaliiges', 'changed'), ('patients', 'nousoleku_aeg', 'changed'),
    ('patients', 'id', 'skip'), ('patients', 'clinic_id', 'skip'),
    ('patients', 'created_at', 'skip'), ('patients', 'updated_at', 'skip'),

    -- the patient's own tooth chart
    ('patient_teeth', 'staatus', 'value'), ('patient_teeth', 'markus', 'changed'),
    ('patient_teeth', 'patient_id', 'skip'), ('patient_teeth', 'fdi', 'skip'), ('patient_teeth', 'updated_at', 'skip')
$$;
revoke execute on function public.audit_field_rules() from public, anon, authenticated;

-- ── 4. Two more file types ──────────────────────────────────────────────────

alter table public.job_file drop constraint if exists job_file_type_valid;
alter table public.job_file add constraint job_file_type_valid
  check (type in ('scan', 'photo', 'xray', 'print', 'design', 'other', 'ct', 'project'));

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
--
-- Templates hold no patient data. Anyone who works with jobs reads them (a
-- job is made from one); only "Manage stages" (pipeline.write, the same
-- permission as Settings → Stages) changes them. Child rows must belong to
-- the same clinic as their template (the composite keys above) and name only
-- people of that clinic.

alter table public.workflow_template enable row level security;
alter table public.workflow_template_stage enable row level security;
alter table public.workflow_template_stage_person enable row level security;
alter table public.clinic_stage_default enable row level security;
alter table public.job_stage enable row level security;
alter table public.job_stage_person enable row level security;

do $$
declare t text;
begin
  foreach t in array array['workflow_template', 'workflow_template_stage', 'workflow_template_stage_person', 'clinic_stage_default'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select using (
        org_id = public.my_org_id()
        and (public.has_perm('jobs.read') or public.has_perm('jobs.write') or public.has_perm('pipeline.write')))$p$,
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
  end loop;
end $$;

create policy "workflow_template_write" on public.workflow_template
  for all using (org_id = public.my_org_id() and public.has_perm('pipeline.write'))
  with check (org_id = public.my_org_id() and public.has_perm('pipeline.write'));
create policy "workflow_template_stage_write" on public.workflow_template_stage
  for all using (org_id = public.my_org_id() and public.has_perm('pipeline.write'))
  with check (org_id = public.my_org_id() and public.has_perm('pipeline.write'));
create policy "workflow_template_stage_person_write" on public.workflow_template_stage_person
  for all using (org_id = public.my_org_id() and public.has_perm('pipeline.write'))
  with check (org_id = public.my_org_id() and public.has_perm('pipeline.write')
              and public.profile_in_my_clinic(profile_id));
create policy "clinic_stage_default_write" on public.clinic_stage_default
  for all using (org_id = public.my_org_id() and public.has_perm('pipeline.write'))
  with check (org_id = public.my_org_id() and public.has_perm('pipeline.write')
              and public.profile_in_my_clinic(profile_id));

-- A job's stages: read with the job, written only by database functions.
drop policy if exists "job_stage_select" on public.job_stage;
create policy "job_stage_select" on public.job_stage
  for select using (org_id = public.my_org_id() and public.can_read_own_job(job_id));
drop policy if exists "job_stage_person_select" on public.job_stage_person;
create policy "job_stage_person_select" on public.job_stage_person
  for select using (
    org_id = public.my_org_id()
    and exists (select 1 from public.job_stage s where s.id = job_stage_id and public.can_read_own_job(s.job_id)));

-- ── 6. Backfill: a default template per clinic, and each job's stages ───────
--
-- The clinic's saved stages, in their order; a clinic that never saved any
-- uses the app's built-in list (src/renderer/src/config/pipeline.ts).

with stages as (
  select c.id as org_id, e ->> 'key' as stage_key, (ord - 1)::int as position
    from public.clinics c
    left join public.clinic_settings s on s.clinic_id = c.id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.pipeline_stages) = 'array' and jsonb_array_length(s.pipeline_stages) > 0
           then s.pipeline_stages
           else '[{"key":"disain"},{"key":"print"},{"key":"poleeri"},{"key":"puhasta"},{"key":"varvi"},{"key":"valmis"}]'::jsonb
      end) with ordinality as x(e, ord)
   where coalesce(btrim(e ->> 'key'), '') <> ''
), templates as (
  insert into public.workflow_template (org_id, name, is_default)
  select c.id, 'Default', true from public.clinics c
   where not exists (select 1 from public.workflow_template t where t.org_id = c.id and t.is_default)
  returning id, org_id
)
insert into public.workflow_template_stage (org_id, template_id, stage_key, position)
select distinct on (t.id, s.stage_key) s.org_id, t.id, s.stage_key, s.position
  from templates t join stages s on s.org_id = t.org_id
 order by t.id, s.stage_key, s.position;

-- An existing job is NOT updated: its template_id stays null, which means
-- the clinic's default template. Writing it would bump every job's
-- updated_at and put an edit in the audit log for each, for a change no
-- person made.
--
-- The job's stages: the default template's, and its current stage at the end
-- if the template does not have it (a stage since removed, a revision's stage).
insert into public.job_stage (org_id, job_id, stage_key, position)
select j.clinic_id, j.id, ts.stage_key, ts.position
  from public.jobs j
  join public.workflow_template t on t.org_id = j.clinic_id and t.is_default
  join public.workflow_template_stage ts on ts.template_id = coalesce(j.template_id, t.id)
 where not exists (select 1 from public.job_stage s where s.job_id = j.id)
on conflict (job_id, stage_key) do nothing;

insert into public.job_stage (org_id, job_id, stage_key, position)
select j.clinic_id, j.id, j.status,
       coalesce((select max(s.position) + 1 from public.job_stage s where s.job_id = j.id), 0)
  from public.jobs j
 where j.clinic_id is not null and coalesce(btrim(j.status), '') <> ''
   and not exists (select 1 from public.job_stage s where s.job_id = j.id and s.stage_key = j.status)
on conflict (job_id, stage_key) do nothing;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ============================================================================
-- Wivo — migration 124: a job's stage keeps its pay kind
-- Run AFTER sql/123. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- docs/WORKFLOW-STAGES.md §10: the people on a stage are paid for the stage's
-- pay kind (too, disain, mudel, muudatus) and split it equally. The pay kind
-- is set on the TEMPLATE's stage (workflow_template_stage.pay_role, sql/122).
-- This copies it onto the JOB's stage when the stage is made, for two reasons:
--
--   1. Copied, never referenced (§2.3). People on a job's stage are copied so
--      that changing a template never changes who did last month's work; the
--      pay kind is the other half of the same answer. Moving "Design" pay to
--      another stage in the template must not re-route pay for jobs already
--      made, paid or not.
--   2. Read with the job. job_stage is readable by whoever can read the job
--      (sql/122); the templates only with jobs.read, jobs.write or
--      pipeline.write. A technician on a stage without jobs.read, looking at
--      their own pay, would otherwise see it by the old rule.
--
-- How: job_stage.pay_role, filled by a BEFORE INSERT trigger from the job's
-- template (jobs.template_id, else the clinic's default template, as sql/123
-- does), by stage key. Every way a stage is made (a new job, create_job,
-- add_job_stage, the job's own status as a stage) goes through it, so no
-- function of sql/123 changes. A stage key the template does not have gets
-- no pay kind. A job has at most one stage per pay kind.
--
-- Existing job stages are filled the same way, once, below. The jobs of
-- sql/122's backfill have nobody on their stages and the default template has
-- no pay kinds, so they keep paying from assigned_to / designed_by exactly as
-- before; the app pays by stage only where a stage has both a pay kind and
-- people (shared/workflow/pay.ts).
--
-- No new table and no new rights: job_stage keeps its RLS (sql/122).
--
-- Tests: sql/test/jobStagePay.test.ts.
-- ============================================================================

set lock_timeout = '10s';

alter table public.job_stage add column if not exists pay_role text;

alter table public.job_stage drop constraint if exists job_stage_pay_role_valid;
alter table public.job_stage add constraint job_stage_pay_role_valid check (
  pay_role is null or pay_role in ('too', 'disain', 'mudel', 'muudatus'));

/**
 * A new job stage takes its pay kind from the job's template, by stage key.
 * A pay kind another stage of the job already has is not given twice.
 */
create or replace function public.job_stage_pay_role_from_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pay_role is null then
    select ts.pay_role into new.pay_role
      from public.jobs j
      join public.workflow_template_stage ts
        on ts.template_id = coalesce(j.template_id, public.default_template(new.org_id))
       and ts.org_id = new.org_id
       and ts.stage_key = new.stage_key
     where j.id = new.job_id
       and ts.pay_role is not null
     limit 1;
  end if;
  if new.pay_role is not null and exists (
       select 1 from public.job_stage s
        where s.job_id = new.job_id and s.pay_role = new.pay_role and s.id <> new.id) then
    new.pay_role := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.job_stage_pay_role_from_template() from public, anon, authenticated;

drop trigger if exists job_stage_pay_role on public.job_stage;
create trigger job_stage_pay_role before insert on public.job_stage
  for each row execute function public.job_stage_pay_role_from_template();

-- Existing stages, once: the same lookup. A job's template has each pay kind
-- on one stage at most (sql/122) and a job each stage key once, so no job gets
-- a pay kind twice.
update public.job_stage s
   set pay_role = ts.pay_role
  from public.jobs j, public.workflow_template_stage ts
 where j.id = s.job_id
   and ts.template_id = coalesce(j.template_id, public.default_template(s.org_id))
   and ts.org_id = s.org_id
   and ts.stage_key = s.stage_key
   and ts.pay_role is not null
   and s.pay_role is null;

-- One stage per pay kind on a job, held by the database as well.
create unique index if not exists job_stage_pay_role_once
  on public.job_stage (job_id, pay_role) where pay_role is not null;

select public.lock_anon_functions();

-- ============================================================================
-- Wivo — migration 082: the job code belongs to the database
-- Run AFTER sql/081. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- sql/070 numbered a new job only when the insert brought no code. The app
-- builds "Duplicate job" by spreading the existing job — which, once 070 is
-- applied, includes `job_code` — so the copy arrived with the ORIGINAL's code
-- and hit the unique index: duplicating failed in every app build released
-- before the fix that strips the field (commit c1022cc).
--
-- Fixed where it cannot be bypassed: on INSERT the code is always assigned
-- here, whatever the client sent; on UPDATE it never changes. Codes already
-- printed on case boxes stay exactly as they are.
-- ============================================================================

create or replace function public.set_job_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.job_code := case when new.clinic_id is not null
                         then public.next_job_code(new.clinic_id, coalesce(new.created_at, now())) end;
  elsif new.job_code is distinct from old.job_code then
    -- A job that had none (inserted before a clinic was set) gets one once.
    new.job_code := coalesce(old.job_code,
      case when new.clinic_id is not null then public.next_job_code(new.clinic_id, now()) end);
  end if;
  return new;
end;
$$;

drop trigger if exists set_job_code on public.jobs;
create trigger set_job_code before insert or update of job_code on public.jobs
  for each row execute function public.set_job_code();

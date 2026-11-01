-- ============================================================================
-- Wivo — migration 081: fixes from reviewing tonight's migrations
-- Run AFTER sql/080. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- 1. patient_export (074) built its file list in a temporary table inside a
--    SECURITY DEFINER function. That works, but a temp table per call is an
--    odd thing to ask of a pooled PostgREST connection. The same result in
--    one statement: a data-modifying CTE writes the grants, the query returns
--    the list, and the count for the audit row is taken first.
-- ============================================================================

create or replace function public.patient_export(p_patient uuid)
returns table (file_id uuid, job_id uuid, job_code text, type text, file_name text, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_n   int;
begin
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = v_org)
     or not public.has_perm('patients.read') then
    raise exception 'Patient not found' using errcode = '42501';
  end if;

  select count(*) into v_n
    from public.jobs j join public.job_file f on f.job_id = j.id
   where j.patient_id = p_patient and j.clinic_id = v_org
     and f.deleted_at is null and f.completed_at is not null and f.is_active;
  perform public.audit(v_org, 'export', 'patient:' || p_patient, jsonb_build_object('files', v_n));

  return query
    with files as (
      select f.id, j.id as job, j.job_code as code, f.type as ftype, f.file_name as fname, f.storage_path as path
        from public.jobs j join public.job_file f on f.job_id = j.id
       where j.patient_id = p_patient and j.clinic_id = v_org
         and f.deleted_at is null and f.completed_at is not null and f.is_active
    ), granted as (
      insert into public.file_download_grant (org_id, user_id, storage_path)
      select v_org, auth.uid(), path from files
      returning 1
    )
    select files.id, files.job, files.code, files.ftype, files.fname, files.path from files;
end;
$$;

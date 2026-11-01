-- ============================================================================
-- Wivo — migration 074: export for the patient
-- Run AFTER sql/073. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1 Files: "Export for the patient: a PDF (patient, jobs, treatment
-- plans) and a ZIP of their files. The download is logged."
--
-- One RPC answers "which files", grants each of them for two minutes, and
-- writes ONE `export` audit row naming the patient and how many files went.
-- The PDF is made on the client from data the user can already see.
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

  create temporary table if not exists pg_temp.export_files (
    file_id uuid, job_id uuid, job_code text, type text, file_name text, storage_path text
  ) on commit drop;
  delete from pg_temp.export_files;
  insert into pg_temp.export_files
  select f.id, j.id, j.job_code, f.type, f.file_name, f.storage_path
    from public.jobs j
    join public.job_file f on f.job_id = j.id
   where j.patient_id = p_patient and j.clinic_id = v_org
     and f.deleted_at is null and f.completed_at is not null and f.is_active;

  insert into public.file_download_grant (org_id, user_id, storage_path)
  select v_org, auth.uid(), e.storage_path from pg_temp.export_files e;

  select count(*) into v_n from pg_temp.export_files;
  perform public.audit(v_org, 'export', 'patient:' || p_patient, jsonb_build_object('files', v_n));

  return query select * from pg_temp.export_files;
end;
$$;

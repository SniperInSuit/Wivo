-- ============================================================================
-- Wivo — migration 088: a file's name, for the file-link Edge Function
-- Run AFTER sql/087. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
-- The function signs a download link for a file the caller was just allowed
-- to download (request_file_download, which also audits). It names the
-- download after the job code, so it asks for the name with the same rights.

create or replace function public.job_file_name(p_file uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.file_name from public.job_file f
   where f.id = p_file and f.deleted_at is null and public.may_read_job_files(f.job_id)
$$;

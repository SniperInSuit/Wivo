-- ============================================================================
-- Wivo — migration 073: file previews
-- Run AFTER sql/072. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1 Files: "Previews: a PNG from STL, thumbnails from photos."
--
-- Made on the uploader's computer (it has the bytes and a GPU) and stored next
-- to the file as `<file path>.preview.png`. A preview shows the same patient
-- work as the file, so it is reached the same way: through a grant, with an
-- audit row — one `view` per job opened, not one per thumbnail.
-- ============================================================================

alter table public.job_file
  add column if not exists preview_path text,
  add column if not exists preview_ready_at timestamptz;

/** The uploader reserves the preview slot for their file. Returns its path. */
create or replace function public.set_job_file_preview(p_file uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare f public.job_file;
begin
  select * into f from public.job_file where id = p_file and uploaded_by = auth.uid() and deleted_at is null;
  if f.id is null then
    raise exception 'File not found' using errcode = '42501';
  end if;
  update public.job_file set preview_path = f.storage_path || '.preview.png' where id = p_file
  returning preview_path into f.preview_path;
  return f.preview_path;
end;
$$;

/** Same idea as upload_slot_open: a reserved, unfilled preview slot of this user. */
create or replace function public.preview_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_file f
     where f.preview_path = p_path and f.uploaded_by = auth.uid()
       and f.preview_ready_at is null and f.deleted_at is null)
$$;

drop policy if exists "job_files_insert" on storage.objects;
create policy "job_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'job-files' and (public.upload_slot_open(name) or public.preview_slot_open(name))
  );

/** The preview is in Storage. */
create or replace function public.confirm_job_file_preview(p_file uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.job_file;
begin
  select * into f from public.job_file where id = p_file and uploaded_by = auth.uid();
  if f.id is null or f.preview_path is null
     or not exists (select 1 from storage.objects where bucket_id = 'job-files' and name = f.preview_path) then
    raise exception 'Preview not found' using errcode = '22023';
  end if;
  update public.job_file set preview_ready_at = coalesce(preview_ready_at, now()) where id = p_file;
end;
$$;

/**
 * Grants for every ready preview of a job's live files, and one `view` audit
 * row for the job. Returns which file each preview path belongs to.
 */
create or replace function public.request_job_previews(p_job uuid)
returns table (file_id uuid, preview_path text)
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if not public.may_read_job_files(p_job) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  select clinic_id into v_owner from public.jobs where id = p_job;
  insert into public.file_download_grant (org_id, user_id, storage_path)
  select public.my_org_id(), auth.uid(), f.preview_path
    from public.job_file f
   where f.job_id = p_job and f.deleted_at is null and f.preview_ready_at is not null;
  perform public.audit(v_owner, 'view', 'job:' || p_job, jsonb_build_object('previews', true, 'by_org', public.my_org_id()));
  return query
    select f.id, f.preview_path from public.job_file f
     where f.job_id = p_job and f.deleted_at is null and f.preview_ready_at is not null;
end;
$$;

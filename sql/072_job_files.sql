-- ============================================================================
-- Wivo — migration 072: job files
-- Run AFTER sql/071. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1 "Files", and the rules under "Rights and visibility":
--   - `job_file`: type (scan, photo, xray, print, design, other), version,
--     is_active, sha256, size, storage_path, uploaded_by, uploaded_at,
--     deleted_at. Stored at `org/job/file-id`; the file name becomes the job
--     code.
--   - Files are never really deleted: soft delete and versions.
--   - Storage follows the same rules as the rows. A partner uploads only
--     `print` and `design`, cannot delete, only upload a new version.
--   - Download goes through an RPC that makes a short-lived link AND an audit
--     row.
--
-- ── How "download only through the RPC" is enforced ─────────────────────────
-- A signed link is made by Storage, not by SQL, and Storage checks the
-- caller's SELECT rights on the object when it makes one. So the object's
-- SELECT policy does not ask "may you read this job" — it asks "did
-- `request_file_download` give you a grant for this object in the last two
-- minutes". That RPC checks the job rights, writes the audit row, then the
-- grant. No grant, no link: every download is in the audit log.
--
-- ── Upload order ────────────────────────────────────────────────────────────
-- 1. `register_job_file` checks the rights, numbers the version and returns the
--    path. 2. The client uploads to exactly that path (resumable, TUS).
-- 3. `confirm_job_file` marks it complete. The INSERT policy on objects only
-- accepts a path that was registered by the same user and not yet uploaded,
-- so nothing can be written anywhere else, and nothing can be overwritten.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('job-files', 'job-files', false, 524288000)  -- 500 MB: a full-arch scan set fits
on conflict (id) do nothing;

create table if not exists public.job_file (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  org_id           uuid not null references public.clinics(id) on delete cascade,  -- the job's owner
  type             text not null,
  version          int not null default 1,
  supersedes       uuid references public.job_file(id) on delete set null,
  is_active        boolean not null default true,
  sha256           text not null,
  size             bigint not null,
  mime_type        text,
  file_name        text not null,   -- the job-code name, never the original
  storage_path     text not null unique,
  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_org  uuid references public.clinics(id) on delete set null,
  uploaded_at      timestamptz not null default now(),
  completed_at     timestamptz,     -- set once the bytes are in Storage
  deleted_at       timestamptz,
  deleted_by       uuid references auth.users(id) on delete set null,
  constraint job_file_type_valid check (type in ('scan', 'photo', 'xray', 'print', 'design', 'other')),
  constraint job_file_sha256_valid check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint job_file_size_valid check (size >= 0)
);
create index if not exists job_file_job_idx on public.job_file (job_id) where deleted_at is null;

alter table public.job_file enable row level security;
drop policy if exists "job_file_select" on public.job_file;
create policy "job_file_select" on public.job_file
  for select using (org_id = public.my_org_id() and public.can_read_own_job(job_id));
-- Writes through the RPCs only. Partners read through partner_job_files().

/** Short-lived permission to fetch one object, written by request_file_download. */
create table if not exists public.file_download_grant (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.clinics(id) on delete cascade,  -- the downloader's
  user_id       uuid not null references auth.users(id) on delete cascade,
  storage_path  text not null,
  expires_at    timestamptz not null default now() + interval '2 minutes'
);
create index if not exists file_download_grant_lookup on public.file_download_grant (user_id, storage_path, expires_at);
alter table public.file_download_grant enable row level security;
drop policy if exists "file_download_grant_select" on public.file_download_grant;
create policy "file_download_grant_select" on public.file_download_grant
  for select using (user_id = auth.uid());

-- ── Rights ──────────────────────────────────────────────────────────────────

/** Read rights on a job's files: its own clinic, or a partner it is shared with. */
create or replace function public.may_read_job_files(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_own_job(p_job) or (public.my_share(p_job)).id is not null
$$;

/** Upload rights: own clinic with jobs.write (any type); an active partner, print/design only. */
create or replace function public.may_upload_job_file(p_job uuid, p_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.job_share;
begin
  if exists (select 1 from public.jobs where id = p_job and clinic_id = public.my_org_id())
     and public.has_perm('jobs.write') then
    return true;
  end if;
  s := public.my_share(p_job);
  return s.id is not null and public.share_is_active(s) and p_type in ('print', 'design');
end;
$$;

-- ── RPCs ────────────────────────────────────────────────────────────────────

/**
 * Step 1 of an upload. Returns the row: its id, version, the job-code file
 * name and the exact path the bytes must go to. `p_supersedes` makes this a
 * new version of that file; the old one stays, inactive.
 */
create or replace function public.register_job_file(
  p_job uuid,
  p_type text,
  p_sha256 text,
  p_size bigint,
  p_mime text,
  p_extension text,
  p_supersedes uuid default null
) returns public.job_file
language plpgsql
security definer
set search_path = public
as $$
declare
  j       public.jobs;
  prev    public.job_file;
  v_id    uuid := gen_random_uuid();
  v_ver   int := 1;
  v_ext   text := lower(regexp_replace(coalesce(p_extension, ''), '[^A-Za-z0-9]', '', 'g'));
  r       public.job_file;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not public.may_upload_job_file(p_job, p_type) then
    raise exception 'Not allowed to add this file to this job' using errcode = '42501';
  end if;
  if p_supersedes is not null then
    select * into prev from public.job_file where id = p_supersedes and job_id = p_job and deleted_at is null;
    if prev.id is null then
      raise exception 'The file to replace was not found' using errcode = '22023';
    end if;
    if prev.type <> p_type then
      raise exception 'A new version must have the same type' using errcode = '22023';
    end if;
    v_ver := prev.version + 1;
  end if;

  insert into public.job_file (id, job_id, org_id, type, version, supersedes, sha256, size, mime_type,
                               file_name, storage_path, uploaded_by, uploaded_by_org)
  values (v_id, p_job, j.clinic_id, p_type, v_ver, p_supersedes, lower(p_sha256), p_size, p_mime,
          coalesce(j.job_code, j.id::text) || '_' || p_type || '_v' || v_ver
            || case when v_ext <> '' then '.' || v_ext else '' end,
          j.clinic_id || '/' || p_job || '/' || v_id,
          auth.uid(), public.my_org_id())
  returning * into r;

  perform public.audit(j.clinic_id, 'upload', 'file:' || v_id,
    jsonb_build_object('job', p_job, 'type', p_type, 'version', v_ver, 'size', p_size, 'by_org', public.my_org_id()));
  if public.my_org_id() <> j.clinic_id then
    perform public.audit(public.my_org_id(), 'upload', 'file:' || v_id, jsonb_build_object('job', p_job));
  end if;
  return r;
end;
$$;

/** Step 3: the bytes are in Storage. The older version, if any, steps back. */
create or replace function public.confirm_job_file(p_file uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.job_file;
begin
  select * into f from public.job_file where id = p_file and uploaded_by = auth.uid();
  if f.id is null then
    raise exception 'File not found' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'job-files' and name = f.storage_path) then
    raise exception 'The upload has not finished' using errcode = '22023';
  end if;
  update public.job_file set completed_at = coalesce(completed_at, now()) where id = p_file;
  if f.supersedes is not null then
    update public.job_file set is_active = false where id = f.supersedes;
  end if;
end;
$$;

/** Soft delete. The owner clinic only — a partner can only add a new version. */
create or replace function public.delete_job_file(p_file uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.job_file;
begin
  select * into f from public.job_file where id = p_file;
  if f.id is null or f.org_id <> public.my_org_id() or not public.has_perm('jobs.write') then
    raise exception 'Not allowed to delete this file' using errcode = '42501';
  end if;
  update public.job_file set deleted_at = now(), deleted_by = auth.uid(), is_active = false where id = p_file;
end;
$$;

/**
 * The audited way to a download link: checks the job rights, writes the audit
 * row in both organisations' logs when a partner downloads, then a two-minute
 * grant. Returns the path to make the signed link for.
 */
create or replace function public.request_file_download(p_file uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare f public.job_file;
begin
  select * into f from public.job_file where id = p_file and deleted_at is null and completed_at is not null;
  if f.id is null or not public.may_read_job_files(f.job_id) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  perform public.audit(f.org_id, 'download', 'file:' || p_file,
    jsonb_build_object('job', f.job_id, 'by_org', public.my_org_id()));
  if public.my_org_id() <> f.org_id then
    perform public.audit(public.my_org_id(), 'download', 'file:' || p_file, jsonb_build_object('job', f.job_id));
  end if;
  insert into public.file_download_grant (org_id, user_id, storage_path)
  values (public.my_org_id(), auth.uid(), f.storage_path);
  return f.storage_path;
end;
$$;

/** A job's files as either side may list them. Deleted ones are not listed. */
create or replace function public.job_files(p_job uuid)
returns table (id uuid, type text, version int, is_active boolean, file_name text, size bigint,
               mime_type text, sha256 text, uploaded_at timestamptz, uploaded_by_name text,
               uploaded_by_org_name text, supersedes uuid, completed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.may_read_job_files(p_job) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  return query
    select f.id, f.type, f.version, f.is_active, f.file_name, f.size, f.mime_type, f.sha256, f.uploaded_at,
           p.full_name, c.name, f.supersedes, f.completed_at is not null
      from public.job_file f
      left join public.profiles p on p.id = f.uploaded_by
      left join public.clinics c on c.id = f.uploaded_by_org
     where f.job_id = p_job and f.deleted_at is null
     order by f.type, f.uploaded_at desc;
end;
$$;

-- ── Storage policies on the bucket ──────────────────────────────────────────

/**
 * Is `p_path` a slot this user registered and has not filled yet? SECURITY
 * DEFINER because a partner uploads to a path under the OWNER's organisation,
 * and `job_file`'s own policy (rightly) hides the owner's rows from partners.
 */
create or replace function public.upload_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_file f
     where f.storage_path = p_path and f.uploaded_by = auth.uid()
       and f.completed_at is null and f.deleted_at is null)
$$;

drop policy if exists "job_files_insert" on storage.objects;
create policy "job_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'job-files' and public.upload_slot_open(name)
  );

drop policy if exists "job_files_select" on storage.objects;
create policy "job_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'job-files'
    and exists (
      select 1 from public.file_download_grant g
       where g.storage_path = storage.objects.name and g.user_id = auth.uid() and g.expires_at > now())
  );
-- No UPDATE and no DELETE policy: an object, once written, is never replaced
-- or removed through the API. A new version is a new object.

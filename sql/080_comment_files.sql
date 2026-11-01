-- ============================================================================
-- Wivo — migration 080: a file on a comment
-- Run AFTER sql/079. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 1: "comments and questions on the job, on top of chat; photos in
-- the thread for change proposals" (job_comment: …, body, file_id, …).
--
-- A comment may point at ONE file of the same job. The file is uploaded the
-- normal way first (sql/072 rules: a partner adds print/design only), so a
-- comment can never be a side door for a file type someone may not add, or
-- for a file of another job.
-- ============================================================================

alter table public.messages
  add column if not exists file_id uuid references public.job_file(id) on delete set null;

drop function if exists public.post_job_comment(uuid, text, boolean);
create or replace function public.post_job_comment(
  p_job uuid,
  p_body text,
  p_is_question boolean default false,
  p_file uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.may_use_job_thread(p_job, true) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' and p_file is null then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  if p_file is not null and not exists (
    select 1 from public.job_file f where f.id = p_file and f.job_id = p_job and f.deleted_at is null) then
    raise exception 'That file is not on this job' using errcode = '22023';
  end if;
  insert into public.messages (channel_id, author_id, body, is_question, file_id)
  values (public.job_channel(p_job), auth.uid(), coalesce(nullif(btrim(p_body), ''), '📎'), coalesce(p_is_question, false), p_file)
  returning id into v_id;
  if p_is_question then
    perform public.audit((select clinic_id from public.jobs where id = p_job), 'question', 'job:' || p_job,
      jsonb_build_object('message', v_id));
  end if;
  return v_id;
end;
$$;

drop function if exists public.job_thread(uuid);
create or replace function public.job_thread(p_job uuid)
returns table (id uuid, body text, author_id uuid, author_name text, author_org text,
               is_question boolean, resolved_at timestamptz, created_at timestamptz, edited_at timestamptz,
               mine boolean, file_id uuid, file_name text, file_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.may_use_job_thread(p_job, false) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  return query
    select m.id, case when m.deleted_at is null then m.body else '' end, m.author_id,
           pr.full_name, c.name, m.is_question, m.resolved_at, m.created_at, m.edited_at,
           m.author_id = auth.uid(),
           f.id, f.file_name, f.type
      from public.messages m
      join public.channels ch on ch.id = m.channel_id
      left join public.profiles pr on pr.id = m.author_id
      left join public.clinics c on c.id = pr.clinic_id
      left join public.job_file f on f.id = m.file_id and f.deleted_at is null
     where ch.job_id = p_job
     order by m.created_at;
end;
$$;

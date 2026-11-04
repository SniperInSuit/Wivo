-- ============================================================================
-- Wivo — migration 115: who made each change survives their account
-- Run AFTER sql/114. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- An audit row named its author only through audit_log.user_id, a foreign
-- key to the sign-in account with ON DELETE SET NULL (sql/070, restored by
-- sql/107). Deleting an account (Team → "Delete account permanently", or the
-- Supabase dashboard) emptied it in every entry the person ever made, and the
-- screen then read them as "System". For medical records the trail of who
-- changed what must outlive the account. Now (docs/AUDIT.md §2.7):
--
-- 1. The foreign key is gone. user_id keeps the author's id for good; nothing
--    can empty it. (sql/107 restores keys from a fixed list: do not run it
--    again, or it puts this one back. schema_check.sql names it.)
-- 2. actor_name: the author's name AS IT WAS, written with the row by a
--    trigger, from every writer (audit() and record_mfa_factors alike).
-- 3. detail.names: the names of the other people an entry names, as they
--    were — a job's technician and designer (and a work item's, a
--    remake's), the member whose permissions or role changed.
-- 4. Append-only without exception: no update at all. A deleted clinic still
--    takes its own entries.
-- 5. ONE-TIME FILL of actor_name on the rows written before this, from each
--    author's profile now: the one sanctioned write to stored rows, the
--    append-only trigger off for that single statement, nothing but the
--    empty actor_name filled. A renamed member's older entries may therefore
--    show the later name. Rows whose author was deleted before this have no
--    id left and stay without a name.
-- 6. audit_search returns the stored name (and, new, the author's id, so the
--    screen tells "former member" from "System"); audit_entries the stored
--    name; audit_people lists everyone in the log, deleted members too.
--
-- No new table. Tests: sql/test/auditActorNames.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. The author's id stays ────────────────────────────────────────────────

alter table public.audit_log drop constraint if exists audit_log_user_id_fkey;

-- ── 2. The author's name, as it was ─────────────────────────────────────────

alter table public.audit_log add column if not exists actor_name text;

/** A member's name as the log keeps it: their full name, else their username. */
create or replace function public.audit_person_name(p_user uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(username), ''))
    from public.profiles where id = p_user
$$;

/**
 * Every new row: its author's name, and the names of the people it names
 * (an object 'user:<id>'; any assigned_to / designed_by in the detail), as
 * they are now. Written here, not by each writer, so no writer can leave
 * them out or put in another.
 */
create or replace function public.audit_log_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_names jsonb;
begin
  new.actor_name := public.audit_person_name(new.user_id);
  -- The names are a help to the reader, never a reason to lose the entry.
  begin
    select jsonb_object_agg(s.id, s.name) into v_names
      from (select distinct i.id,
                   case when i.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then public.audit_person_name(i.id::uuid) end as name
              from (select substr(new.object, 6) as id where new.object like 'user:%'
                    union all
                    select v #>> '{}' from jsonb_path_query(new.detail, 'lax $.**.assigned_to.*') v
                    union all
                    select v #>> '{}' from jsonb_path_query(new.detail, 'lax $.**.designed_by.*') v) i) s
     where s.name is not null;
  exception when others then
    v_names := null;
  end;
  if v_names is not null then
    new.detail := new.detail || jsonb_build_object('names', v_names);
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_names on public.audit_log;
create trigger audit_log_names before insert on public.audit_log
  for each row execute function public.audit_log_names();

-- ── 4. Append-only without exception ────────────────────────────────────────

/** Nothing rewrites history. Only a deleted clinic takes its own entries (pg_trigger_depth() > 1: the foreign key's cascade). */
create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

-- ── 5. The one-time fill ────────────────────────────────────────────────────

-- One statement: the trigger is off only inside it, and back on before it
-- ends. If anything fails, all of it is undone, the trigger included.
do $$
declare
  n int;
begin
  alter table public.audit_log disable trigger audit_log_append_only;
  update public.audit_log a
     set actor_name = public.audit_person_name(a.user_id)
   where a.actor_name is null and a.user_id is not null
     and public.audit_person_name(a.user_id) is not null;
  get diagnostics n = row_count;
  alter table public.audit_log enable trigger audit_log_append_only;
  raise notice '115: names filled on % earlier entr%', n, case when n = 1 then 'y' else 'ies' end;
end $$;

-- ── 6. Reading ──────────────────────────────────────────────────────────────

-- audit_search gains a column (the author's id), so it is dropped and made
-- again (sql/103's pattern).
drop function if exists public.audit_search(uuid, text, text, timestamptz, timestamptz, timestamptz, bigint, int);

create function public.audit_search(
  p_user        uuid        default null,
  p_action      text        default null,
  p_job_code    text        default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_before_at   timestamptz default null,
  p_before_id   bigint      default null,
  p_limit       int         default 50
) returns table (id bigint, at timestamptz, user_name text, action text, object text, job_code text, detail jsonb, user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.my_org_id();
  v_code text := nullif(public.job_code_key(p_job_code), '');
begin
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if v_org is null or not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, coalesce(a.actor_name, p.full_name), a.action, a.object,
           case when a.object like 'job:%' then (select j.job_code from public.jobs j where j.id::text = substr(a.object, 5)) end,
           a.detail, a.user_id
      from public.audit_log a
      left join public.profiles p on p.id = a.user_id
     where a.org_id = v_org
       and (p_user is null or a.user_id = p_user)
       and (p_action is null or a.action = p_action
            or (p_action = 'stage_move' and a.action = 'edit'
                and (a.detail @? '$.changes.status' or a.detail @? '$.remakes[*].changes.status')))
       and (p_from is null or a.at >= p_from)
       and (p_to is null or a.at < p_to)
       and (p_before_at is null or (a.at, a.id) < (p_before_at, coalesce(p_before_id, 9223372036854775807)))
       and (v_code is null or a.object in (
             select 'job:' || j.id from public.jobs j
              where position(v_code in public.job_code_key(j.job_code)) > 0))
     order by a.at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 1000);
end;
$$;

revoke execute on function public.audit_search(uuid, text, text, timestamptz, timestamptz, timestamptz, bigint, int) from public, anon;
grant execute on function public.audit_search(uuid, text, text, timestamptz, timestamptz, timestamptz, bigint, int) to authenticated;

/** sql/078, for older app builds: the stored name too. */
create or replace function public.audit_entries(
  p_limit int default 200,
  p_action text default null,
  p_before timestamptz default null
) returns table (id bigint, at timestamptz, user_name text, action text, object text, job_code text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, coalesce(a.actor_name, p.full_name), a.action, a.object,
           case when a.object like 'job:%' then (select j.job_code from public.jobs j where j.id::text = substr(a.object, 5)) end,
           a.detail
      from public.audit_log a
      left join public.profiles p on p.id = a.user_id
     where a.org_id = public.my_org_id()
       and (p_action is null or a.action = p_action)
       and (p_before is null or a.at < p_before)
     order by a.at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

/** sql/105: everyone in the log, deleted members too, by the name their latest entry keeps. */
create or replace function public.audit_people()
returns table (user_id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if not public.has_mfa() then
    raise exception 'Sign in with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if v_org is null or not public.is_org_admin() then
    raise exception 'Only an organisation admin can read the audit log' using errcode = '42501';
  end if;
  return query
    select u.user_id, u.name from (
      select distinct on (a.user_id) a.user_id, coalesce(a.actor_name, p.full_name, '') as name
        from public.audit_log a
        left join public.profiles p on p.id = a.user_id
       where a.org_id = v_org and a.user_id is not null
       order by a.user_id, a.at desc, a.id desc
    ) u
    order by 2, 1;
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────

revoke execute on function public.audit_person_name(uuid) from public, anon, authenticated;
revoke execute on function public.audit_log_names() from public, anon, authenticated;

select public.lock_anon_functions();

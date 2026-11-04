-- ============================================================================
-- Wivo — migration 114: the audit log records edits (docs/AUDIT.md)
-- Run AFTER sql/113. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Until now the log recorded what happens AROUND a job (opening it, its
-- stage, sharing, files, exports, deleting), never a change to the job or
-- the patient itself: adding teeth left no trace. Now:
--
-- 1. audit_log is append-only for everyone. No API role (anon,
--    authenticated, service_role) may insert, update, delete or truncate it;
--    entries are written only by audit(), inside other functions. The
--    trigger refuses an update or delete even from the SQL Editor, except
--    the two the database does itself: a deleted account's user_id set to
--    null, and a deleted clinic's entries removed with it.
-- 2. New actions: create, edit, permission, file_deleted.
-- 3. audit_field_rules(): for every column of jobs, patients and
--    patient_teeth (and every key of a work item and a remake), whether a
--    change is recorded old → new, only as "changed", or not at all. A
--    column or key it does not name is "changed": its content never enters
--    the log by accident. sql/test/auditEdits.test.ts fails for a column
--    the rules do not name.
-- 4. Triggers, one entry per save, none when nothing changed:
--      jobs           create; edit (fields, work items, remakes)
--      patients       create; edit (field names only, consent old → new); delete
--      patient_teeth  edit, under the patient (one per tooth, as clicked)
--      worker_permissions  permission: granted / removed, one per member per save
--      profiles       permission: a member's role changed
--    A job by its code, a patient by id: never a name. Only what a
--    signed-in person does; nothing that cascades from another change.
-- 5. delete_job_file records file_deleted under the job (never the file name).
-- 6. A stage changed in the same save as other fields is part of that edit
--    entry; a stage alone stays a stage_move, as today. The stage moves of
--    move_job_stage / move_revision_stage are marked, so their write is not
--    recorded twice. audit_search's "stage_move" also finds edits with a stage.
--
-- No new table. Tests: sql/test/auditEdits.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. Append-only for everyone ─────────────────────────────────────────────

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;
revoke usage, update on sequence public.audit_log_id_seq from anon, authenticated, service_role;

/**
 * Nothing rewrites or removes history. Only the database's own cascades get
 * through (pg_trigger_depth() > 1: run by a foreign key's action): deleting
 * an account sets its entries' user_id to null and nothing else; deleting a
 * clinic removes its entries.
 */
create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1
       and new.user_id is null and old.user_id is not null
       and new.id = old.id and new.org_id = old.org_id and new.action = old.action
       and new.object = old.object and new.detail = old.detail and new.at = old.at then
      return new;
    end if;
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create or replace function public.audit_log_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_no_truncate();

-- ── 2. The new actions ──────────────────────────────────────────────────────

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted'));

-- ── 3. The rules ────────────────────────────────────────────────────────────

/**
 * What a change records, per column (or key of a work item / remake):
 *   value    old → new
 *   teeth    old → new, compared as a set of tooth numbers
 *   member   old → new; a work item's or remake's absent key is 'job' (whoever is on the job)
 *   stage    old → new, with the job's or remake's own rules (section 4)
 *   notes    "added" or "changed", never the text
 *   changed  only that it changed
 *   items    a job's work items, each compared by these rules
 *   remakes  a job's remakes, each compared by these rules
 *   skip     not recorded
 */
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

/**
 * A value as it is compared and shown: text, blanks and empties as null,
 * numbers without trailing zeros, lists and objects in a fixed order (so
 * reordering is no change). An extra or extra cost reads "name price".
 */
create or replace function public.audit_value(p jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if p is null then
    return null;
  end if;
  case jsonb_typeof(p)
    when 'null' then return null;
    when 'string' then v := btrim(p #>> '{}');
    when 'number' then v := trim_scale((p #>> '{}')::numeric)::text;
    when 'boolean' then v := p #>> '{}';
    when 'array' then
      select string_agg(x, ', ' order by x) into v
        from (select public.audit_value(e) as x from jsonb_array_elements(p) e) s where x is not null;
    else
      if p ? 'nimi' then
        v := concat_ws(' ', public.audit_value(p -> 'nimi'), public.audit_value(coalesce(p -> 'hind', p -> 'summa')));
      else
        select string_agg(k || ': ' || x, ', ' order by k) into v
          from (select key as k, public.audit_value(value) as x from jsonb_each(p)) s where x is not null;
      end if;
  end case;
  return nullif(v, '');
end;
$$;

/** Tooth numbers "21, 11,11" → "11,21". */
create or replace function public.audit_teeth(p jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(string_agg(distinct t, ',' order by t), '')
    from (select btrim(x) as t
            from unnest(string_to_array(coalesce(case when jsonb_typeof(p) = 'string' then p #>> '{}' end, ''), ',')) x) s
   where t <> ''
$$;

/** One field's change by its rule, or null when it did not change. */
create or replace function public.audit_field_change(p_rule text, p_old jsonb, p_new jsonb, p_has_old boolean, p_has_new boolean)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  o text;
  n text;
begin
  if p_rule = 'teeth' then
    o := public.audit_teeth(p_old); n := public.audit_teeth(p_new);
  elsif p_rule = 'member' then
    o := case when p_has_old then public.audit_value(p_old) else 'job' end;
    n := case when p_has_new then public.audit_value(p_new) else 'job' end;
  else
    o := public.audit_value(p_old); n := public.audit_value(p_new);
  end if;
  -- Unticked and never ticked are the same.
  if coalesce(nullif(o, 'false'), '') = coalesce(nullif(n, 'false'), '') then
    return null;
  end if;
  if p_rule in ('changed') then
    return '"changed"'::jsonb;
  end if;
  if p_rule = 'notes' then
    return to_jsonb(case when jsonb_array_length(case when jsonb_typeof(p_new) = 'array' then p_new else '[]' end)
                            > jsonb_array_length(case when jsonb_typeof(p_old) = 'array' then p_old else '[]' end)
                         then 'added' else 'changed' end);
  end if;
  return jsonb_build_object('old', left(o, 120), 'new', left(n, 120));
end;
$$;

/**
 * Every change between two versions of a row (or a work item / remake), by
 * the rules of `p_kind`; '{}' when nothing changed. The rules 'items' and
 * 'remakes' are left to the caller; 'stage' is included.
 */
create or replace function public.audit_changes(p_kind text, p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  o jsonb := case when jsonb_typeof(p_old) = 'object' then p_old else '{}' end;
  n jsonb := case when jsonb_typeof(p_new) = 'object' then p_new else '{}' end;
  r record;
  v jsonb;
  v_out jsonb := '{}';
begin
  for r in
    select k.key, coalesce(fr.rule, 'changed') as rule
      from (select jsonb_object_keys(o) as key union select jsonb_object_keys(n)) k
      left join public.audit_field_rules() fr on fr.tbl = p_kind and fr.col = k.key
  loop
    continue when r.rule in ('skip', 'items', 'remakes');
    v := public.audit_field_change(r.rule, o -> r.key, n -> r.key, o ? r.key, n ? r.key);
    if v is not null then
      v_out := v_out || jsonb_build_object(r.key, v);
    end if;
  end loop;
  return v_out;
end;
$$;

/**
 * A job's work items or remakes, matched by id: what was added, removed or
 * changed. A work item is named by its work type and teeth, a remake by its
 * number. A remake's stage moved through move_revision_stage is recorded by
 * that move (sql/087); moved in the remake's form, it is part of the edit,
 * and the finished date stamped with it belongs to the move.
 */
create or replace function public.audit_list_changes(p_kind text, p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  o jsonb := case when jsonb_typeof(p_old) = 'array' then p_old else '[]' end;
  n jsonb := case when jsonb_typeof(p_new) = 'array' then p_new else '[]' end;
  v_out jsonb := '[]';
  r record;
  v_prev jsonb;
  v_ch jsonb;
  v_items jsonb;
begin
  for r in
    select e, ord::int as ord, coalesce(e ->> 'id', 'pos:' || ord) as key
      from jsonb_array_elements(n) with ordinality t(e, ord)
  loop
    select e into v_prev
      from jsonb_array_elements(o) with ordinality t(e, ord)
     where coalesce(e ->> 'id', 'pos:' || ord) = r.key
     limit 1;
    if v_prev is null then
      v_out := v_out || jsonb_build_array(public.audit_list_label(p_kind, r.e, r.ord) || '{"change": "added"}');
      continue;
    end if;
    v_ch := public.audit_changes(p_kind, v_prev, r.e);
    if p_kind = 'remake' then
      if v_ch ? 'status' and coalesce(v_prev ->> 'valmis_kuupaev', '') = '' then
        v_ch := v_ch - 'valmis_kuupaev';
      end if;
      v_items := public.audit_list_changes('work_item', v_prev -> 'work_items', r.e -> 'work_items');
      if v_items <> '[]' then
        v_ch := v_ch || jsonb_build_object('work_items', v_items);
      end if;
    end if;
    if v_ch <> '{}' then
      v_out := v_out || jsonb_build_array(public.audit_list_label(p_kind, r.e, r.ord) || jsonb_build_object('changes', v_ch));
    end if;
  end loop;

  for r in
    select e, ord::int as ord, coalesce(e ->> 'id', 'pos:' || ord) as key
      from jsonb_array_elements(o) with ordinality t(e, ord)
  loop
    if not exists (select 1 from jsonb_array_elements(n) with ordinality t(e, ord)
                    where coalesce(e ->> 'id', 'pos:' || ord) = r.key) then
      v_out := v_out || jsonb_build_array(public.audit_list_label(p_kind, r.e, r.ord) || '{"change": "removed"}');
    end if;
  end loop;
  return v_out;
end;
$$;

/** {"item": "Kroon 11,21"} for a work item, {"remake": 2} for a remake. */
create or replace function public.audit_list_label(p_kind text, p_elem jsonb, p_ord int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_kind = 'remake' then jsonb_build_object('remake', p_ord)
              else jsonb_build_object('item', left(concat_ws(' ', public.audit_value(p_elem -> 'too'),
                                                                   public.audit_teeth(p_elem -> 'hambad')), 120))
         end
$$;

/**
 * A job's edit: { changes, work_items, remakes }, or null when nothing the
 * log records changed. The stage is included only alongside another change
 * (alone, it is a stage_move); the finished date stamped by a move to the
 * done stage belongs to that move.
 */
create or replace function public.audit_job_diff(p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_changes jsonb := public.audit_changes('jobs', p_old, p_new);
  v_stage   jsonb := v_changes -> 'status';
  v_items   jsonb := public.audit_list_changes('work_item', p_old -> 'work_items', p_new -> 'work_items');
  v_remakes jsonb := public.audit_list_changes('remake', p_old -> 'revisions', p_new -> 'revisions');
  v_out     jsonb := '{}';
begin
  v_changes := v_changes - 'status';
  if v_stage is not null and coalesce(p_old ->> 'valmis_kuupaev', '') = '' then
    v_changes := v_changes - 'valmis_kuupaev';
  end if;
  if v_changes = '{}' and v_items = '[]' and v_remakes = '[]' then
    return null;
  end if;
  if v_stage is not null then
    v_changes := v_changes || jsonb_build_object('status', v_stage);
  end if;
  if v_changes <> '{}' then v_out := v_out || jsonb_build_object('changes', v_changes); end if;
  if v_items <> '[]' then v_out := v_out || jsonb_build_object('work_items', v_items); end if;
  if v_remakes <> '[]' then v_out := v_out || jsonb_build_object('remakes', v_remakes); end if;
  return v_out;
end;
$$;

-- ── 4. Jobs ─────────────────────────────────────────────────────────────────

/**
 * Only what a signed-in person does, and not what cascades from another
 * change (a patient deleted unlinks their jobs; a delete is an update of
 * deleted_at): those have entries of their own. A stage moved by
 * move_job_stage / move_revision_stage is recorded by them.
 */
create or replace function public.audit_job_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
  v_new    jsonb;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or new.clinic_id is null
     or current_setting('wivo.stage_move_checked', true) = 'yes' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.audit(new.clinic_id, 'create', 'job:' || new.id, jsonb_build_object('job_code', new.job_code));
    return null;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    return null;
  end if;
  -- A link emptied because the patient, client or member it named was
  -- deleted (on delete set null) is that deletion's entry, not this job's
  -- edit. Those run after the delete, so pg_trigger_depth() does not tell.
  v_new := to_jsonb(new);
  if old.patient_id is not null and new.patient_id is null
     and not exists (select 1 from public.patients where id = old.patient_id) then
    v_new := v_new || jsonb_build_object('patient_id', old.patient_id);
  end if;
  if old.customer_id is not null and new.customer_id is null
     and not exists (select 1 from public.customers where id = old.customer_id) then
    v_new := v_new || jsonb_build_object('customer_id', old.customer_id);
  end if;
  if old.assigned_to is not null and new.assigned_to is null
     and not exists (select 1 from public.profiles where id = old.assigned_to) then
    v_new := v_new || jsonb_build_object('assigned_to', old.assigned_to);
  end if;
  if old.designed_by is not null and new.designed_by is null
     and not exists (select 1 from public.profiles where id = old.designed_by) then
    v_new := v_new || jsonb_build_object('designed_by', old.designed_by);
  end if;
  -- Data the comparison cannot read never blocks the save: the edit is
  -- still recorded, without its details.
  begin
    v_detail := public.audit_job_diff(to_jsonb(old), v_new);
  exception when others then
    v_detail := '{"unreadable": true}';
  end;
  if v_detail is not null then
    perform public.audit(new.clinic_id, 'edit', 'job:' || new.id, jsonb_build_object('job_code', new.job_code) || v_detail);
  end if;
  return null;
end;
$$;

drop trigger if exists audit_job_change on public.jobs;
create trigger audit_job_change after insert or update on public.jobs
  for each row execute function public.audit_job_change();

/**
 * sql/078, and: a stage changed in the same save as other fields is part of
 * that save's edit entry (audit_job_change), not an entry of its own.
 */
create or replace function public.guard_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other boolean;
begin
  if auth.uid() is null or new.status is not distinct from old.status
     or current_setting('wivo.stage_move_checked', true) = 'yes' then
    return new;
  end if;
  if not public.stage_move_allowed(new.clinic_id, old.status, new.status, 'owner') then
    raise exception 'Moving from % to % is not allowed', old.status, new.status using errcode = '42501';
  end if;
  begin
    v_other := public.audit_job_diff(to_jsonb(old), to_jsonb(new)) is not null;
  exception when others then
    v_other := true;  -- audit_job_change records the save as unreadable
  end;
  if not v_other then
    perform public.audit(new.clinic_id, 'stage_move', 'job:' || new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

/** sql/087, and its write is marked as a stage move (as move_job_stage's), so it is not also an edit. */
create or replace function public.move_revision_stage(p_job uuid, p_revision text, p_to text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.my_org_id();
  v_owner uuid;
  j       public.jobs;
  s       public.job_share;
  v_idx   int;
  v_rev   jsonb;
  v_from  text;
  v_order text[];
  sh      record;
begin
  select clinic_id into v_owner from public.jobs where id = p_job;
  if v_owner is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if v_owner = v_org then
    if not public.has_perm('jobs.write') then
      raise exception 'No permission to move jobs' using errcode = '42501';
    end if;
  else
    s := public.my_share(p_job);
    if s.id is null then
      raise exception 'Job not found' using errcode = '42501';
    end if;
    if not public.has_perm('jobs.write') then
      raise exception 'No permission to move jobs' using errcode = '42501';
    end if;
    if not public.share_is_active(s) then
      raise exception 'The partnership is not active' using errcode = '42501';
    end if;
  end if;

  select * into j from public.jobs where id = p_job for update;
  select (t.ord - 1)::int, t.elem into v_idx, v_rev
    from jsonb_array_elements(case when jsonb_typeof(j.revisions) = 'array' then j.revisions else '[]'::jsonb end)
         with ordinality as t(elem, ord)
   where t.elem ->> 'id' = p_revision;
  if v_idx is null then
    raise exception 'Revision not found' using errcode = '22023';
  end if;

  v_order := public.stage_order(v_owner);
  v_from := coalesce(nullif(v_rev ->> 'status', ''), v_order[1]);
  if v_from = p_to then
    return p_to;
  end if;
  if not (p_to = any(v_order)) then
    raise exception 'Unknown stage %', p_to using errcode = '22023';
  end if;
  if v_owner = v_org then
    if not public.stage_move_allowed(v_org, v_from, p_to, 'owner') then
      raise exception 'Moving from % to % is not allowed', v_from, p_to using errcode = '42501';
    end if;
  else
    if not (v_from = any(s.assigned_stages)) then
      raise exception 'Stage % is not yours to move', v_from using errcode = '42501';
    end if;
    if not public.stage_move_allowed(v_owner, v_from, p_to, 'partner') then
      raise exception 'Moving from % to % is not allowed', v_from, p_to using errcode = '42501';
    end if;
  end if;

  v_rev := jsonb_set(v_rev, '{status}', to_jsonb(p_to));
  -- Stamped once, on the way into the done stage — the board's rule.
  if p_to = v_order[array_length(v_order, 1)] and coalesce(v_rev ->> 'valmis_kuupaev', '') = '' then
    v_rev := jsonb_set(v_rev, '{valmis_kuupaev}', to_jsonb(current_date::text));
  end if;
  perform set_config('wivo.stage_move_checked', 'yes', true);
  update public.jobs set revisions = jsonb_set(revisions, array[v_idx::text], v_rev), updated_at = now()
   where id = p_job;
  perform set_config('wivo.stage_move_checked', '', true);

  perform public.audit(v_owner, 'stage_move', 'job:' || p_job,
    jsonb_build_object('revision', p_revision, 'from', v_from, 'to', p_to, 'by_org', v_org));
  if v_org <> v_owner then
    perform public.audit(v_org, 'stage_move', 'job:' || p_job,
      jsonb_build_object('revision', p_revision, 'from', v_from, 'to', p_to));
  end if;

  -- Tell the other side when the revision crosses into or out of a partner's stages.
  for sh in
    select js.partner_org, js.assigned_stages from public.job_share js
      join public.partnership p on p.id = js.partnership_id
     where js.job_id = p_job and js.revoked_at is null and p.status = 'active'
  loop
    if v_from = any(sh.assigned_stages) and not (p_to = any(sh.assigned_stages)) then
      perform public.notify_org(v_owner, p_job, 'stage_handover',
        jsonb_build_object('revision', p_revision, 'from', v_from, 'to', p_to));
    elsif p_to = any(sh.assigned_stages) and not (v_from = any(sh.assigned_stages)) then
      perform public.notify_org(sh.partner_org, p_job, 'stage_handover',
        jsonb_build_object('revision', p_revision, 'from', v_from, 'to', p_to));
    end if;
  end loop;
  return p_to;
end;
$$;

-- ── 5. Patients and their tooth chart ───────────────────────────────────────

/** Created, deleted, or which fields changed: never what they say (consent excepted). */
create or replace function public.audit_patient_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.clinic_id is not null then
      perform public.audit(new.clinic_id, 'create', 'patient:' || new.id, '{}'::jsonb);
    end if;
  elsif tg_op = 'DELETE' then
    if old.clinic_id is not null then
      perform public.audit(old.clinic_id, 'delete', 'patient:' || old.id, '{}'::jsonb);
    end if;
  elsif new.clinic_id is not null then
    begin
      v_changes := public.audit_changes('patients', to_jsonb(old), to_jsonb(new));
    exception when others then
      v_changes := '{"unreadable": true}';
    end;
    if v_changes <> '{}' then
      perform public.audit(new.clinic_id, 'edit', 'patient:' || new.id, jsonb_build_object('changes', v_changes));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists audit_patient_change on public.patients;
create trigger audit_patient_change after insert or update or delete on public.patients
  for each row execute function public.audit_patient_change();

/** One tooth set or cleared on the patient's chart: under the patient, by tooth number. */
create or replace function public.audit_patient_tooth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
  v_org     uuid;
  v_changes jsonb;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return null;
  end if;
  v_patient := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;
  select clinic_id into v_org from public.patients where id = v_patient;
  if v_org is null then
    return null;
  end if;
  v_changes := public.audit_changes('patient_teeth',
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  if v_changes <> '{}' then
    perform public.audit(v_org, 'edit', 'patient:' || v_patient, jsonb_build_object(
      'tooth', case when tg_op = 'DELETE' then old.fdi else new.fdi end, 'changes', v_changes));
  end if;
  return null;
end;
$$;

drop trigger if exists audit_patient_tooth on public.patient_teeth;
create trigger audit_patient_tooth after insert or update or delete on public.patient_teeth
  for each row execute function public.audit_patient_tooth();

-- ── 6. Permissions ──────────────────────────────────────────────────────────

-- One entry per member per save: { granted: [...], removed: [...] }. A row
-- is a permission only while `granted`; a stale row from another clinic,
-- removed by replace_stale_grant (sql/085), cascades and is not recorded.
-- Statement triggers, so the Team page's preset is one entry, not ten.

create or replace function public.audit_permissions_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return null; end if;
  for r in
    select clinic_id, profile_id, jsonb_agg(permission order by permission) as granted
      from new_rows where coalesce(granted, false) and clinic_id is not null
     group by clinic_id, profile_id
  loop
    perform public.audit(r.clinic_id, 'permission', 'user:' || r.profile_id, jsonb_build_object('granted', r.granted));
  end loop;
  return null;
end;
$$;

create or replace function public.audit_permissions_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return null; end if;
  for r in
    select n.clinic_id, n.profile_id,
           coalesce(jsonb_agg(n.permission order by n.permission) filter (where coalesce(n.granted, false)), '[]') as granted,
           coalesce(jsonb_agg(n.permission order by n.permission) filter (where not coalesce(n.granted, false)), '[]') as removed
      from new_rows n join old_rows o on o.id = n.id
     where coalesce(n.granted, false) <> coalesce(o.granted, false) and n.clinic_id is not null
     group by n.clinic_id, n.profile_id
  loop
    perform public.audit(r.clinic_id, 'permission', 'user:' || r.profile_id,
      jsonb_strip_nulls(jsonb_build_object('granted', nullif(r.granted, '[]'), 'removed', nullif(r.removed, '[]'))));
  end loop;
  return null;
end;
$$;

create or replace function public.audit_permissions_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return null; end if;
  for r in
    -- An account deleted takes its permissions with it: that is the
    -- account_deleted entry (sql/110, written first, in the same
    -- transaction), not a removal.
    select clinic_id, profile_id, jsonb_agg(permission order by permission) as removed
      from old_rows o where coalesce(granted, false) and clinic_id is not null
       and exists (select 1 from public.profiles p where p.id = o.profile_id)
       and not exists (select 1 from public.audit_log a
                        where a.org_id = o.clinic_id and a.object = 'user:' || o.profile_id
                          and a.action = 'account_deleted' and a.at = now())
     group by clinic_id, profile_id
  loop
    perform public.audit(r.clinic_id, 'permission', 'user:' || r.profile_id, jsonb_build_object('removed', r.removed));
  end loop;
  return null;
end;
$$;

drop trigger if exists audit_permissions_inserted on public.worker_permissions;
create trigger audit_permissions_inserted after insert on public.worker_permissions
  referencing new table as new_rows
  for each statement execute function public.audit_permissions_inserted();
drop trigger if exists audit_permissions_updated on public.worker_permissions;
create trigger audit_permissions_updated after update on public.worker_permissions
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.audit_permissions_updated();
drop trigger if exists audit_permissions_deleted on public.worker_permissions;
create trigger audit_permissions_deleted after delete on public.worker_permissions
  referencing old table as old_rows
  for each statement execute function public.audit_permissions_deleted();

/** An owner changing a member's role (guard_profile_change allows it, sql/085). Joining or leaving is not a role change. */
create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1
     or new.clinic_id is null or new.clinic_id is distinct from old.clinic_id
     or (new.org_role is not distinct from old.org_role and new.role is not distinct from old.role) then
    return null;
  end if;
  perform public.audit(new.clinic_id, 'permission', 'user:' || new.id, jsonb_build_object('role',
    jsonb_build_object('old', coalesce(old.org_role, old.role), 'new', coalesce(new.org_role, new.role))));
  return null;
end;
$$;

drop trigger if exists audit_role_change on public.profiles;
create trigger audit_role_change after update of role, org_role on public.profiles
  for each row execute function public.audit_role_change();

-- ── 7. Deleting a file ──────────────────────────────────────────────────────

/** sql/072, and recorded under its job: the file's kind and version, never its name. */
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
  if f.deleted_at is null then
    perform public.audit(f.org_id, 'file_deleted', 'job:' || f.job_id,
      jsonb_build_object('file', f.id, 'type', f.type, 'version', f.version));
  end if;
end;
$$;

-- ── 8. Searching: "stage move" also finds a stage changed in an edit ────────

create or replace function public.audit_search(
  p_user        uuid        default null,
  p_action      text        default null,
  p_job_code    text        default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_before_at   timestamptz default null,
  p_before_id   bigint      default null,
  p_limit       int         default 50
) returns table (id bigint, at timestamptz, user_name text, action text, object text, job_code text, detail jsonb)
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
    select a.id, a.at, p.full_name, a.action, a.object,
           case when a.object like 'job:%' then (select j.job_code from public.jobs j where j.id::text = substr(a.object, 5)) end,
           a.detail
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

-- ── Who may run what ────────────────────────────────────────────────────────

-- The comparisons and the triggers run inside the database only.
revoke execute on function public.audit_field_rules() from public, anon, authenticated;
revoke execute on function public.audit_value(jsonb) from public, anon, authenticated;
revoke execute on function public.audit_teeth(jsonb) from public, anon, authenticated;
revoke execute on function public.audit_field_change(text, jsonb, jsonb, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.audit_changes(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_list_changes(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_list_label(text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.audit_job_diff(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_job_change() from public, anon, authenticated;
revoke execute on function public.audit_patient_change() from public, anon, authenticated;
revoke execute on function public.audit_patient_tooth() from public, anon, authenticated;
revoke execute on function public.audit_permissions_inserted() from public, anon, authenticated;
revoke execute on function public.audit_permissions_updated() from public, anon, authenticated;
revoke execute on function public.audit_permissions_deleted() from public, anon, authenticated;
revoke execute on function public.audit_role_change() from public, anon, authenticated;
revoke execute on function public.audit_log_no_truncate() from public, anon, authenticated;

select public.lock_anon_functions();

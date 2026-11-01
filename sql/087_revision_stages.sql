-- ============================================================================
-- Wivo — migration 087: revision stages through the same gate as job stages
-- Run AFTER sql/086. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec: "a revision inherits the original job's share", and stages move only
-- through an RPC that checks stage_transition and the partner's stages. A
-- revision's stage lives inside `jobs.revisions` (JSON), so it bypassed the
-- stage guard, the audit log and the notifications, and a partner could not
-- move a revision at all (review-068-079.md #22).
--
-- `move_revision_stage` is `move_job_stage` for one revision: same rights
-- (owner: jobs.write and its own rules; partner: jobs.write in its own
-- organisation, an active share, only from its assigned stages), the done
-- date stamped on entry to the last stage as the board does, an audit row,
-- and a notification when the move crosses sides.
-- ============================================================================

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
  update public.jobs set revisions = jsonb_set(revisions, array[v_idx::text], v_rev), updated_at = now()
   where id = p_job;

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

-- ============================================================================
-- Wivo — migration 096: org admins may override expiry too
-- Run AFTER sql/095. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Kevin's decision (docs/night-run/RUN-4.md): using expired goods on a job
-- can be overridden by the clinic's owner OR an organisation admin
-- (`is_org_admin()`: role owner, or org role owner/admin), both with a
-- required reason, both logged. Workers still cannot.
--
-- use_stock as in sql/093, with that one check changed; the audit row now
-- also says who overrode, by role, so owner and admin overrides can be told
-- apart in the log.
--
-- Tests: sql/test/stock.test.ts ("expired goods").
-- ============================================================================

create or replace function public.use_stock(p_item uuid, p_qty int, p_job uuid default null, p_override_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i          public.stock_item := public.my_stock_item(p_item);
  v_override boolean := false;
begin
  if p_job is null and public.stock_needs_job(i.category) then
    raise exception 'This item can only be used on a job; otherwise write it off with a reason' using errcode = '22023';
  end if;
  if p_job is not null and not exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = i.org_id and j.deleted_at is null and public.can_read_own_job(j.id)) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if i.expiry_date < current_date then
    if coalesce(btrim(p_override_reason), '') = '' then
      raise exception 'These goods expired on %', i.expiry_date using errcode = 'WV002';
    end if;
    if not public.is_org_admin() then
      raise exception 'Only the clinic''s owner or an admin can use expired goods' using errcode = '42501';
    end if;
    v_override := true;
  end if;
  perform public.take_stock(i, p_qty, 'use', p_job, case when v_override then btrim(p_override_reason) end, null, v_override);
  if v_override then
    perform public.audit(i.org_id, 'stock_override', 'stock:' || i.id,
      jsonb_build_object('lot', i.lot, 'expiry_date', i.expiry_date, 'qty', p_qty, 'job', p_job,
                         'reason', btrim(p_override_reason),
                         'as', case when public.my_role() = 'owner' then 'owner' else 'admin' end));
  end if;
end;
$$;

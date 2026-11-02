-- ============================================================================
-- Wivo — migration 093: stock (spec, Phase 2)
-- Run AFTER sql/092. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec, Phase 2 "Stock and inventory":
--   - Stock always comes from movements, never from a number someone edits.
--   - Categories: implant, abutment, bone material, other.
--   - A manual add needs an expiry date and a lot number.
--   - Consignment: when the owner and the location differ, the due date is 3
--     months by default; a month before it the goods turn red. Actions: use,
--     return, buy out.
--   - Using an item on a job lowers the stock and links the lot to the job
--     (and through it to the patient) — inside the clinic's own organisation.
--   - Minimum-quantity warning.
--
-- Naming: `org_id` is the organisation whose shelf the item is on (the spec's
-- location_org). A consignment item has an owner: a partner organisation
-- (`owner_org`) or an outside supplier (`owner_supplier`, a name).
--
-- Who reaches what:
--   - The clinic's own members, with `stock.read` / `stock.write` (new
--     permissions; owners have all). Rows through RLS, writes only through
--     the functions below.
--   - A partner never reads these tables. With `share_stock` on in the
--     partnership, `partner_stock()` gives it ITS OWN consignment items at the
--     clinic: quantity, lot, expiry, used and remaining — totals only, never a
--     movement, so never a job or a patient (CLAUDE.md, sql/092).
--     (Kevin's rule for this run, stricter than the spec, which also showed
--     the host's own stock when share_stock is on: docs/night-run/RUN-4.md.)
--
-- Tests: sql/test/stock.test.ts, sql/test/stockLeak.test.ts.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.stock_item (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.clinics(id) on delete cascade,
  owner_org        uuid references public.clinics(id) on delete restrict,
  owner_supplier   text,
  category         text not null,
  manufacturer     text,
  system           text,
  size             text,
  product          text,            -- name or catalogue number
  lot              text not null,
  expiry_date      date not null,
  consignment_due  date,
  min_qty          int,             -- warn when fewer than this are left
  archived_at      timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint stock_item_category_valid check (category in ('implant', 'abutment', 'bone', 'other')),
  constraint stock_item_lot_present check (char_length(btrim(lot)) > 0),
  constraint stock_item_one_owner check (owner_org is null or owner_supplier is null),
  constraint stock_item_owner_not_self check (owner_org is distinct from org_id),
  constraint stock_item_supplier_present check (owner_supplier is null or char_length(btrim(owner_supplier)) > 0),
  constraint stock_item_consignment_due check ((owner_org is null and owner_supplier is null) = (consignment_due is null)),
  constraint stock_item_min_qty_valid check (min_qty is null or min_qty >= 0)
);
create index if not exists stock_item_org_idx on public.stock_item (org_id);
create index if not exists stock_item_owner_idx on public.stock_item (owner_org) where owner_org is not null;

create table if not exists public.stock_movement (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.clinics(id) on delete cascade,
  item_id   uuid not null references public.stock_item(id) on delete cascade,
  kind      text not null,
  delta     int not null,           -- signed: what this did to the quantity
  job_id    uuid references public.jobs(id) on delete set null,
  reason    text,
  by_user   uuid references auth.users(id) on delete set null,
  at        timestamptz not null default now(),
  constraint stock_movement_kind_valid check (kind in ('in', 'use', 'return', 'buy', 'adjust')),
  constraint stock_movement_sign check (
    (kind = 'in' and delta > 0) or (kind in ('use', 'return', 'buy') and delta < 0) or (kind = 'adjust' and delta <> 0)),
  constraint stock_movement_job_only_on_use check (job_id is null or kind = 'use'),
  constraint stock_movement_adjust_reason check (kind <> 'adjust' or char_length(btrim(reason)) > 0)
);
create index if not exists stock_movement_item_idx on public.stock_movement (item_id);
create index if not exists stock_movement_job_idx on public.stock_movement (job_id) where job_id is not null;

alter table public.stock_item enable row level security;
alter table public.stock_movement enable row level security;

drop policy if exists "stock_item_select" on public.stock_item;
create policy "stock_item_select" on public.stock_item
  for select using (org_id = public.my_org_id() and public.has_perm('stock.read'));
drop policy if exists "stock_movement_select" on public.stock_movement;
create policy "stock_movement_select" on public.stock_movement
  for select using (org_id = public.my_org_id() and public.has_perm('stock.read'));
-- Writes only through the functions below.

/**
 * Movements are the history: never changed, never removed. The two
 * exceptions are the database's own: a deleted user or job leaves the row
 * with that link empty (on delete set null), and an organisation that leaves
 * takes its rows with it (a delete with no signed-in user).
 */
create or replace function public.stock_movement_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id and new.org_id = old.org_id and new.item_id = old.item_id and new.kind = old.kind
       and new.delta = old.delta and new.reason is not distinct from old.reason and new.at = old.at
       and (new.job_id is not distinct from old.job_id or new.job_id is null)
       and (new.by_user is not distinct from old.by_user or new.by_user is null) then
      return new;
    end if;
    raise exception 'Stock movements cannot be changed' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    raise exception 'Stock movements cannot be removed' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists stock_movement_append_only on public.stock_movement;
create trigger stock_movement_append_only before update or delete on public.stock_movement
  for each row execute function public.stock_movement_append_only();

-- ── Quantity ────────────────────────────────────────────────────────────────

/** Every item the caller may read, with its quantity: the sum of its movements. */
create or replace view public.stock_levels with (security_invoker = true) as
  select i.*, coalesce((select sum(m.delta) from public.stock_movement m where m.item_id = i.id), 0)::int as qty
    from public.stock_item i;

create or replace function public.stock_qty(p_item uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::int from public.stock_movement where item_id = p_item
$$;
revoke execute on function public.stock_qty(uuid) from public, anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

/** The caller's live item, locked for this transaction; or an error. */
create or replace function public.my_stock_item(p_item uuid)
returns public.stock_item
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item;
begin
  if not public.has_perm('stock.write') then
    raise exception 'No permission to change stock' using errcode = '42501';
  end if;
  select * into i from public.stock_item where id = p_item and org_id = public.my_org_id() for update;
  if i.id is null then
    raise exception 'Item not found' using errcode = '42501';
  end if;
  if i.archived_at is not null then
    raise exception 'This item is archived' using errcode = '22023';
  end if;
  return i;
end;
$$;
revoke execute on function public.my_stock_item(uuid) from public, anon, authenticated;

/**
 * The text of a partner-owned item reaches that partner (partner_stock). It
 * may not name any of this clinic's patients or hold a personal code (sql/092).
 */
create or replace function public.guard_partner_visible_stock_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_terms text[];
begin
  if new.owner_org is null then
    return new;
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_terms
    from public.patients p, unnest(public.identity_terms(p.id, null)) t
   where p.clinic_id = new.org_id;
  if public.identity_hit(concat_ws(' ', new.manufacturer, new.system, new.size, new.product, new.lot), v_terms) is not null then
    raise exception 'Partners read this text. Remove the patient''s name or personal code.' using errcode = 'WV001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_partner_visible_stock_text on public.stock_item;
create trigger guard_partner_visible_stock_text before insert or update on public.stock_item
  for each row execute function public.guard_partner_visible_stock_text();

-- ── Writes ──────────────────────────────────────────────────────────────────

/**
 * A manual add: lot and expiry required. With an owner it is consignment,
 * due in 3 months unless a date is given. A partner owner needs an active
 * partnership with this clinic.
 */
create or replace function public.add_stock_item(
  p_category text,
  p_manufacturer text,
  p_system text,
  p_size text,
  p_product text,
  p_lot text,
  p_expiry date,
  p_qty int,
  p_min_qty int default null,
  p_owner_org uuid default null,
  p_owner_supplier text default null,
  p_consignment_due date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_supplier text := nullif(btrim(coalesce(p_owner_supplier, '')), '');
  v_id uuid;
begin
  if not public.has_perm('stock.write') then
    raise exception 'No permission to change stock' using errcode = '42501';
  end if;
  if coalesce(btrim(p_lot), '') = '' then
    raise exception 'The lot number is required' using errcode = '22023';
  end if;
  if p_expiry is null then
    raise exception 'The expiry date is required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_manufacturer), '') = '' and coalesce(btrim(p_product), '') = '' then
    raise exception 'A manufacturer or a product name is required' using errcode = '22023';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'The quantity must be more than zero' using errcode = '22023';
  end if;
  if p_owner_org is not null and not exists (
    select 1 from public.partnership
     where status = 'active'
       and ((org_a = v_org and org_b = p_owner_org) or (org_b = v_org and org_a = p_owner_org))) then
    raise exception 'No active partnership with that organisation' using errcode = '22023';
  end if;

  insert into public.stock_item (org_id, owner_org, owner_supplier, category, manufacturer, system, size, product,
                                 lot, expiry_date, consignment_due, min_qty, created_by)
  values (v_org, p_owner_org, v_supplier, p_category, nullif(btrim(p_manufacturer), ''), nullif(btrim(p_system), ''),
          nullif(btrim(p_size), ''), nullif(btrim(p_product), ''), btrim(p_lot), p_expiry,
          case when p_owner_org is not null or v_supplier is not null
               then coalesce(p_consignment_due, (current_date + interval '3 months')::date) end,
          p_min_qty, auth.uid())
  returning id into v_id;
  insert into public.stock_movement (org_id, item_id, kind, delta, by_user)
  values (v_org, v_id, 'in', p_qty, auth.uid());
  return v_id;
end;
$$;

/** More of the same lot arrived. */
create or replace function public.receive_stock(p_item uuid, p_qty int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'The quantity must be more than zero' using errcode = '22023';
  end if;
  insert into public.stock_movement (org_id, item_id, kind, delta, by_user) values (i.org_id, i.id, 'in', p_qty, auth.uid());
end;
$$;

/** Takes `p_qty` off the shelf; never below zero. */
create or replace function public.take_stock(i public.stock_item, p_qty int, p_kind text, p_job uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'The quantity must be more than zero' using errcode = '22023';
  end if;
  if public.stock_qty(i.id) < p_qty then
    raise exception 'Not enough in stock' using errcode = '22023';
  end if;
  insert into public.stock_movement (org_id, item_id, kind, delta, job_id, reason, by_user)
  values (i.org_id, i.id, p_kind, -p_qty, p_job, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
end;
$$;
revoke execute on function public.take_stock(public.stock_item, int, text, uuid, text) from public, anon, authenticated;

/**
 * Used on a job: the job must be this clinic's own, not deleted, and one the
 * caller can see. The link stays inside the clinic (RLS on stock_movement);
 * partner_stock never returns it.
 */
create or replace function public.use_stock(p_item uuid, p_qty int, p_job uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if p_job is not null and not exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = i.org_id and j.deleted_at is null and public.can_read_own_job(j.id)) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  perform public.take_stock(i, p_qty, 'use', p_job, null);
end;
$$;

/** Consignment goods back to their owner. */
create or replace function public.return_stock(p_item uuid, p_qty int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if i.consignment_due is null then
    raise exception 'Only consignment goods are returned' using errcode = '22023';
  end if;
  perform public.take_stock(i, p_qty, 'return', null, p_reason);
end;
$$;

/**
 * Consignment goods bought out: they leave the consignment item and arrive as
 * the clinic's own, same lot and expiry. Returns the new item.
 */
create or replace function public.buy_out_stock(p_item uuid, p_qty int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i    public.stock_item := public.my_stock_item(p_item);
  v_id uuid;
begin
  if i.consignment_due is null then
    raise exception 'Only consignment goods are bought out' using errcode = '22023';
  end if;
  perform public.take_stock(i, p_qty, 'buy', null, null);
  insert into public.stock_item (org_id, category, manufacturer, system, size, product, lot, expiry_date, created_by)
  values (i.org_id, i.category, i.manufacturer, i.system, i.size, i.product, i.lot, i.expiry_date, auth.uid())
  returning id into v_id;
  insert into public.stock_movement (org_id, item_id, kind, delta, reason, by_user)
  values (i.org_id, v_id, 'in', p_qty, 'bought out', auth.uid());
  return v_id;
end;
$$;

/** A correction outside an inventory count: always with a reason. */
create or replace function public.adjust_stock(p_item uuid, p_delta int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if coalesce(p_delta, 0) = 0 then
    raise exception 'The change must not be zero' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A correction needs a reason' using errcode = '22023';
  end if;
  if public.stock_qty(i.id) + p_delta < 0 then
    raise exception 'Not enough in stock' using errcode = '22023';
  end if;
  insert into public.stock_movement (org_id, item_id, kind, delta, reason, by_user)
  values (i.org_id, i.id, 'adjust', p_delta, btrim(p_reason), auth.uid());
end;
$$;

/** What describes an item, and its warning threshold. Lot and expiry stay required. */
create or replace function public.update_stock_item(
  p_item uuid,
  p_manufacturer text,
  p_system text,
  p_size text,
  p_product text,
  p_lot text,
  p_expiry date,
  p_min_qty int,
  p_consignment_due date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if coalesce(btrim(p_lot), '') = '' then
    raise exception 'The lot number is required' using errcode = '22023';
  end if;
  if p_expiry is null then
    raise exception 'The expiry date is required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_manufacturer), '') = '' and coalesce(btrim(p_product), '') = '' then
    raise exception 'A manufacturer or a product name is required' using errcode = '22023';
  end if;
  update public.stock_item
     set manufacturer = nullif(btrim(p_manufacturer), ''), system = nullif(btrim(p_system), ''),
         size = nullif(btrim(p_size), ''), product = nullif(btrim(p_product), ''),
         lot = btrim(p_lot), expiry_date = p_expiry, min_qty = p_min_qty,
         consignment_due = case when i.consignment_due is null then null else coalesce(p_consignment_due, i.consignment_due) end
   where id = i.id;
end;
$$;

/** An empty item leaves the list (and its warnings); its history stays. */
create or replace function public.archive_stock_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.stock_item := public.my_stock_item(p_item);
begin
  if public.stock_qty(i.id) <> 0 then
    raise exception 'Only an empty item can be archived' using errcode = '22023';
  end if;
  update public.stock_item set archived_at = now() where id = i.id;
end;
$$;

-- ── The partner's view ──────────────────────────────────────────────────────

/**
 * The caller's own consignment goods on partners' shelves, where the
 * partnership shares stock. Totals only: no movement, no date of use, no job,
 * no patient. Nothing of the host's own stock.
 */
create or replace function public.partner_stock()
returns table (
  item_id uuid, location_org uuid, location_name text, category text, manufacturer text, system text,
  size text, product text, lot text, expiry_date date, consignment_due date,
  received int, used int, returned int, bought int, adjusted int, remaining int
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.org_id, c.name, i.category, i.manufacturer, i.system, i.size, i.product, i.lot,
         i.expiry_date, i.consignment_due,
         coalesce(sum(m.delta) filter (where m.kind = 'in'), 0)::int,
         coalesce(-sum(m.delta) filter (where m.kind = 'use'), 0)::int,
         coalesce(-sum(m.delta) filter (where m.kind = 'return'), 0)::int,
         coalesce(-sum(m.delta) filter (where m.kind = 'buy'), 0)::int,
         coalesce(sum(m.delta) filter (where m.kind = 'adjust'), 0)::int,
         coalesce(sum(m.delta), 0)::int
    from public.stock_item i
    join public.clinics c on c.id = i.org_id
    left join public.stock_movement m on m.item_id = i.id
   where i.owner_org = public.my_org_id()
     and public.has_perm('stock.read')
     and exists (select 1 from public.partnership p
                  where p.share_stock and p.status in ('active', 'suspended')
                    and ((p.org_a = i.org_id and p.org_b = i.owner_org) or (p.org_b = i.org_id and p.org_a = i.owner_org)))
   group by i.id, c.name
$$;

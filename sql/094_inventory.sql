-- ============================================================================
-- Wivo — migration 094: inventory counts (spec, Phase 2)
-- Run AFTER sql/093. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Spec: "The organisation sets how often. When the date comes, the overview
-- has a big red bar. The count view shows the expected and the counted
-- quantity; a difference is saved with its reason; the history stays."
-- Acceptance: "An inventory difference changes the stock only with a reason."
--
-- A count is saved in one go (`record_inventory_count`): the expected
-- quantity is the stock AT SAVING, so a use while someone was counting does
-- not turn into a false difference. Each difference becomes an `adjust`
-- movement carrying the reason and the count.
--
-- Tests: sql/test/inventory.test.ts.
-- ============================================================================

create table if not exists public.inventory_schedule (
  org_id           uuid primary key references public.clinics(id) on delete cascade,
  interval_months  int not null default 3,
  next_due         date not null,
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint inventory_schedule_interval_valid check (interval_months between 1 and 24)
);

create table if not exists public.inventory_count (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.clinics(id) on delete cascade,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  by_user      uuid references auth.users(id) on delete set null
);
create index if not exists inventory_count_org_idx on public.inventory_count (org_id, finished_at desc);

create table if not exists public.inventory_count_line (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.clinics(id) on delete cascade,
  count_id  uuid not null references public.inventory_count(id) on delete cascade,
  item_id   uuid not null references public.stock_item(id) on delete cascade,
  expected  int not null,
  counted   int not null,
  reason    text,
  constraint inventory_count_line_counted_valid check (counted >= 0),
  constraint inventory_count_line_reason check (counted = expected or char_length(btrim(reason)) > 0),
  constraint inventory_count_line_once unique (count_id, item_id)
);

alter table public.stock_movement
  add column if not exists count_id uuid references public.inventory_count(id) on delete set null;

alter table public.inventory_schedule enable row level security;
alter table public.inventory_count enable row level security;
alter table public.inventory_count_line enable row level security;

drop policy if exists "inventory_schedule_select" on public.inventory_schedule;
create policy "inventory_schedule_select" on public.inventory_schedule
  for select using (org_id = public.my_org_id() and public.has_perm('stock.read'));
drop policy if exists "inventory_count_select" on public.inventory_count;
create policy "inventory_count_select" on public.inventory_count
  for select using (org_id = public.my_org_id() and public.has_perm('stock.read'));
drop policy if exists "inventory_count_line_select" on public.inventory_count_line;
create policy "inventory_count_line_select" on public.inventory_count_line
  for select using (org_id = public.my_org_id() and public.has_perm('stock.read'));
-- Writes only through the functions below.

/** As sql/093, now with the count a movement came from. */
create or replace function public.stock_movement_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id and new.org_id = old.org_id and new.item_id = old.item_id and new.kind = old.kind
       and new.delta = old.delta and new.reason is not distinct from old.reason and new.at = old.at
       and new.reason_code is not distinct from old.reason_code and new.expired_override = old.expired_override
       and (new.job_id is not distinct from old.job_id or new.job_id is null)
       and (new.by_user is not distinct from old.by_user or new.by_user is null)
       and (new.count_id is not distinct from old.count_id or new.count_id is null) then
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

/** How often, and when the next count is due. */
create or replace function public.set_inventory_schedule(p_interval_months int, p_next_due date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('stock.write') then
    raise exception 'No permission to change stock' using errcode = '42501';
  end if;
  if p_next_due is null then
    raise exception 'The date of the next count is required' using errcode = '22023';
  end if;
  insert into public.inventory_schedule (org_id, interval_months, next_due, updated_by, updated_at)
  values (public.my_org_id(), p_interval_months, p_next_due, auth.uid(), now())
  on conflict (org_id) do update
    set interval_months = excluded.interval_months, next_due = excluded.next_due,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

/**
 * Saves a count: `p_lines` is [{item_id, counted, reason}]. Every difference
 * needs a reason and becomes an `adjust` movement. The next count moves on by
 * the schedule's interval. Returns the count.
 */
create or replace function public.record_inventory_count(p_started_at timestamptz, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.my_org_id();
  v_count    uuid;
  l          jsonb;
  i          public.stock_item;
  v_expected int;
  v_counted  int;
  v_reason   text;
begin
  if not public.has_perm('stock.write') then
    raise exception 'No permission to change stock' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing was counted' using errcode = '22023';
  end if;
  if (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines) then
    raise exception 'An item was counted twice' using errcode = '22023';
  end if;

  insert into public.inventory_count (org_id, started_at, by_user)
  values (v_org, coalesce(p_started_at, now()), auth.uid())
  returning id into v_count;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := public.my_stock_item((l ->> 'item_id')::uuid);
    v_expected := public.stock_qty(i.id);
    v_counted := (l ->> 'counted')::int;
    v_reason := nullif(btrim(coalesce(l ->> 'reason', '')), '');
    if v_counted is null or v_counted < 0 then
      raise exception 'A counted quantity cannot be negative' using errcode = '22023';
    end if;
    if v_counted <> v_expected and v_reason is null then
      raise exception 'A difference needs a reason' using errcode = '22023';
    end if;
    insert into public.inventory_count_line (org_id, count_id, item_id, expected, counted, reason)
    values (v_org, v_count, i.id, v_expected, v_counted, v_reason);
    if v_counted <> v_expected then
      insert into public.stock_movement (org_id, item_id, kind, delta, reason, count_id, by_user)
      values (v_org, i.id, 'adjust', v_counted - v_expected, v_reason, v_count, auth.uid());
    end if;
  end loop;

  update public.inventory_schedule
     set next_due = (current_date + make_interval(months => interval_months))::date, updated_at = now()
   where org_id = v_org;
  return v_count;
end;
$$;

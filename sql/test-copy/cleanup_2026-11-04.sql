-- ============================================================================
-- Wivo — TEST COPY ONLY, run once: what the restore still left in the test
-- copy's data after sql/107–109 (2026-11-04)
-- ============================================================================
--
-- Not a migration. Production needs none of it: on 2026-11-04 its
-- production_check.sql and orphan_users.sql found none of this there, and a
-- database built from the migrations never has it.
--
-- What schema_check.sql and orphan_users.sql still found on the test copy
-- after 109, and what this does about each:
--
--   1. Rows pointing at deleted sign-in accounts. The accounts were deleted
--      while the restore had left out the foreign keys, so the deletes
--      reached nothing.
--        clinics.created_by  emptied, as ON DELETE SET NULL would have
--                            ("Riga Test SIA").
--        profiles            deleted, as ON DELETE CASCADE would have
--                            ("Wivo check (delete me)", the throwaway account
--                            of scripts/check-standin-auth.sh). A profile that
--                            still has jobs, work hours, rates or payouts is
--                            left and named.
--      Then sql/107's two keys are validated.
--   2. Seven functions that signed-in users could call directly, although
--      sql/070, 075 and 079 revoke that. The restore lost those revokes; the
--      ones a later migration repeated are back. Revoked again.
--   3. Code prefixes: the start of every job code and of every stand-in login.
--      The restore left out the trigger that gives a new clinic one (until
--      sql/108) and the unique index, which 109 could not build because two
--      clinics share a prefix.
--        - The clinic that had a shared prefix first keeps it. Each later one
--          gets a free one (sql/070's rule), and its stand-in logins
--          (<username>.<code>@nomail.wivodent.com, sql/100) are renamed with
--          it: they sign in with the new code. Job codes already given keep
--          the old prefix.
--        - A clinic with no prefix gets one.
--        - A job with a clinic but no code gets the clinic's next code.
--        - Then the unique index clinics_code_prefix_key.
--   4. Draft invoices whose totals disagree with their lines (the restore
--      also left out the triggers that recount them) are recounted. A sent,
--      paid or cancelled invoice is named, never changed.
--
-- Paste into the SQL Editor of the TEST COPY and Run, once. All changes are
-- made in one step: if anything fails, nothing is changed. It refuses to run
-- on a database without sql/107's foreign keys (production, until 2.1).
-- The result is a table: one row per change, and what was left and why.
-- Then run sql/checks/schema_check.sql and sql/checks/orphan_users.sql
-- again: both should return no rows.
-- ============================================================================

set lock_timeout = '10s';

drop table if exists pg_temp.cleanup_report;
create temp table cleanup_report (n serial, part text, what text);

do $$
declare
  r        record;
  new_code text;
  n        bigint;
  still    bigint;
  standin  constant text := '@nomail.wivodent.com';
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_id_fkey')
     or not exists (select 1 from pg_constraint where conrelid = 'public.clinics'::regclass and conname = 'clinics_created_by_fkey') then
    raise exception 'Not the test copy: this database lacks sql/107''s foreign keys. Nothing was changed.';
  end if;

  -- 1. Rows pointing at deleted accounts ---------------------------------------
  for r in select c.id, c.name, c.created_by from public.clinics c
            where c.created_by is not null
              and not exists (select 1 from auth.users u where u.id = c.created_by)
            order by c.created_at, c.id loop
    update public.clinics set created_by = null where id = r.id;
    insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
      format('clinic "%s" (%s): created_by emptied; account %s no longer exists', r.name, r.id, r.created_by));
  end loop;

  for r in select p.id, p.full_name,
                  (select count(*) from public.jobs j where p.id in (j.assigned_to, j.designed_by)) as jobs,
                  (select count(*) from public.work_hours w where w.profile_id = p.id) as hours,
                  (select count(*) from public.worker_rates w where w.profile_id = p.id) as rates,
                  (select count(*) from public.worker_payouts w where w.profile_id = p.id) as payouts
             from public.profiles p
            where not exists (select 1 from auth.users u where u.id = p.id)
            order by p.created_at, p.id loop
    if r.jobs + r.hours + r.rates + r.payouts > 0 then
      insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
        format('profile "%s" (%s) LEFT: its account is gone, but it still has %s job(s), %s work-hour row(s), %s rate(s) and %s payout(s)',
               r.full_name, r.id, r.jobs, r.hours, r.rates, r.payouts));
      continue;
    end if;
    begin
      delete from public.profiles where id = r.id;
      insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
        format('profile "%s" (%s) deleted: its account no longer exists and nothing hung on it', r.full_name, r.id));
    exception when others then
      insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
        format('profile "%s" (%s) LEFT: deleting it failed: %s', r.full_name, r.id, sqlerrm));
    end;
  end loop;

  for r in select c.conrelid::regclass::text as tbl, c.conname from pg_constraint c
            where c.conrelid in ('public.profiles'::regclass, 'public.clinics'::regclass)
              and c.conname in ('profiles_id_fkey', 'clinics_created_by_fkey')
              and not c.convalidated
            order by 1 loop
    begin
      execute format('alter table %s validate constraint %I', r.tbl, r.conname);
      insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
        format('foreign key %s.%s validated', r.tbl, r.conname));
    exception when foreign_key_violation then
      insert into pg_temp.cleanup_report (part, what) values ('1. deleted accounts',
        format('foreign key %s.%s LEFT NOT VALID: a row still points at a missing account (above)', r.tbl, r.conname));
    end;
  end loop;

  -- 2. Functions signed-in users must not call directly ------------------------
  for r in select fn, src from (values
      ('public.audit(uuid, text, text, jsonb)', '070'),
      ('public.find_invite(uuid, text)', '070'),
      ('public.platform_approve_partnership(uuid)', '070'),
      ('public.notify_org(uuid, uuid, text, jsonb)', '075'),
      ('public.mark_notifications_emailed(uuid[])', '075'),
      ('public.pending_bug_reports(int)', '079'),
      ('public.mark_bug_reports_emailed(uuid[])', '079')
    ) v(fn, src)
    where to_regprocedure(fn) is not null
      and (has_function_privilege('authenticated', to_regprocedure(fn), 'execute')
           or has_function_privilege('anon', to_regprocedure(fn), 'execute')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    insert into pg_temp.cleanup_report (part, what) values ('2. grants',
      format('%s: signed-in users can no longer call it directly (sql/%s)', r.fn, r.src));
  end loop;

  -- 3. Code prefixes -----------------------------------------------------------
  for r in select c.id, c.name, c.code_prefix as old_code from public.clinics c
            where c.code_prefix is not null
              and exists (select 1 from public.clinics o
                           where o.code_prefix = c.code_prefix
                             and (o.created_at, o.id) < (c.created_at, c.id))
            order by c.created_at, c.id loop
    new_code := public.free_code_prefix(r.name, r.id);
    update public.clinics set code_prefix = new_code where id = r.id;
    if (select code_prefix from public.clinics where id = r.id) is distinct from new_code then
      raise exception 'The prefix of clinic % did not change (guard_code_prefix). Nothing was changed.', r.id;
    end if;
    update auth.users u
       set email = left(u.email, length(u.email) - length('.' || lower(r.old_code) || standin))
                   || '.' || lower(new_code) || standin
     where u.id in (select p.id from public.profiles p where p.clinic_id = r.id)
       and lower(right(u.email, length('.' || lower(r.old_code) || standin))) = '.' || lower(r.old_code) || standin;
    get diagnostics n = row_count;
    insert into pg_temp.cleanup_report (part, what) values ('3. code prefixes',
      format('clinic "%s" (%s): prefix %s belonged to an older clinic too; now %s. %s stand-in login(s) renamed with it (they sign in with the code %s); its job codes so far keep %s',
             r.name, r.id, r.old_code, new_code, n, lower(new_code), r.old_code));
  end loop;

  for r in select c.id, c.name from public.clinics c where c.code_prefix is null order by c.created_at, c.id loop
    new_code := public.free_code_prefix(r.name, r.id);
    update public.clinics set code_prefix = new_code where id = r.id;
    insert into pg_temp.cleanup_report (part, what) values ('3. code prefixes',
      format('clinic "%s" (%s) had no prefix (made while the trigger was missing): now %s', r.name, r.id, new_code));
  end loop;

  select count(*) into n from public.jobs where clinic_id is not null and job_code is null;
  if n > 0 then
    -- set_job_code (sql/083) gives a job without a code the next one on any
    -- update of job_code: one by one, oldest first, so the numbers follow.
    for r in select id from public.jobs where clinic_id is not null and job_code is null order by created_at, id loop
      update public.jobs set job_code = null where id = r.id;
    end loop;
    select count(*) into still from public.jobs where clinic_id is not null and job_code is null;
    insert into pg_temp.cleanup_report (part, what) values ('3. code prefixes',
      format('%s job(s) with a clinic but no code got their clinic''s next code%s', n - still,
             case when still > 0 then format('; %s still have none (LEFT)', still) else '' end));
  end if;

  if to_regclass('public.clinics_code_prefix_key') is null then
    create unique index clinics_code_prefix_key on public.clinics (code_prefix);
    insert into pg_temp.cleanup_report (part, what) values ('3. code prefixes',
      'unique index clinics_code_prefix_key built');
  end if;

  -- 4. Invoice totals ----------------------------------------------------------
  for r in select i.id, i.number, i.status, i.gross_total,
                  t.net + round(t.net * coalesce(i.vat_rate, 0) / 100, 2) as gross
             from public.invoices i
             cross join lateral (select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as net
                                   from public.invoice_lines l where l.invoice_id = i.id) t
            where i.net_total <> t.net
               or i.vat_total <> round(t.net * coalesce(i.vat_rate, 0) / 100, 2)
               or i.gross_total <> t.net + round(t.net * coalesce(i.vat_rate, 0) / 100, 2)
            order by i.created_at, i.id loop
    if r.status = 'mustand' then
      perform public.recalc_invoice_totals(r.id);
      insert into pg_temp.cleanup_report (part, what) values ('4. invoice totals',
        format('draft invoice %s (%s): recounted from its lines, total %s -> %s', r.number, r.id, r.gross_total, r.gross));
    else
      insert into pg_temp.cleanup_report (part, what) values ('4. invoice totals',
        format('invoice %s (%s, %s) LEFT: its total %s disagrees with its lines (%s), but it is no longer a draft',
               r.number, r.id, r.status, r.gross_total, r.gross));
    end if;
  end loop;

  if not exists (select 1 from pg_temp.cleanup_report) then
    insert into pg_temp.cleanup_report (part, what) values ('-', 'nothing to do: this database has none of it');
  end if;
end $$;

select part, what from pg_temp.cleanup_report order by n;

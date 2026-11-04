-- ============================================================================
-- Wivo — migration 118: a client's details only with View jobs or View payments
-- Run AFTER sql/117. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Every member read every client of the clinic whole (sql/035, 102): the
-- contact person, e-mail, CC addresses, phone, address, registry code, VAT
-- number, notes, special prices and payment terms. A job needs only to show
-- its client; the Clients page (menu: View jobs) and invoicing need the rest
-- (docs/PERMISSIONS.md, Kevin 2026-11-04).
--
-- 1. Column grants, as sql/102 (clinic_settings) and sql/117 (profiles): a
--    signed-in user reads id, clinic_id, name and archived_at of the
--    clinic's clients — what the job form, the wizard, Table and Statistics
--    show. `select *` is refused; a column added later stays hidden until
--    it is granted.
-- 2. customers_full(): the clinic's clients whole, for View jobs (the
--    Clients page) or View payments (invoices), and owners and admins
--    always (has_perm_or_admin). `stable`.
-- 3. Writing a client (add, change, archive, delete) needs Edit jobs AND
--    View jobs — the Clients page, which is where it is done; admins always,
--    as since sql/102. A member with Edit jobs alone could change clients
--    through the API, though not through the app.
--
-- The invoice e-mails (Edge Function send-invoices) read the client's
-- address with the service key, which these rules do not touch.
-- No new table. Tests: sql/test/customersAccess.test.ts.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. Who reads which column ───────────────────────────────────────────────

revoke select on public.customers from anon, authenticated;
grant select (id, clinic_id, name, archived_at) on public.customers to authenticated;

-- ── 2. The whole row, for the Clients page and invoicing ────────────────────

create or replace function public.customers_full()
returns setof public.customers
language sql
stable
security definer
set search_path = public
as $$
  select c.* from public.customers c
   where c.clinic_id = public.my_clinic_id()
     and (public.has_perm('jobs.read') or public.has_perm_or_admin('payments.read'))
   order by c.name
$$;

revoke execute on function public.customers_full() from public, anon;
grant execute on function public.customers_full() to authenticated;

-- ── 3. Writing: Edit jobs and View jobs (admins always) ─────────────────────

drop policy if exists "customers_insert" on public.customers;
drop policy if exists "customers_update" on public.customers;
drop policy if exists "customers_delete" on public.customers;
create policy "customers_insert" on public.customers for insert
  with check (clinic_id = public.my_clinic_id()
              and ((public.has_perm('jobs.write') and public.has_perm('jobs.read')) or public.is_org_admin()));
create policy "customers_update" on public.customers for update
  using (clinic_id = public.my_clinic_id()
         and ((public.has_perm('jobs.write') and public.has_perm('jobs.read')) or public.is_org_admin()))
  with check (clinic_id = public.my_clinic_id()
              and ((public.has_perm('jobs.write') and public.has_perm('jobs.read')) or public.is_org_admin()));
create policy "customers_delete" on public.customers for delete
  using (clinic_id = public.my_clinic_id()
         and ((public.has_perm('jobs.write') and public.has_perm('jobs.read')) or public.is_org_admin()));

select public.lock_anon_functions();

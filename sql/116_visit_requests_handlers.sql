-- ============================================================================
-- Wivo — migration 116: booking requests only for the people who handle them
-- Run AFTER sql/115. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- A booking request (from the clinic's public booking page) holds a person's
-- name, phone, e-mail and message. sql/059 let every member of the clinic
-- read, add, change and delete them, while the app shows Requests only to
-- members with Manage visits (visits.write). Now the database says the same:
-- members with visits.write, the clinic's owners and its admins
-- (has_perm_or_admin, sql/102).
--
-- How requests are made is unchanged: the public booking page goes through
-- the Edge Function public-booking with the service key, which these rules
-- do not touch; a request added by hand needs visits.write, as handling one
-- does. Realtime follows the same rule, so nobody else is sent them either.
--
-- No new table, no new function. Tests: sql/test/visitRequests.test.ts.
-- ============================================================================

set lock_timeout = '10s';

drop policy if exists "visit_requests_select" on public.visit_requests;
drop policy if exists "visit_requests_insert" on public.visit_requests;
drop policy if exists "visit_requests_update" on public.visit_requests;
drop policy if exists "visit_requests_delete" on public.visit_requests;

create policy "visit_requests_select" on public.visit_requests
  for select using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('visits.write'));
create policy "visit_requests_insert" on public.visit_requests
  for insert with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('visits.write'));
create policy "visit_requests_update" on public.visit_requests
  for update using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('visits.write'))
  with check (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('visits.write'));
create policy "visit_requests_delete" on public.visit_requests
  for delete using (clinic_id = public.my_clinic_id() and public.has_perm_or_admin('visits.write'));

select public.lock_anon_functions();

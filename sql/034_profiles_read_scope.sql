-- Wivo — migration 034: scope profiles_read to the caller's clinic
--
-- Run in the Supabase SQL editor (Wivo closed).
--
-- WHAT IS WRONG TODAY
--   sql/012 created:
--       create policy "profiles_read" on public.profiles
--         for select using (auth.uid() is not null);
--   That is "any signed-in user may read EVERY profile in the project" — every
--   clinic's staff, their full names, usernames, roles and clinic ids. It dates
--   from when the project was one clinic, where it was equivalent to the right
--   rule. Migration 016 tightened every other table to clinic_id = my_clinic_id()
--   and this one was left behind.
--
--   The renderer works around it: HANDOFF.md records that `useClinicProfiles`
--   MUST filter on clinic_id, because an unfiltered query offers removed people
--   and other clinics' staff as assignable. A client-side filter is a display
--   convention, not a boundary — anyone with the anon key and a REST call reads
--   the lot.
--
-- WHY IT MATTERS MORE NOW
--   The upcoming public surfaces (job-status links, order form) put the anon key
--   in front of the internet. If Supabase anonymous sign-in is ever switched on
--   — a one-click setting that looks harmless — every anonymous visitor gets a
--   real auth.uid() and this policy hands them the entire staff directory.
--   Fixing the policy removes the trap rather than relying on nobody stepping
--   in it.
--
-- WHAT STAYS WORKING
--   * A user reading their OWN row before their clinic is known. This is load
--     bearing: AuthContext fetches the profile to LEARN clinic_id, and
--     ClinicSetupWizard runs when clinic_id is still null. Without the
--     `id = auth.uid()` arm, login would deadlock — you would need your clinic
--     to read the row that tells you your clinic.
--   * Rows whose clinic_id is null (pre-015 data), same allowance the other
--     policies in 016 make.
--   * `useProfileNames`, which labels history (who did this job). A REMOVED
--     worker keeps working: removal sets clinic_id = null, which the third arm
--     still allows.
--   * profiles_update_own is untouched.
--
-- THE ONE VISIBLE CHANGE
--   A worker who left and was re-linked to a DIFFERENT clinic in the same
--   project becomes unreadable here, so old jobs they did would show a blank
--   name instead of theirs. That is the correct answer — one lab must not read
--   another lab's staff list — but it is a real difference, so it is written
--   down rather than discovered.

set lock_timeout = '10s';

drop policy if exists "profiles_read" on public.profiles;

create policy "profiles_read" on public.profiles
  for select using (
    -- Always your own row: this is how the app discovers which clinic you are
    -- in, so it cannot itself depend on knowing that.
    id = auth.uid()
    -- Colleagues in the same clinic.
    or clinic_id = my_clinic_id()
    -- Legacy rows from before clinic_id existed.
    or clinic_id is null
  );

-- Verification, to run after applying:
--
--   select count(*) from public.profiles;
--
-- As an owner this must return the number of people in YOUR clinic (plus any
-- legacy null-clinic rows), not the project-wide total. If the number does not
-- change, either there is only one clinic in this project or the policy did not
-- replace cleanly — check with:
--
--   select polname, pg_get_expr(polqual, polrelid)
--     from pg_policy where polrelid = 'public.profiles'::regclass;

-- ============================================================================
-- Wivo — read-only: rows that point at a sign-in account that no longer exists
-- ============================================================================
--
-- After sql/107 two foreign keys to auth.users can stay NOT VALID: 107 adds
-- them, and validating fails while an old row points at a missing account.
--   profiles.id        -> auth.users  ON DELETE CASCADE   (the person's profile)
--   clinics.created_by -> auth.users  ON DELETE SET NULL (who made the clinic)
-- Such rows appear when an account is deleted while those keys are missing:
-- the delete should have removed the profile and emptied created_by, and
-- without the key nothing did.
--
-- Paste into the SQL Editor. One SELECT: it reads and changes nothing.
-- One row per orphan, with what still hangs on it.
-- No rows: nothing points at a missing account, and both keys can be
-- validated.
-- ============================================================================

select 'profiles.id' as points_from,
       p.id as missing_account,
       p.full_name as name,
       p.role,
       p.clinic_id,
       p.created_at,
       (select count(*) from public.jobs j where p.id in (j.assigned_to, j.designed_by)) as jobs,
       (select count(*) from public.work_hours w where w.profile_id = p.id) as work_hours,
       (select count(*) from public.worker_payouts w where w.profile_id = p.id) as payouts
  from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id)
union all
select 'clinics.created_by', c.created_by, c.name, null, c.id, c.created_at, null, null, null
  from public.clinics c
 where c.created_by is not null
   and not exists (select 1 from auth.users u where u.id = c.created_by)
 order by 1, 6;

-- Wivo — migration 018: let clinic owners update worker profiles
--
-- The owner needs to set clinic_id on new worker profiles.
-- Run in the Supabase SQL editor (Wivo closed).

-- Owner can update any profile in their clinic
create policy "profiles_update_clinic_owner" on public.profiles
  for update using (
    clinic_id = (select clinic_id from public.profiles where id = auth.uid() and role = 'owner')
    or
    -- Also allow updating profiles with no clinic (newly created workers)
    (clinic_id is null and (select role from public.profiles where id = auth.uid()) = 'owner')
  );

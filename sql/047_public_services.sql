-- ============================================================================
-- Wivo — migration 047: patient-facing service catalogue for the public website
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY A NEW COLUMN AND NOT MORE FIELDS ON `work_types`
--   `work_types` is the LABORATORY's catalogue and it cannot carry this:
--
--   1. Its ORDER is match order. `resolveWorkType()` walks the list and the
--      first hit wins, which is why "Implantkroon" must sit above "Kroon".
--      Reordering it to please a marketing page would recolour the calendar and
--      REPRICE JOBS.
--   2. It carries `kulud` — cost, i.e. margin. A separate column means the
--      public edge function's query never names that column at all. A
--      structural guarantee beats a filtering discipline.
--   3. The relationship is n:m. Whitening and hygiene involve no lab work at
--      all; `IBT` and `Retainer` are lab vocabulary no patient shops for.
--   4. `WorkType.hind` is what the LAB charges the CLINIC. The patient price
--      includes chair time and the clinic's margin — a different number.
--   5. `removeWorkType()` deletes by name, so a lab tidy-up would silently
--      unpublish a website service.
--
-- WHY `public_slug`
--   So the public URL carries a name the owner chose rather than a raw
--   `clinic_id` uuid. A uuid in a query string invites probing; a slug does not.
--   Nullable: a clinic without one simply has no public site.
--
-- RLS: NOTHING NEW IS NEEDED, AND THAT IS DELIBERATE
--   `public_services` inherits `clinic_settings`' existing policies
--   (`clinic_id = my_clinic_id()`), which is exactly right — staff edit it in
--   Seaded, and the public never touches this table directly. The website reads
--   it through an edge function holding the service key, per HANDOFF.md:
--   "Public surfaces go through an edge function holding the service key, never
--   through an anon session." Do NOT add a `to anon` policy here.
-- ============================================================================

set lock_timeout = '10s';

alter table public.clinic_settings
  add column if not exists public_services jsonb not null default '[]'::jsonb;

alter table public.clinics
  add column if not exists public_slug text;

-- Partial, so the many clinics with no public site do not collide on NULL.
create unique index if not exists clinics_public_slug_idx
  on public.clinics (public_slug)
  where public_slug is not null;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public'
--    and (table_name, column_name) in
--        (('clinic_settings','public_services'), ('clinics','public_slug'));
--   -> two rows: jsonb not null default '[]'::jsonb, and text nullable
--
-- Confirm NO anonymous policy was added by accident:
-- select polname, polroles::regrole[] from pg_policy
--  where polrelid = 'public.clinic_settings'::regclass;
--   -> no policy naming `anon`

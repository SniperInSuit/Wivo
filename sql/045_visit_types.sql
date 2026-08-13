-- ============================================================================
-- Wivo — migration 045: visit types (why the patient is coming in)
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   A visit already had a STATUS — booked, arrived, done, no-show, cancelled —
--   which is where the appointment has got to. It had no answer to what the
--   appointment is FOR: a check-up, an impression, a try-in, a root canal.
--   Those are the difference between a ten-minute slot and an hour, and between
--   a visit the lab must have work ready for and one it need not.
--
--   Free text on the visit + a user-owned coloured list in settings, exactly
--   like the lab's `work_types`. Not an enum: every practice's vocabulary is
--   its own, and a check constraint would need a migration per clinic.
--
-- TWO COLUMNS, TWO PLACES
--   `visits.tyyp`               — the value on one appointment
--   `clinic_settings.visit_types` — the list and its colours, per clinic
--
-- NULL IS A REAL ANSWER
--   Every existing visit gets NULL and reads as "Määramata", drawn grey. The
--   type is never required: a front desk booking someone in a hurry must not be
--   blocked by a dropdown.
-- ============================================================================

set lock_timeout = '10s';

alter table public.visits
  add column if not exists tyyp text;

alter table public.clinic_settings
  add column if not exists visit_types jsonb not null default '[]'::jsonb;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public'
--    and (table_name, column_name) in (('visits','tyyp'), ('clinic_settings','visit_types'));
--   -> two rows: text, jsonb

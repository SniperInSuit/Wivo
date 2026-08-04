-- ============================================================================
-- Wivo — migration 037: feature flags on clinic_settings
-- Run in the Supabase SQL editor with Wivo CLOSED.
-- ============================================================================
--
-- WHY
--   WivoLab is workflow management for a dental LABORATORY. The patient record
--   this app grew — treatment notes, allergies, occlusion, TMJ, a four-state
--   tooth chart — is a clinical record a lab does not need, and it is GDPR
--   Art. 9 special-category data. Collecting it "just in case" is a liability,
--   not a feature. Same for visit booking, which is a practice's front desk.
--
--   None of it is DELETED, because `jobs.patient_id` threads through invoices,
--   payroll and the calendar, and because the clinic-side product will want
--   exactly this code back. It goes behind a flag instead.
--
-- DEFAULT
--   `{}` — an empty object, so `features.clinical` reads as undefined and the
--   app applies its own default (off). A lab that wants the clinical side
--   switches it on in Seaded; nothing is lost either way, the data stays in the
--   tables and reappears the moment the flag flips back.
-- ============================================================================

set lock_timeout = '10s';

alter table public.clinic_settings
  add column if not exists features jsonb not null default '{}'::jsonb;

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- select clinic_id, features from public.clinic_settings;
--   -> features = {} on every existing row.

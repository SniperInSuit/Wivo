# Wivo (Workly repo)

Electron + React + TypeScript desktop app with a Supabase/Postgres backend.

## Read first
- wivo-2.0-spec.md: Wivo 2.0 build plan (in Estonian). Its locked decisions are final.
- docs/VISION.md: the long-term product vision (consultation to procedure day), its build order and its locked rules.
- HANDOFF.md, NEXT.md, Testing.md: current state and testing notes.
- docs/night-run/INSTRUCTIONS.md: rules for unattended runs.

## Rules
- Migrations are numbered SQL files in sql/ (next one is 095_...). Only add new files. Never edit or delete existing ones.
- Every new table gets org_id and RLS in the same migration, plus an RLS leak test.
- The app uses only the anon key. The service-role key lives only in Edge Functions.
- All UI text goes through i18n keys. English is the source language, Estonian and Russian are translations.
- Everyday work never connects to the production Supabase project: local Supabase, the PGlite tests or a test copy only.
- Production changes happen only in a session Kevin explicitly starts for that purpose. Everything is tested on a test copy first. Migrations are applied in order by Claude with Kevin's approval, never by hand.
- Never push, merge or force anything.
- Wivo is not a medical device: no feature may recommend or rank treatment based on patient data.
- No personal data crosses borders between clinics (lawyer's locked decision). A partner organisation sees only job information, never who the patient is: no name, personal code, contacts, birth date, medical card, visit notes or prices, through any view, RPC, file, notification or e-mail. Full visibility is off (sql/092); free text a partner reads may not name the patient.

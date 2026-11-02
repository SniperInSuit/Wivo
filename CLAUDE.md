# Wivo (Workly repo)

Electron + React + TypeScript desktop app with a Supabase/Postgres backend.

## Read first
- wivo-2.0-spec.md: Wivo 2.0 build plan (in Estonian). Its locked decisions are final.
- HANDOFF.md, NEXT.md, Testing.md: current state and testing notes.
- docs/night-run/INSTRUCTIONS.md: rules for unattended runs.

## Rules
- Migrations are numbered SQL files in sql/ (next one is 092_...). Only add new files. Never edit or delete existing ones.
- Every new table gets org_id and RLS in the same migration, plus an RLS leak test.
- The app uses only the anon key. The service-role key lives only in Edge Functions.
- All UI text goes through i18n keys. English is the source language, Estonian and Russian are translations.
- Everyday work never connects to the production Supabase project: local Supabase, the PGlite tests or a test copy only.
- Production changes happen only in a session Kevin explicitly starts for that purpose. Everything is tested on a test copy first. Migrations are applied in order by Claude with Kevin's approval, never by hand.
- Never push, merge or force anything.
- Wivo is not a medical device: no feature may recommend or rank treatment based on patient data.
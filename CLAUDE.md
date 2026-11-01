# Wivo (Workly repo)

Electron + React + TypeScript desktop app with a Supabase/Postgres backend.

## Read first
- wivo-2.0-spec.md: Wivo 2.0 build plan (in Estonian). Its locked decisions are final.
- HANDOFF.md, NEXT.md, Testing.md: current state and testing notes.
- docs/night-run/INSTRUCTIONS.md: rules for unattended runs.

## Rules
- Migrations are numbered SQL files in sql/ (next one is 068_...). Only add new files. Never edit or delete existing ones.
- Every new table gets org_id and RLS in the same migration, plus an RLS leak test.
- The app uses only the anon key. The service-role key lives only in Edge Functions.
- All UI text goes through i18n keys. English is the source language, Estonian and Russian are translations.
- Never connect to the production Supabase project. Local Supabase or the test project only.
- Never push, merge or force anything.
- Wivo is not a medical device: no feature may recommend or rank treatment based on patient data.
# Workly — Handoff Notes

## Current version: 1.1.0

> **Process rule:** every change ships as a new version — bump `package.json` **and** add a
> `CHANGELOG.md` entry. The changelog is the audit trail we show authorities to prove what the
> software does and when it changed. No silent edits.

---

## What was just finished (this session)

**Patient profiles + ravikaart (roadmap item 1 — done).**
- `sql/001_patients.sql` — `patients` table + `jobs.patient_id` FK + realtime publication.
- `sql/003_patient_teeth.sql` + `sql/004_patient_teeth_realtime.sql` — tooth statuses, new patient
  columns, realtime. Run as **separate queries with the app closed** — together they deadlock (40P01).
- `sql/002_patients_rls.sql` — RLS policy for `patients`. **Both must be run in the Supabase SQL
  editor.** Without 002 the page loads but every write is rejected (RLS `42501`) and reads return
  zero rows — that is what made the buttons look dead in 1.0.46.
- `types/patient.ts`, `hooks/usePatients.ts` (CRUD + realtime + backfill mutation)
- `PatientPicker` combobox replaces the plain Patsient text input on the job form
- New **Patsiendid** view: list + profile with Ülevaade / Ravikaart / Tööd tabs
- Backfill button links every existing job to a generated patient record
- 1.0.45 changelog entry was missing and has been reconstructed from these notes

**Design decision:** `jobs.patsient` (free-text name) is *kept* next to `patient_id` as a
denormalised display value. Every board/table/calendar/stats view still reads it, so nothing
had to be rewritten and imported rows keep working while unlinked.

### Not yet done in this area
- Attachments on the patient profile (photos, files) — needs Supabase Storage
- Stats view still groups by `patsient` string, not `patient_id` (duplicate spellings stay separate)
- CSV import does not auto-create patient records — run the backfill button after importing

---

## Roadmap — agreed next steps

### 1. Invoices / PDF export (needed for accounting)
- Per-job invoice: patient name, teeth, work type, price, date, lab details
- Monthly summary PDF: all jobs in period, totals, paid vs outstanding
- Library to use: `@react-pdf/renderer` or just `window.print()` with a styled print layout

---

### 2. Price templates
- Define: "Allon4 → 320 €", "Kroon → 95 €", "Implantkroon → 150 €" etc.
- When creating a job and picking work type, price auto-fills from template
- Stored in Supabase (settings table) or localStorage
- Note: the 320 € example was made up — user defines their own prices

---

### 3. Global search (Cmd+K)
- Search across patient names, job types, FDI numbers, notes
- Quick keyboard shortcut overlay
- Results show job card with status + click to open detail

---

### 4. Dark mode / configurable themes
- Tailwind CSS variables already in place — relatively quick to add
- Toggle in settings, persisted to localStorage
- Optional: a few preset color themes (accent color picker)

---

### 5. Deadline alerts
- Visual urgency on board cards: yellow ring = due tomorrow, red = due today/overdue
- Optional: system notification (Electron supports this natively)

---

## Legal / compliance notes

- **Ravikaart / patient health data** = GDPR Article 9 (special category). Need: privacy policy, data processing register, DPA with any clients if software is sold.
- **Photos of dental work** (models, crowns) = NOT personal data. Fine to store.
- **Medical device (MDR)** = does NOT apply to production tracking / invoicing software. No CE marking needed.
- **Selling the software** = add: T&Cs, privacy policy, DPA template. No medical license needed.
- **RLS is ON** for `jobs`, `patients` and `patient_teeth`, but every one of them uses an open `Allow all for anon` policy — anyone holding the anon key can read every ravikaart. That is acceptable only while this is a single-user local tool with the key kept private. Authenticated-only replacements are commented at the bottom of `sql/002_patients_rls.sql` and `sql/003_patient_teeth.sql`; enable them together with auth before real patient health data goes in.
- **Every release is recorded in `CHANGELOG.md`** — this is the change-history evidence for any authority review. Keep it complete.

---

## Future / bigger picture

**Path A** (solo lab tool — current direction): patients, invoices, PDF, search, themes. Weeks of work.

**Path B** (multi-tenant SaaS for clinics): multi-user auth, role-based access (supervisor/technician), org isolation, billing. Supabase handles the auth/RLS side. Months of work — do this after Path A is solid.




THIS WAS NEEDED TO DO BEFORE THE CLAUDE SERVER CRASH:
Patient page. Can we move Tellimus and Kuupäev be on top of eachother to get more space and compact. Also the Status could just be a color infront of the box, like the side is colored and the colors are explained little on the bottom edge of the Tööde ajalugu box.

Btw dont forget to upgrade the version of the software from every change, 1.1.1 or whatever it is already

Redesign the job details modal to feel like a professional production record rather than a CRUD form. The production timeline should always be visible—even after completion—and act as the visual backbone of the page. The header should establish the job identity, followed by the timeline, then a two-column layout where the left side contains grouped technical production data (job details, manufacturing details, files) and the right side contains payment and invoice information. Use compact, information-dense cards with clear hierarchy, reduce unnecessary whitespace by roughly 20%, and make the interface feel closer to Linear or Stripe than a typical business form. Every section should have a clear purpose, subtle icon, and consistent spacing. The modal should tell the complete story of how the restoration was produced, from creation through every production stage, revisions, and completion, while remaining calm, clinical and premium.(added imag)
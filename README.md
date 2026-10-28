# Wivo — Dental Production Tracker

A local Electron desktop app for tracking dental restoration jobs through a six-stage
production pipeline. Data persists to **Supabase** (hosted Postgres) so it's backed up
and accessible from anywhere.

---

## Prerequisites

- Node.js 18+ (tested on v22/v24)
- A [Supabase](https://supabase.com) account (free tier is fine)

---

## 1 — Create the Supabase project

1. Log in to [app.supabase.com](https://app.supabase.com) and create a new project.
2. Note your **Project URL** and **anon/public API key** from
   *Project Settings → API*.
3. Open the **SQL Editor** and run [`sql/000_jobs.sql`](sql/000_jobs.sql), then
   every file in [`sql/`](sql/) in numerical order.

   > The SQL used to be written out here, and that copy is the reason this
   > section changed. It was the 2024 single-table MVP; the app moved on, the
   > snippet did not, and five columns every job insert writes — `masina`,
   > `print_id`, `kiirtoo`, `disain_hind`, `revisions` — ended up created in no
   > file at all. A fresh database could not store a single job.
   >
   > `sql/000_jobs.sql` is now the one definition, and `sql/jobsColumns.test.ts`
   > fails the build if a field in `types/job.ts` is not created by some
   > migration. Please do not paste a copy back into this file.

4. (Optional) Enable **Realtime** for the `jobs` table under
   *Database → Replication → Tables* to get live updates in Phase 2.

---

## 1b — Run the migrations

Migrations live in [`sql/`](sql/) and are numbered in the order they must be applied.
Paste each file into the Supabase **SQL Editor** and run it.

| File | Adds | App version |
|---|---|---|
| `sql/001_patients.sql` | `patients` table + `jobs.patient_id` | 1.0.46 |
| `sql/002_patients_rls.sql` | RLS policy for `patients` (required — without it every write is rejected) | 1.0.47 |
| `sql/003_patient_teeth.sql` | `patient_teeth` table + `patients.varvi_eelistus` / `patients.markused` (required — without it patients cannot be saved) | 1.1.0 |
| `sql/004_patient_teeth_realtime.sql` | realtime sync for `patient_teeth` (optional) | 1.1.0 |
| `sql/005_job_notes.sql` | `jobs.markused` — notes on a job (required for the Märkused box) | 1.1.3 |
| `sql/006_patient_tmj.sql` | `patients.lougaliiges` — TMJ field (required, or saving a patient fails) | 1.1.4 |
| `sql/007_visits.sql` | `visits` table — patient appointments (required for the Visiidid calendar) | 1.3.0 |
| `sql/008_visits_realtime.sql` | realtime sync for `visits` (optional) | 1.3.0 |
| `sql/009_visit_status.sql` | two more visit states — `saabunud`, `ei_tulnud` (required for the quick-action buttons) | 1.4.0 |

**Quit the Wivo app before running a migration**, and run each file as its own query. An open
instance holds realtime subscriptions on `patients` and `jobs`; an `ALTER TABLE` and an
`ALTER PUBLICATION` in the same transaction against those locks deadlocks with `40P01`.

Until `001` is applied, the **Patsiendid** view shows a "table not found" notice and saving
a job fails on the unknown `patient_id` column. Until `003` is applied, saving or creating a
patient fails on the unknown `markused` column and the tooth chart cannot store anything.

---

## 2 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Never commit `.env` — it's in `.gitignore`.

---

## 3 — Install and run

```bash
npm install
npm run dev        # Development — hot reload, opens Electron window
```

---

## Build & package

```bash
npm run build      # Production build → out/
npm run dist       # Packaged installer → dist/   (Phase 2)
```

---

## Pipeline stages (Estonian)

| Key | Label | Description |
|---|---|---|
| `disain` | Disain | Design |
| `print` | Printimine | Printing |
| `poleeri` | Poleerimine | Polishing |
| `puhasta` | Puhastamine | Cleaning |
| `varvi` | Värvimine | Paint / characterize |
| `valmis` | Valmis | Done |

---

## Field reference (Estonian ↔ column)

| UI (ET) | Column | Notes |
|---|---|---|
| Kuupäev | `kuupaev` | Date received |
| Patsient | `patsient` | Patient name (display value, kept for legacy/imported rows) |
| Patsient (seotud) | `patient_id` | FK → `patients.id`, set via the patient picker |
| Töö | `too` | Work type |
| Materjal | `materjal` | Resin material |
| Värv | `varv` | VITA shade |
| x Ham | `hambad` | FDI tooth numbers |
| Valmis aeg | `valmis_aeg` | Deadline |
| Muudatused | `muudatused` | Revision notes |
| Hind | `hind` | Price (EUR) |
| Makstud | `makstud` | Paid yes/no |
| Makse kuupäev | `makse_kuupaev` | Payment date |

---

## Tech stack

- Electron + electron-vite
- React 18 + TypeScript
- Tailwind CSS
- Supabase (`@supabase/supabase-js`)
- React Query (`@tanstack/react-query`)
- framer-motion, lucide-react, date-fns, recharts

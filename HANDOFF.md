# Wivo — Handoff Notes

## Current version: 1.7.9

> **Migration rule:** never edit a migration that has already been run — an applied
> migration is history, and editing it changes nothing in the database. Add a new numbered
> file instead.
>
> **Process rule:** every change ships as a new version — bump `package.json` **and** add a
> `CHANGELOG.md` entry. The changelog is the audit trail.

---

## What was done this session (v1.6.1 → v1.7.9)

### Rename: Workly → Wivo
- All code, configs, SQL comments, docs renamed
- New logo `src/renderer/src/assets/Wivo Logo.png` used in sidebar + login
- `package.json`: name `wivo`, appId `com.wivo.dental`, productName `Wivo`
- Build icon at `build/icon.png`

### Navy Cloud theme polish
- TopBar + calendar header use `bg-nav-bg` with `text-nav` tokens (theme-aware, works on all themes)
- Calendar grid: rounded day cards with gaps (lifted effect)
- Job detail panel: navy background with white cards
- Timeline: hour dots, dotted stems, visit start/end dots, vertical current-time line
- Table zebra: `#f0f4f6` instead of transparent
- All hardcoded `text-white` replaced with `text-nav` (readable on both hele and navy themes)

### Calendar improvements
- Continuous scrollable month grid (±3 months, no pagination)
- Continuous scrollable week grid (±13 weeks horizontal)
- Smooth sliders for both views
- Click-drag to select time range in week view → creates visit with correct duration
- Filter bar: multi-select dropdowns for Patient, Work type, Doctor
- Visit cards left-aligned to start time (not centered)
- Late visit detection (5+ min past start, red card + "hilines")
- Month numbers on day headers (e.g. 30.07)

### New fields
- `kirjeldus` — description field on original job (migration 010)
- `disain_id` — design reference ID next to Print ID (migration 011)
- `reason` — revision change reason with 9 presets (on Revision type, no migration needed — JSONB)

### Dashboard additions
- Stacked bars: original vs revision teeth (both by work type and by patient)
- Revision rate per work type (color-coded progress bars)
- Revision reasons breakdown chart
- Original + revision count on revenue table (e.g. "8× + 2m")
- Removed duplicate "Uus töö" button from overview

### Auth system (Phase 1 — v1.7.0)
- Supabase Auth with email/password login
- `profiles` table with roles (owner/worker/patient)
- First user = owner automatically
- Login page, AuthGuard, AuthContext
- Profile name saves to DB (not localStorage)
- Logout button in TopBar
- Password visibility toggle on login

### Clinic entity (Phase 2 — v1.7.1)
- `clinics` table with full business details (name, address, reg code, KMKR, bank, IBAN)
- `clinic_id` on jobs, patients, visits
- RLS isolation via `my_clinic_id()` function
- First-run wizard for clinic setup
- Clinic settings editable in Seaded → Kliinik
- Existing data auto-backfilled to clinic on setup

### Permissions (Phase 3 — v1.7.7)
- `worker_permissions` table with 11 permission keys
- `usePermissions()` hook with `can('jobs.read')` API
- Meeskond page: list workers, toggle permissions per worker
- Owner creates worker accounts with password (no email verification for workers)
- Sidebar items hidden based on permissions
- Owner can update worker profiles (migration 018)

---

## Migrations to run (in order)

If starting from v1.6.0, run ALL of these in Supabase SQL editor (Wivo closed):

1. `sql/010_job_kirjeldus.sql`
2. `sql/011_job_disain_id.sql`
3. `sql/012_profiles.sql` — enable Email provider in Supabase Auth first
4. `sql/013_auth_rls.sql` — locks out anon access, login required after this
5. `sql/014_clinics.sql`
6. `sql/015_add_clinic_id.sql`
7. `sql/016_clinic_rls.sql`
8. `sql/017_permissions.sql`
9. `sql/018_profiles_owner_update.sql`

**Supabase Auth settings:**
- Enable Email provider (Authentication → Providers → Email)
- Disable "Confirm email" for smoother worker onboarding
- Site URL: set to your Supabase project URL (not localhost)

---

## What's next

### Phase 4: Invoicing + Payments
- `invoices` table (number, status, dates, totals, tax)
- `invoice_lines` (job_id, description, qty, price)
- `payments` table (amount, method, reference, recorded_by)
- `worker_earnings` table + `jobs.assigned_to`
- Invoice PDF generation
- Migrate `jobs.makstud` boolean → proper payment records
- New sidebar item "Arved"

### Phase 5: Settings Migration
- Move material prices, pipeline stages, calendar config from localStorage to DB
- Split `useSettings` into clinic settings (DB) + user prefs (localStorage)

### Backlog
- Customize Supabase email templates (branding, Estonian, custom SMTP)
- Calendar filter persistence
- Global search (Cmd+K)
- Deadline alerts / notifications

---

## Legal / compliance

- **Patient portal: REMOVED** — giving patients access to health data would classify as Medical Device under EU MDR. Software stays staff-only.
- **GDPR Art. 9** — ravikaart, allergiad, etc. are special category data. Auth + RLS now protects them.
- **RLS is active** — all tables use clinic-based isolation. Anon key can no longer read data.
- **MDR does NOT apply** — production tracking + invoicing for clinic staff is not a medical device.

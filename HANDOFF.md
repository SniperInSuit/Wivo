# Workly — Handoff Notes

## Current version: 1.0.45

---

## What was just finished (this session)

- Top patsiendid chart now sorts by **tooth count**, not job count
- "Hambaid toodetud" stat card shows inline breakdown: `127 originaal · 77 muudatused`
- Removed the two standalone cards from Hammaste analüüs (info now in top card)
- "Hambad töötüübi järgi" chart got a subtitle: "Kokku toodetud hambad töö liigi kaupa"

---

## Roadmap — agreed next steps

### 1. Patient profiles + ravikaart (HIGH PRIORITY — doctor already asked)
Currently `patsient` is just a free-text string on a job. Needs to become a real entity.

**What to build:**
- New `patients` table in Supabase: name, DOB, contact, doctor/clinic, notes (ravikaart), material preferences, jaw info
- Jobs linked to `patient_id` instead of a plain string
- Patient profile page: job history, total teeth, total invoiced, outstanding balance, attachments
- Ravikaart tab: treatment notes, allergies, preferences

---

### 2. Invoices / PDF export (needed for accounting)
- Per-job invoice: patient name, teeth, work type, price, date, lab details
- Monthly summary PDF: all jobs in period, totals, paid vs outstanding
- Library to use: `@react-pdf/renderer` or just `window.print()` with a styled print layout

---

### 3. Price templates
- Define: "Allon4 → 320 €", "Kroon → 95 €", "Implantkroon → 150 €" etc.
- When creating a job and picking work type, price auto-fills from template
- Stored in Supabase (settings table) or localStorage
- Note: the 320 € example was made up — user defines their own prices

---

### 4. Global search (Cmd+K)
- Search across patient names, job types, FDI numbers, notes
- Quick keyboard shortcut overlay
- Results show job card with status + click to open detail

---

### 5. Dark mode / configurable themes
- Tailwind CSS variables already in place — relatively quick to add
- Toggle in settings, persisted to localStorage
- Optional: a few preset color themes (accent color picker)

---

### 6. Deadline alerts
- Visual urgency on board cards: yellow ring = due tomorrow, red = due today/overdue
- Optional: system notification (Electron supports this natively)

---

## Legal / compliance notes

- **Ravikaart / patient health data** = GDPR Article 9 (special category). Need: privacy policy, data processing register, DPA with any clients if software is sold.
- **Photos of dental work** (models, crowns) = NOT personal data. Fine to store.
- **Medical device (MDR)** = does NOT apply to production tracking / invoicing software. No CE marking needed.
- **Selling the software** = add: T&Cs, privacy policy, DPA template. No medical license needed.

---

## Future / bigger picture

**Path A** (solo lab tool — current direction): patients, invoices, PDF, search, themes. Weeks of work.

**Path B** (multi-tenant SaaS for clinics): multi-user auth, role-based access (supervisor/technician), org isolation, billing. Supabase handles the auth/RLS side. Months of work — do this after Path A is solid.

# Changelog

## [1.0.44] — 2026-07-29
- **Töid kokku includes revisions**: stat card now shows `tööd + muudatused` as the total work count, with the breakdown ("N tööd · M muudatust") in the subtitle

## [1.0.43] — 2026-07-29
- **Revenue now includes revision prices**: all stats that sum money (`Käive kokku`, `Makstud`, `Maksmata`, `Ø hind/töö`, `Kiirtöö käive`, monthly chart) now add `rev.price` for every revision on each job — fixes the 2557 vs 1905 discrepancy
- **Hambaid toodetud includes revision teeth**: total tooth count and average teeth/job now sum revision teeth too, not just the main job's `hambad`
- **Duplicate jaw picker removed**: only one Allon jaw picker remains (inline under the Töö field)

## [1.0.42] — 2026-07-29
- **Shade A2.5 added**: between A2 and A3 in the VITA picker
- **Revision material picker**: "Uus materjal" section in both add and edit revision forms — same pill + shade sub-selector as the main job form; stored in `revision.materjal`
- **Allon jaw selector**: when Töö starts with "Allon" (4/5/6), two buttons appear — "Ülemine" / "Alumine" — clicking appends/removes the jaw suffix from the `too` field (e.g. "Allon4 ülemine")
- **Statistics period filter fixed**: `filterByPeriod` now uses `kuupaev` (actual received date) instead of `created_at` (import timestamp) — fixes all imported jobs showing in the same period; revenue/throughput charts also switched to `kuupaev`

## [1.0.41] — 2026-07-29
- **Fixed "1H shown, none selected" on imported revisions**: whitespace-only `hambad` values (e.g. `" "`) now filtered with `t.trim()` instead of `Boolean` — so a stray space no longer counts as a tooth
- **Auto-price now works when editing a priceless revision**: edit mode starts with `priceIsAuto = true` when the revision has no price yet (same logic as the main job form); editing a revision that already has a price still leaves it untouched
- **Teeth normalized on edit load**: imported `rev_hambad` strings are trimmed and cleaned when loaded into the edit form, preventing whitespace tokens from reaching the odontogram or price calculator

## [1.0.40] — 2026-07-29
- **Table: rich Muudatused column** — each revision shown as its own row with `#N` index, a coloured status dot (matching pipeline colour), truncated note, and price badge; up to 3 revisions visible with "+N veel" overflow; newest first; reads `revisions[]` array (old legacy field was ignored)

## [1.0.39] — 2026-07-29
- **Valmis week filter respects revision completion**: a merged card now appears in the current week's Valmis column when any completed revision's deadline (or creation timestamp) falls in that week — the original job's receive date (`kuupaev`) is no longer the only anchor

## [1.0.38] — 2026-07-29
- **Revision status picker**: both "Lisa muudatus" and the revision edit form now show pipeline stage pills — set a revision to Valmis (or any stage) directly when adding or editing
- **Fixed auto-price on 2nd+ revision**: replaced `useRef` with `useState` for the auto-price flag in `RevisionForm` — ensures flag is properly reset on each fresh mount so the 2nd, 3rd… revision forms all auto-fill price from tooth count
- **Teeth before payment (side panel)**: FDI odontogram now appears above "Hind ja maksmine"
- **Auto-price on existing jobs with no price**: opening a priceless job and selecting teeth now auto-fills at 15 €/tooth
- **Fixed hindAutoRef closure bug**: `PricingBlock` now receives `onHindChange` prop instead of referencing `hindAutoRef` across component boundaries
- **New Töö suggestions**: Abutmendile kroon, Implantkroon, Nightguard, Retainer, Splint

## [1.0.37] — 2026-07-29
- **Teeth before payment**: "Hambad (FDI)" now appears above "Hind ja maksmine" in the side panel
- **Auto-price on existing jobs**: opening a job that has no price set and selecting teeth now auto-fills the price (same 15 €/tooth logic as new jobs); jobs that already have a price are unaffected
- **Fixed hindAutoRef closure bug**: price input in the PricingBlock now correctly disables auto-price mode when manually edited (was silently broken due to a cross-component scope issue)
- **New work type suggestions**: "Abutmendile kroon", "Implantkroon", "Nightguard", "Retainer", "Splint" added to the Töö autocomplete
- **Revision hover contrast**: hover background darkened to `slate-900`, text brightened (`slate-300`/`slate-100`), badges use `slate-500` for clearer contrast

## [1.0.36] — 2026-07-29
- **Live auto-price on new jobs**: selecting teeth auto-fills "Hind kokku" — formula: per-material price from settings (default 15 €/tooth), ×2 if Kiirtöö is on; manually typing a price disables auto-fill for that session
- **Live auto-price on new revisions**: selecting teeth in "Lisa muudatus" auto-fills the revision price at 7.50 €/tooth; editing an existing revision never overwrites the stored price

## [1.0.35] — 2026-07-29
- **Editable revisions**: pencil icon on each muudatus row — click to edit note, price, kiirtöö, shade, teeth, deadline, print ID inline; "Salvesta" / "Tühista" buttons; "Muuda" link also appears at the bottom of the expanded read-only view
- **Print ID on revisions**: each revision now has its own Print ID field (SprintRay job number); shown as a `#badge` in the collapsed row and in the expanded details
- **Default tooth price 15€**: new material price entries default to 15 €/tooth (small and large) instead of 0; existing settings are unchanged

## [1.0.34] — 2026-07-29
- **Kiirtöö indicator everywhere**: orange ⚡ icon on board cards (top-right icon row), orange left border + ⚡ next to patient name in Table, small ⚡ before patient name in Calendar chips
- **Supabase Realtime sync**: app now subscribes to live Postgres changes — any change made on one computer (add, edit, delete, stage move) appears on the other instantly without refreshing

## [1.0.33] — 2026-07-29
- **Customizable pipeline**: Seaded → Töövoog — add, remove, rename, and reorder board columns; persisted in localStorage; changes reflect immediately across Tahvel, Tabel, Statistics, and the job status picker
- **Updated material list**: Crown HT (A1/A2/A3/BL1/BL2), Ceramic Crown (A1/A2/A3), OnX Tough 2 (A1/A2), NightGuard Firm 2, Apex Teeth, Apex Base, Retainer — removed old SprintRay-specific entries

## [1.0.32] — 2026-07-29
- **Board week navigation**: Valmis column header now has ‹ › arrows to browse completed jobs by week; clicking the date range returns to the current week
- **Revision pipeline independence**: adding a muudatus no longer resets the original job's status — the original stays where it is and the revision gets its own pipeline card starting at Disain; the revision's Prev/Next stage buttons only move the revision, not the original
- **Merged Valmis card**: when a revision's stage reaches Valmis, it merges with the original into a full-width card; the revision (left/prominent) now shows its updated shade, material, and teeth from the revision data — not just the original job's values
- Added `materjal` field to Revision type for per-revision material tracking

## [1.0.31] — 2026-07-29
- Board **Valmis** column is now double-wide (500 px) with a 2-column card grid so a full week of completed work doesn't require heavy vertical scrolling
- Board: jobs with revisions show a **separate navy "↩ Muudatus #N" card** immediately below the original in every pipeline stage — clicking it opens the job panel scrolled to that revision; stage-advance buttons work on both cards (they move the same underlying job)
- Board **Valmis**: jobs with revisions render as a **merged full-width card** — revision side (prominent, left) shows the muudatus note/deadline/price; original side (right, smaller) shows patient, work type, shade, price and original deadline
- Clicking a revision card in any stage opens the side panel with the revision auto-expanded and scrolled into view

## [1.0.30] — 2026-07-29
- Board cards: **Prev / Next stage buttons** at the bottom of each card — click to advance or retreat one step without opening the panel; next-stage button is tinted with the target stage's colour
- Time field reverted to plain HH:MM text input (was: drum scroller)

## [1.0.29] — 2026-07-29
- **24h clock fix**: Deadline inputs in revision block now use separate `date` + `time` inputs — `type="time"` always renders 24h in Chromium regardless of OS locale
- **Odontogram even spacing**: Arch angle now uses arcsin distribution (`Math.asin(2i/15−1) + π/2`) instead of linear — wisdom teeth get the same gap as front teeth
- **Statistics enhancements**: Added Kiirtöö count + revenue card, average turnaround (days), machine breakdown (Pro2/Midas), top patients chart, teeth-by-work-type chart; hambaid card now shows avg per job; revision rate now counts `revisions[]` array (not just legacy field)

## [1.0.28] — 2026-07-29
- Board cards: 3px coloured left border matching work type (same palette as calendar — Kroon=blue, Sild=violet, Viniir=emerald, etc.); also fixed revision indicator to use the new `revisions[]` array

## [1.0.27] — 2026-07-29
- Added **Ceramic Crown HT** to material list
- Material shade sub-selector: when Ceramic Crown, Ceramic Crown HT, or C&B Resin is selected, shade pills (A1, A2, A3, A3.5, B1…BL2) appear below — clicking stores e.g. "Ceramic Crown HT A2" as the material
- **Kiirtöö** (fast job) toggle on job form — lights up orange, labels "Kiirtöö — hind 2×"; auto-calculation and "Kanna hinna väljale" apply the 2× multiplier
- **Kiirtöö** toggle on revision add form — prices the revision at 2× (price entered × 2 stored); orange "⚡ 2×" badge shown in revision summary
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kiirtoo BOOLEAN NOT NULL DEFAULT false;`

## [1.0.26] — 2026-07-29
- Calendar: day cells now scroll vertically when they have more jobs than fit — all chips are rendered, no more "+N veel" truncation; 3px scrollbar appears on hover

## [1.0.25] — 2026-07-29
- Board: adding a revision to a job now auto-resets its status to **Disain** so it re-enters the pipeline and shows on the board
- Calendar: jobs also appear on their revision's deadline date — revision chips have a **dark navy left stripe** + "↩ muudatus" label to distinguish from the original
- Calendar: clicking a revision chip opens the bottom panel and **auto-scrolls to that revision** in the Muudatused block

## [1.0.24] — 2026-07-29
- Table: period filter pills in the toolbar — **Kõik kuupäevad / See nädal / See kuu / Eelmine kuu** — filter by `kuupaev`
- Table: bulk action bar now has a green **Makstud** button — marks all selected jobs as paid and sets payment date to today

## [1.0.23] — 2026-07-29
- Fixed datetime-local inputs showing AM/PM — Electron main process now launches Chromium with `--lang=et-EE` which forces 24-hour clock in all form controls

## [1.0.22] — 2026-07-29
- Bottom panel: colored stripe at the top of the rounded edge matches the job's work type (same palette as calendar chips — Kroon=blue, Sild=violet, etc.)

## [1.0.21] — 2026-07-29
- Calendar: clicking a job chip now opens the bottom sheet (same as the eye icon in Table), keeping the calendar visible above

## [1.0.20] — 2026-07-29
- Calendar: added work-type colors for Allon4/5/6=pink, Laminaat=lime, Täidis=yellow
- Job form: added Allon4, Allon5, Allon6, Laminaat, Täidis to the Töö autocomplete suggestions

## [1.0.19] — 2026-07-29
- Calendar: job chips now colored by work type instead of pipeline stage — soft pastel palette: Kroon=blue, Sild=violet, Viniir=emerald, Inlay=amber, Onlay=orange, Proteez=rose, Splint=cyan, IBT=indigo, Kirurgiline=teal; unknown types stay neutral gray; overdue (non-valmis, past deadline) still shows red

## [1.0.18] — 2026-07-29
- Board Valmis filter: switched from `updated_at` to `kuupaev` — import sets `updated_at` to now so all imported jobs were leaking into "this week"; now filters by the job's received date instead
- DeadlineChip: completed jobs (`status === 'valmis'`) no longer show "Tähtaeg möödas" — deadline chip shows the date in neutral styling instead

## [1.0.17] — 2026-07-29
- Board: **Valmis** column now shows only jobs completed this week (Mon–Sun based on `updated_at`); header badge shows this-week count, subtitle shows "see nädal · kokku N" so the total is always visible

## [1.0.16] — 2026-07-29
- Odontogram: FDI numbers moved out of the rotated tooth group into dedicated fixed rows — upper numbers sit above the gum band, lower numbers below it; font size increased from 7→9.5; selected teeth show their number in teal; clicking a label also toggles the tooth

## [1.0.15] — 2026-07-29
- Added **Print ID** field — stores the SprintRay job number so you can look up the print later; shown in the job form (after Masin) and as a column in Table view
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS print_id TEXT;`

## [1.0.14] — 2026-07-29
- Delete confirmation on all destructive actions — revision Trash icon now shows inline "Kustuta? [Jah] [Ei]" before deleting (job-level and bulk-table delete already had confirmation)

## [1.0.13] — 2026-07-29
- Calendar: each day cell shows a `+` button on hover — clicking it opens the new-job panel with that day pre-filled as the deadline (valmis_aeg)
- Table: Eye icon now always visible (faint gray), turns teal on row hover — was invisible until hover which made it hard to find

## [1.0.12] — 2026-07-29
- Added **Kalender** view — fourth toggle in the TopBar (Tahvel / Tabel / Kalender / Statistika)
- Monthly grid, week starts on Monday, Estonian month names and day labels (E T K N R L P)
- Jobs placed on their deadline date (valmis_aeg); overdue jobs shown in red
- Each cell shows patient name + work type, up to 5 chips per day then "+N veel"
- Today's date has teal highlight; out-of-month days are dimmed
- Toolbar shows count of scheduled jobs this month and count without a deadline
- ← / → navigation between months, "Täna" button to return to current month
- Click any job chip to open the full edit panel

## [1.0.11] — 2026-07-29
- Each revision (muudatus) now has its own price field (€); shown as a teal badge in the collapsed summary row
- Revisions are collapsed by default — click any entry to expand and see shade, teeth odontogram, new deadline, and price
- Revision block redesigned with dark navy/slate background (slate-800) to visually separate from other form content
- Eye icon (👁) in Table view — hover a row to see it; click Eye to open a bottom sheet instead of the side panel; clicking the row name still opens the normal right sidebar
- Bottom sheet slides up from the bottom (70vh), full screen width, two-column layout: metadata on the left, odontogram + revisions + pricing on the right — table remains visible above it

## [1.0.10] — 2026-07-29
- Settings panel now has small/large tooth pricing per material (position 1–5 = small, 6–8 = molar) and a global design fee (€/job)
- Job form pricing section shows auto-calculated breakdown: X small teeth + Y large teeth + optional design fee; "Kanna hinna väljale" copies the total to the Hind field
- Design fee has a one-click "Lisa/Lisatud" toggle so you can include/exclude it per job
- Added separate `Disain hind` (€) field on every job — tracks design cost (in-house or third-party) independently from the total job price
- **New Supabase column:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disain_hind NUMERIC(10,2);`

## [1.0.9] — 2026-07-29
- Multiple revisions per job — "Lisa muudatus" in the sidebar adds a new revision entry (note, shade, teeth, deadline); all revisions shown as a numbered list newest-first with expand/collapse for details; legacy single-revision data auto-migrated on load
- Full SprintRay material list: OnX Tough 2/S/S2, Ceramic Crown, C&B Resin, Model V2, Surgical Guide Plus, Splint, IBT, Denture Base, Denture Tooth
- Machine selector on each job: Pro2 / Midas
- Settings panel (gear icon in TopBar): configure default machine and per-material price per unit (€/tooth) stored in localStorage; job form shows "Arvuta automaatselt" button when material + teeth are set
- Fixed duplicate "Uus töö" button in Table view — removed from table toolbar since TopBar always has it
- **Requires Supabase migration:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS revisions JSONB NOT NULL DEFAULT '[]'; ALTER TABLE jobs ADD COLUMN IF NOT EXISTS masina TEXT;`

## [1.0.8] — 2026-07-29
- Fixed odontogram arch overlap — increased SVG height to 330, pushed arches apart (UCY=82, LCY=248 vs old 84/184), giving ~62px clear gap between bite surfaces; reduced tooth rotation factor from 0.5→0.38 for a gentler lean; slightly larger tooth rectangles for better clickability

## [1.0.7] — 2026-07-29
- Added bulk selection in Table view — checkbox on every row, select-all in header, teal highlight for selected rows
- Bulk action bar appears when any rows are selected: change status for all selected at once, or delete with confirmation
- Clicking a checkbox no longer opens the job panel (stopPropagation)
- Footer shows selected count alongside total/filtered count
- Visual SVG odontogram — teeth now rendered as a real dental arch with elliptic geometry, rotated rounded-rect teeth, pink gum backgrounds, and FDI labels; selected teeth fill teal

## [1.0.6] — 2026-07-29
- Fixed save not working: the submit button referenced `form="job-form"` but the form had no matching `id`, so the form submission never fired — added `id="job-form"` to the form element and removed the redundant `onClick` handler
- Added error display in the panel footer — if Supabase returns an error it now shows a red message instead of failing silently

## [1.0.5] — 2026-07-29
- Added **Tabel** view — third toggle in the top bar (Tahvel / Tabel / Statistika)
- Sortable columns: click any header to sort asc/desc
- Stage filter pills above the table to narrow by pipeline stage with live counts
- Search by patient name or work type
- Alternating row shading, status pills, shade swatches, tooth count, deadline coloring — same visual language as the board
- Clicking any row opens the full edit panel

## [1.0.4] — 2026-07-29
- Fixed import finding 0 rows — CSV has a revenue-total row first, then the real header row; parser now scans the first 5 rows and picks the one that best matches known header keywords
- Added status mappings for actual sheet values: Tehtud→Valmis, Tellimata/Tellitud→Disain, Printimata→Printimine, Prinditud→Poleerimine, Uus tehtud/Uus tellitud
- Added "DD.MM kell HH:MM" date format (no year) — assumes current year
- Import preview now shows patient name, work type, date and mapped stage instead of raw cell data

## [1.0.3] — 2026-07-29
- Fixed CSV import counting ~997 rows when the sheet has a data-validation dropdown extending to row 997 — now only imports rows where Patsient is non-empty

## [1.0.2] — 2026-07-29
- Fixed CSV import counting 997 rows instead of ~33 — Google Sheets exports semicolons as the delimiter in Estonian/European locales; the parser now auto-detects `,` vs `;` vs `\t` and also strips the UTF-8 BOM that some exports include


All notable changes to Workly are documented here.
Format: `[version] — date — summary`

---

## [1.0.1] — 2026-07-29
- Added CSV import — import jobs directly from a Google Sheets export via the "Import CSV" button in the top bar or the `node scripts/import-csv.mjs` CLI script
- Status values from the sheet (e.g. "Default", "Tailfinna ok") are automatically mapped to pipeline stages

## [1.0.0] — 2026-07-29
- Initial release — Phase 1 MVP
- Electron + React 18 + TypeScript app scaffolded with electron-vite
- Supabase backend wired up (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)
- Kanban board with drag-and-drop across six pipeline stages (Disain → Valmis), persisting to Supabase with optimistic updates
- Job detail slide-over panel with all fields: Kuupäev, Patsient, Töö, Materjal, Värv, Hambad, Valmis aeg
- 32-tooth FDI odontogram picker
- VITA Classical shade swatch picker (A1–D4) + free text
- Collapsible Muudatused (revision) block: rev. hambad, rev. värv, uus valmis
- Pricing block: Hind (€), Makstud toggle, Makse kuupäev
- Deadline chips with amber/red urgency coloring
- Statistika dashboard: summary cards, payment stats (donut + bar chart), material stats (bar + donut), production stats (WIP by stage + throughput line chart), period filter
- SprintRay-inspired styling — teal accent `#0AB6C4`, white cards, slate text

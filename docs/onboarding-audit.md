# Audit — the path from "external clinic" to "first Wivo revenue"

Read-only inspection of the repo at v1.35.0. No code was changed. Every claim
below cites the file it came from; where something is absent, the search that
found nothing is named so the claim can be re-checked.

**Legend** — ✅ works · 🟡 partial · ❌ missing · 🔧 manual by design

---

## 1. Gap map

### A. Provisioning a new clinic

| # | Checkpoint | Status | Evidence | Note |
|---|---|---|---|---|
| A1 | Scripted stand-up of a fresh instance | ❌ | no provisioning script in `scripts/` (only `make-license.mjs`, `import-csv.mjs`) | Purely manual; steps listed below |
| A2 | Migrations runnable fresh → working schema | ❌ **blocker** | `grep "create table.*jobs" sql/` → no match | **No migration creates the `jobs` table.** It exists only as a snippet in `README.md`, and that snippet is the 2024 single-table MVP |
| A3 | …and even with the README snippet | ❌ **blocker** | see A2 detail below | 5 columns the app writes on every insert are created **nowhere** |
| A4 | RLS initialised per new clinic | ✅ | `sql/016_clinic_rls.sql`, `my_clinic_id()` | Policies are table-level and scope on `my_clinic_id()`, so a new clinic needs no per-tenant RLS work |
| A5 | anon key only, no service-role | ✅ | `grep -rn "service_role" src/` → only comments in `WorkersPage.tsx` explaining its deliberate absence | Confirmed |
| A6 | First-run / setup state | ✅ | `Auth/ClinicSetupWizard.tsx`, `AuthContext.needsClinicSetup` | App does **not** assume a pre-seeded DB: a signed-up user with no clinic gets the wizard |

**A2/A3 in detail — the concrete blocker.** Migrations create 16 tables
(`clinics`, `profiles`, `patients`, `invoices`, `visits`, `worker_*`, …) but
never `jobs`. Reconstructing from `README.md` + `sql/001–045` still leaves these
`jobs` columns uncreated, verified by
`grep -rn "add column if not exists <col>" sql/`:

| Column | In README snippet? | Added by a migration? |
|---|---|---|
| `masina` | no | no |
| `print_id` | no | no (011 only *mentions* it in a comment) |
| `kiirtoo` | no | no |
| `disain_hind` | no | no |
| `revisions` | no | no (referenced by 003/021/022/026, created by none) |

Every job insert is a raw spread (`useJobs.ts:44`), so a missing column rejects
the whole row. This is the same failure mode that hit `mudel_id` and
`extra_costs` in production this week — those were caught because a live DB had
drifted; a *fresh* DB would hit five of them at once and no job could be created
at all.

**Manual steps as they stand today** (software-only and hosted are identical
here; hosted differs only in whose Supabase account it is):

1. Create a Supabase project, note URL + anon key.
2. Run the `README.md` SQL by hand → `jobs` table (incomplete, see above).
3. Run `sql/001` … `sql/045` in order in the SQL editor.
4. Hand-write the 5 missing `ALTER TABLE` statements — **currently undocumented,
   the operator must derive them from `types/job.ts`**.
5. Fill `.env` with URL + anon key, build/ship the app.
6. Owner signs up in-app → `ClinicSetupWizard` creates the `clinics` row.
7. Configure everything in section D.

### B. Licensing

| # | Checkpoint | Status | Evidence | Note |
|---|---|---|---|---|
| B1 | Key generator exists | ✅ | `scripts/make-license.mjs` — `keygen` + `sign --name --plan --months --seats` | Ed25519, exactly as specified |
| B2 | Keypair actually generated | ❌ **blocker** | `license-private.pem` absent; `src/main/license.ts:33` `LICENCE_PUBLIC_KEY = ''` | `keygen` has never been run. No key can be issued and no build verifies one |
| B3 | Offline verification | ✅ | `shared/license/token.ts`, `src/main/license.ts`, IPC `wivo:license-*` in `src/main/index.ts:71-73` | Signature + expiry checked locally, no network |
| B4 | Install UI | ✅ | `components/Settings/LicenseSection.tsx:78` textarea + "Paigalda" | Paste-a-token flow exists |
| B5 | Expiry / grace | ✅ | `licenceStatus()`, `GRACE_DAYS = 14` | `active → grace → expired`, whole-day UTC comparison |
| B6 | Invalid / expired behaviour | ✅ | `usePermissions.ts:69` — every `.write` permission and `payroll.manage` denied | **Read-only**, not a hard block. Sound choice |
| B7 | **Tier enforcement (Labor vs Labor+)** | ❌ | `grep -rn "labor_plus" src/` → one hit, `LicenseSection.tsx:65`, which only *displays* `PLAN_LABEL` | The plan is printed and never consulted. **Labor and Labor+ are functionally identical** — there is nothing to sell as the upgrade |
| B8 | Fails open by design | ✅ | `useLicense.ts` `UNLICENSED_STUB`, `licensingEnforced()` returns false while the public key is empty | Deliberate and commented; means today's builds are unlicensed |

### C. Initial data import

| Entity | Status | Evidence |
|---|---|---|
| Tööd (jobs) | ✅ | `ImportCSVButton.tsx:251` `from('jobs').insert(batch)`; header aliases incl. Latin-1-mangled variants |
| Patsiendid | ❌ | no importer writes `patients` |
| Kliendid (customers) | ❌ | no importer writes `customers` |
| Hinnad / töötüübid | ❌ | settings only, hand-entered |
| Meeskond | ❌ | created one at a time in `WorkersPage` |
| Tasureeglid | ❌ | `RateEditor` only |
| Töö etapid | ❌ | Seaded → Etapid only |
| Masinad | ❌ | Seaded → Masinad only |

| # | Checkpoint | Status | Note |
|---|---|---|---|
| C1 | Import coverage | 🟡 | **Jobs only.** Both the in-app button and `scripts/import-csv.mjs` target exactly one table |
| C2 | Schema mapping correct | 🟡 | `HEADER_ALIASES` covers the legacy sheet well, but maps only the **18 original** columns — `work_items`, `extras`, `customer_id`, `kondivarv`, `mudel*` are not importable, so imported jobs land in the pre-1.20 shape |
| C3 | Import-timestamp caveat | 🟡 | Imported rows keep `revisions: []` and carry their revision in legacy `rev_hambad`; the readers handle it (`periodMetrics.ts` `legacyChangeTeeth`, `useDashboardStats` `revTeethOf`) but the row never gains a real revision until someone opens and re-saves it |

**Biggest migration friction for a clinic with existing records:** patients and
customers must be retyped. For a practice with a few hundred patients that is
the single largest onboarding cost, and it is the one entity a clinic is most
likely to have in exportable form already.

### D. Clinic configuration — the on-site surface

| # | Checkpoint | Status | Evidence |
|---|---|---|---|
| D1 | Guided setup beyond the clinic row | ❌ | `ClinicSetupWizard.tsx` collects 10 company fields and stops; everything else is blank-slate |
| D2 | Minimum to be operational | 🔧 | Seaded groups: `kliinik · hinnad · valikud · etapid · masinad · kalender · kasutajaliides · profiil · litsents` |

Defaults soften this: `DEFAULT_WORK_TYPES`, `DEFAULT_VISIT_TYPES` and the
pipeline stages ship populated, so the app is *usable* immediately and
misconfigured rather than empty. What genuinely must be filled on-site before
money is correct:

1. **Kliinik** — reg code, VAT number, IBAN. `InvoicePrintView.tsx:39-42`
   actively blocks/banners a print without them.
2. **Hinnad** — `kmMaar` defaults to **0** deliberately (`useSettings.ts:190`
   comment: never guess a VAT rate). Left alone, every invoice is 0% VAT.
3. **Töötüübid + hinnad** — otherwise the wizard's auto-price is silent.
4. **Tasureeglid** — no rules → payroll shows "Tasureegleid ei ole määratud".
5. **Etapid, masinad, kalender** — cosmetic/workflow, safe to defer.

### E. The clinic's own billing (Arved / Kliendid)

| # | Checkpoint | Status | Evidence |
|---|---|---|---|
| E1 | Create arve from works | ✅ | `InvoiceForm.tsx` — candidate lines from unbilled jobs **and** priced revisions, double-billing guard via `billedJobIds` |
| E2 | Numbering | ✅ | `invoice_counters` table, per clinic per year |
| E3 | KM / VAT | ✅ | rate stored **per invoice** (`sql/020`), totals by DB trigger |
| E4 | Osamaksed | ✅ | `payments` table, `outstanding()`/`paidAmount()`, auto-flip to `makstud` at `InvoicesView.tsx:331` |
| E5 | Print / PDF | 🟡 | `InvoicePrintView.tsx:53` `window.print()` — browser print-to-PDF. No generated PDF file, no attachment |
| E6 | Instalments | ✅ | `InvoiceForm.tsx` generates N real documents up front |
| E7 | Kliendid functional + linkable | ✅ | `Customers/CustomersView.tsx` (374 lines), `customers` table with price overrides and billing mode; `jobs.customer_id`, `invoices.bill_to_kind` |
| E8 | Sending an invoice | ❌ | `grep -rni "sendInvoice\|smtp\|resend"` → nothing. Status `saadetud` is set by hand |
| E9 | **Was the dogfood emptiness "not used" or "not finished"?** | **not used** | Zero `TODO`/`FIXME`/stub markers across `components/Invoices` and `components/Customers`; every path is implemented and `Testing.md:3` calls invoicing "the most critical **untested** path" |

**E9 is the important answer for the sale:** the feature is built, not
half-built. It is *unexercised*. The risk is undiscovered bugs on first real
use, not a missing feature — and `Testing.md` already contains the exact
end-to-end script to close that gap.

### F. Wivo getting paid

| # | Checkpoint | Status | Evidence |
|---|---|---|---|
| F1 | Setup fee / subscription in-product | ❌ / 🔧 | `grep -rni "subscription\|setup fee\|stripe\|montonio\|kuutasu"` across `src/ shared/ scripts/` → only unrelated hits (`kuutasu` = a worker's monthly pay rule) |
| F2 | Tier enforcement as leverage | ❌ | see B7 |

**Entirely out-of-band, and that is fine for customer #1.** The company invoices
the clinic from outside Wivo and tracks the subscription outside Wivo. The only
in-product lever is the licence expiry date — which currently cannot be used at
all, because no keypair exists (B2).

### G. Legal / handoff artifacts

| # | Artifact | Status | Evidence |
|---|---|---|---|
| G1 | DPA template | ❌ | `docs/` contains only `finance-metrics.md` |
| G2 | Privacy notice | ❌ | no match for `privacy\|privaatsus` in any `.md` |
| G3 | Licence agreement / terms | ❌ | no match for `terms\|kasutustingimused\|litsentsileping` |
| G4 | Operator runbook | ❌ | `README.md` is stale (A2); `HANDOFF.md` is developer invariants, not provisioning |

Presence/absence only, as instructed. Note the asymmetry: in the **hosted**
model the company is a **processor** of GDPR Art. 9 health data, which is where
a DPA is not optional.

---

## 2. Shortest path to first €

### Blocking — an external clinic cannot onboard or pay without these

1. **Make a fresh database reproducible.** One migration that creates `jobs`
   complete (or `000_base_schema.sql` + the 5 missing `ALTER TABLE`s), so
   `sql/*` alone builds a working schema. Without this, provisioning depends on
   reconstructing columns from `types/job.ts` by hand, and job creation fails on
   day one. *(A2, A3)*
2. **Run `make-license.mjs keygen` once**, back up `license-private.pem`, paste
   the public key into `src/main/license.ts`, ship a build. Everything else in
   the licensing chain already works and is unreachable until this happens.
   *(B2)*
3. **Decide what Labor+ actually gives.** Either gate something on
   `payload.plan` or sell one tier. Today the upgrade is a label. *(B7)*
4. **DPA + privacy notice**, especially for hosted. *(G1, G2)*

### Can be manual for customer #1 — no code needed

- Provisioning by hand from a written runbook (🔧, once step 1 makes the runbook
  finite and correct).
- Invoicing the clinic for setup + subscription from the company's own books
  (🔧 — the owner already owns this process). *(F1)*
- Retyping patients and kliendid on-site as part of consultative setup — costly
  but survivable for one clinic. *(C1)*
- Marking an invoice `saadetud` by hand after printing to PDF and emailing it.
  *(E5, E8)*
- Walking the `Testing.md` invoicing script against the new clinic's real data
  before go-live, to convert E9 from "untested" to "tested".

### Can wait until customer #2+

- Importers for patients / customers / prices / team.
- Automated provisioning script.
- Generated PDF + e-mail sending (already on the v1.4 list).
- Any self-serve subscription billing.

---

## 3. Manual-tool gaps — the sneaky blockers

Things classified 🔧 where the **tool to do it manually does not exist**:

| Gap | Why it is a blocker, not a chore |
|---|---|
| **No issuable licence key** (B2) | The generator exists but has never been run, and `LICENCE_PUBLIC_KEY` is empty. There is no manual workaround: the owner cannot hand a customer a key at all, and shipped builds do not check one. This is the classic "manual and no tool" case the brief warns about. |
| **No correct provisioning SQL** (A2/A3) | Provisioning is legitimately manual — but the operator has no correct script to run. `README.md` produces a schema the current app cannot insert into, and the five missing columns are discoverable only by reading `types/job.ts` and hitting errors one at a time. |
| **No operator runbook** (G4) | Even with correct SQL, the ordered steps live only in this repo's history and in the owner's head. Fine for one clinic; it is the first thing that breaks when someone else does an install. |

One mitigation already shipped and worth knowing about: since v1.32.1,
`describeError()` (`components/Patients/errors.ts`) turns a missing column into
*"Andmebaasis puudub veerg „x". Käivita sql/0NN…"*, naming the exact migration.
That turns a botched provisioning from a silent dead end into a self-directing
checklist — it does not remove gap A2, but it makes hitting it recoverable.

---

## 4. Scope note

No code, migrations, dependencies or commits were changed by this audit. The
only file written is this report.

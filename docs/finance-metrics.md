# Wivo finance metrics — findings, reconciliation, data dictionary

Written for the pre-launch reconciliation of Ülevaade / Statistika→Tootmine /
Statistika→Rahandus. Sections 1–2 are the evidence; section 3 is the dictionary
the UI labels must match, and the one to reuse for the A-veeb export mapping.

---

## 1. Findings — what each surface actually computed (before)

Read off the code, not inferred. `jobPeriodDate(j)` = `valmis_kuupaev ?? valmis_aeg ?? kuupaev`.

| Surface | Metric | Date anchor | Period end | Counting unit | Money source |
|---|---|---|---|---|---|
| **Ülevaade** `OverviewView.tsx` | Tööd | **none — all time** | — | jobs only | — |
| | Hambaid | **none — all time** | — | job teeth + revision teeth | — |
| | Maksmata | none | — | — | Σ(`hind` + Σ`rev.price`) where `!makstud` |
| **Tootmine** `useDashboardStats` | Töid kokku | `jobPeriodDate` | `endOfMonth(now)` | jobs **+** revisions, split shown | — |
| | Hambaid toodetud | `jobPeriodDate` | `endOfMonth(now)` | job teeth + revision teeth, split shown | — |
| | Käive kokku | `jobPeriodDate` | `endOfMonth(now)` | — | Σ(`hind` + Σ`rev.price`) |
| | Makstud | `jobPeriodDate` | `endOfMonth(now)` | — | Σ(`hind` + Σ`rev.price`) where **`makstud` boolean** |
| **Rahandus** `calculateFinance` | Tööd (table footer) | `jobPeriodDate` | **`today`** | **per WORK ITEM** — a 3-item job counts 3 | — |
| | Hambaid (table footer) | `jobPeriodDate`, revisions by **their own** date over **all** jobs | `today` | job teeth + revision teeth | — |
| | Tulu (tööde hinnad) | `jobPeriodDate` | `today` | — | Σ `hind` only — **no revision prices** |
| | Arveldatud | **`invoice.issue_date`** | `today` | — | Σ `invoice.net_total` |
| | Laekunud | **`payment.paid_at`** | `today` | — | Σ `payment.amount` |

### The four root causes

1. **Period end differs.** Tootmine ends at `endOfMonth`, Rahandus at `today`.
   The same "See kuu" button means two different windows for most of the month.
2. **Ülevaade has no period at all.** Its 46 tööd / 390 hambaid are all-time and
   were unlabelled, so they read as a third opinion about "this month".
3. **Counting unit differs.** `calculateFinance` increments `byWorkType.jobs`
   once **per work item** so a multi-type job is counted several times, while
   Tootmine counts jobs and revisions separately. That is the 19 vs 15.
4. **Money concepts differ under similar labels.** Four distinct computations
   were presented as if two:
   - Tootmine **Käive** = accrued job prices *including* revision prices
   - Rahandus **Tulu** = Σ `hind` only, item-distributed
   - Tootmine **Makstud** = accrued price of jobs whose legacy `makstud`
     **boolean** is set — a flag, not a payment
   - Rahandus **Laekunud** = Σ actual `payments.amount` rows in the period

   Makstud (12 800) and Laekunud (21 980) were never the same quantity. One is
   "list price of work flagged paid", the other is "cash that arrived".

---

## 2. Reconciliation

`lib/periodMetrics.test.ts` reproduces each mismatch class on a fixture, so the
diff is runnable rather than a screenshot. The fixture is built to trigger all
four causes at once:

| # | Fixture | Old Tootmine | Old Rahandus | Cause |
|---|---|---|---|---|
| 1 | 1 job, 3 work items | 1 töö | 3 tööd | counting unit |
| 2 | 1 job + 2 revisions | 3 (1·2 split) | 1 | changes as units |
| 3 | job completed after today, same month | counted | not counted | period end |
| 4 | job `hind` 100 + revision `price` 40 | Käive 140 | Tulu 100 | money concept |
| 5 | job `makstud=true`, no payment row | Makstud 140 | Laekunud 0 | flag vs cash |

### After — what the same period now returns

Every row below is one call to `periodMetrics` with the parameters named. The
"same" column is the acceptance criterion: identical value wherever it appears.

| Metric | Ülevaade | Tootmine | Rahandus | Same? |
|---|---|---|---|---|
| Tööd / Töid kokku | `yksused`, range **null** — tile now says **kogu aeg** | `yksused`, range = full period | `unitSplitLabel(m)` under Tulu | ✅ per scope, and scope is printed |
| originaal / muudatus split | `unitSplitLabel` | `unitSplitLabel` | `unitSplitLabel` | ✅ one function |
| Hambaid | `hambad` + `teethSplitLabel` | `hambad` + `teethSplitLabel` | `hambad` + `teethSplitLabel` | ✅ |
| Käive | — | `moneyConcept: 'kaive'` | Tulu tile = `byWorkType` income (per-type math, unchanged) | labelled: Käive ≠ Tulu |
| Laekunud | — | `moneyConcept: 'laekunud'` | `fin.received` — same payment rows | ✅ identical |
| ~~Makstud~~ | — | **renamed to Laekunud** | — | the legacy `makstud` flag is no longer summed anywhere |
| Per-type table unit | — | — | column renamed **Tööosi**, with a note | intentionally ≠ tööd, and says so |

Period window: `rangeFor()` is now the only definition. Tootmine's `endOfMonth`
and Rahandus's `today` are gone; overheads alone clamp to `elapsedEndOf()`.

---

## 3. Data dictionary

Every metric the three surfaces show. `periodMetrics()` in
`lib/periodMetrics.ts` is the only thing that computes these.

### Date anchors (`DateAnchor`)

| Value | Field | Means |
|---|---|---|
| `too` | `jobPeriodDate` = `valmis_kuupaev ?? valmis_aeg ?? kuupaev` | when the work was finished, falling back to when it is due, then to when it arrived. The production anchor. |
| `arve` | `invoice.issue_date` | when the document was raised |
| `laekumine` | `payment.paid_at` | when the money arrived |

A revision is always anchored on **its own** date (`valmis_kuupaev ?? deadline ?? ts`),
never the parent job's — a redo finished in August belongs to August even if the
original shipped in June.

### Counting units

| Metric | Definition |
|---|---|
| `tood` | Job rows in the period. One job = one, regardless of how many work items it carries. |
| `muudatused` | Revisions whose own date falls in the period. |
| `yksused` | `tood + muudatused` when `includeChanges`, else `tood`. What "Töid kokku" shows. |
| `tooosad` | Work items — a 3-crown-plus-bridge job is 4. Only the per-type table uses this, and it says so. |
| `hambadOriginaal` | Teeth on the job rows. |
| `hambadMuudatused` | Teeth on in-period revisions (legacy `rev_hambad` when `revisions` is empty). |
| `hambad` | Sum of the two. Always rendered with the split visible. |

### Money concepts (`MoneyConcept`)

| Value | UI label | Definition | Anchor |
|---|---|---|---|
| `tulu` | Tulu | Σ `job.hind`. What the work is priced at, excluding redo charges. | `too` |
| `kaive` | Käive | Σ (`job.hind` + Σ`revision.price`). Everything the period's work is worth, redo charges included. | `too` |
| `arveldatud` | Arveldatud | Σ `invoice.net_total`, cancelled invoices excluded. What was actually billed, VAT excluded. | `arve` |
| `laekunud` | Laekunud | Σ `payment.amount`. Cash that arrived, whether against an invoice or straight against a job. | `laekumine` |

`tulu` ≤ `kaive` always. `arveldatud` and `laekunud` are **not** derivable from
the first two: work can be finished and never billed (`unbilled`), and billed
and never paid (`outstanding`).

**The legacy `jobs.makstud` boolean is not a money concept.** It predates the
invoice/payment tables and answers only "did somebody tick this". It is no
longer summed into any headline; the payment rows are the record.

### Guardrails encoded here

- `overheadForPeriod` prorates by **elapsed** days, so a full-month window early
  in the month does not charge a whole month's rent against three days of work.
  The counting window and the overhead window are therefore allowed to differ,
  and only for overheads.
- Payroll freeze-on-payout and redo-cost attribution are untouched by this
  layer — it reads their output, it does not re-derive it.

# Run 4: stock (Phase 2)

2 November 2026, on branch `2.1`. Nothing pushed, nothing applied to any database, production not touched.

## What was built

**Database (sql/093, sql/094)**
- `stock_item` and `stock_movement`, with row-level security per organisation. Stock is always the sum of the movements (`stock_levels` view), never a number someone edits. Movements cannot be changed or removed.
- Two new permissions, `stock.read` and `stock.write`. Owners have both. Workers get them in the existing permissions list. All writes go through database functions.
- **A manual add needs a lot number and an expiry date** (and a manufacturer or product name). The database refuses it otherwise.
- **Consignment:** goods owned by a partner organisation (needs an active partnership) or by an outside supplier (a name).
  - Due in three months unless another date is set.
  - Actions: use, return to owner, buy out. Buying out moves the goods to a new item the clinic owns, with the same lot and expiry.
- **Use on a job:** the movement carries the job. The job must belong to the clinic, not be deleted, and be visible to the person. The link stays inside the clinic.
- **Partner view:** `partner_stock()` gives a partner its own consignment goods at a clinic, only when the partnership has `share_stock` on.
  - It shows lot, expiry, consignment due, received, used, returned, bought, corrected and remaining.
  - Totals only: no movement, no date of use, no job, no patient, nothing of the clinic's own goods.
- Text on a partner-owned item (manufacturer, system, size, product, lot) may not contain one of the clinic's patient names or a personal code. The same check and message as sql/092, because the partner reads it.
- **Inventory:**
  - A schedule: how often (1–24 months) and the next due date.
  - Counts with one line per item: expected, counted, and a reason for every difference.
  - A count is saved in one go. The expected numbers are the stock at saving, so a use during counting doesn't show up as a false difference.
  - Each difference becomes a correction movement linked to the count, and the next due date moves on.

**App**
- **Stock in the sidebar**, for people with `stock.read`, in both lab and clinic modes. A red number counts the items that need attention.
- **Goods list:** search, category filter, "show empty and archived".
  - Red rows: consignment due within a month (the spec's rule), or expiring within a month.
  - Amber: fewer left than the item's "warn when fewer than" threshold.
- **Add goods:** a form with lot and expiry marked required; own goods, consignment from a partner, or consignment from a supplier.
- **Item panel:**
  - Actions: use on a job (search by job code or patient), more arrived, return, buy out, correct (with reason), edit, archive (only when empty).
  - History with job codes.
- **Inventory tab:** schedule, count screen, past counts with their differences and reasons.
- **"Our goods at partners" tab:** only shown when `partner_stock()` returns something.
- **Big red bar** when a count is due, on the overview and in Stock. It goes away when a count is saved.
- **Sound:** the existing `notify-stock-warning` plays when a new low-stock, consignment or expiry warning appears.
  - It plays once per warning, remembered per person on that computer, so a restart doesn't sound again.
  - A warning that clears and comes back sounds again.
  - It still follows the notification sound settings.

**Tests**
- `sql/test/stock.test.ts` (18): required fields, quantities from movements, permissions, consignment due date, return and buy-out, use on a job (own job only, never a deleted one, never another organisation's), never below zero, corrections need a reason, history can't be changed, archive, the patient-name check on partner goods.
- `sql/test/inventory.test.ts`: schedule, a difference without a reason refused (and nothing saved), the stock follows the count, history kept, refusals, isolation.
- `sql/test/stockLeak.test.ts`:
  - A partner with `share_stock` on sees exactly its own item with the right totals. With it off, a stranger, or without `stock.read`: nothing.
  - Then every stock function, every table and every view, as each partner and a stranger: no patient name, no job ID or code, nothing of the clinic's own goods or other owners' lots, no movement reasons.
  - A new function that touches stock fails the test until it is added.
  - I planted a job ID in `partner_stock` once; the test went red, so it does catch a leak.
- `lib/stockWarnings.test.ts`, `Stock/InventoryBanner.test.ts`: the warning rules, the "announce once" rule, when the red bar shows.
- `sql/test/harness.ts`: the generic row maker no longer gives a quoted value from a CHECK to a number column.
- Typecheck clean; 1,343 tests pass; `npm run build` works.

**Commits on 2.1:** `2e7f716` (sql/093), `8b160a0` (sql/094), `0f1e4c2` (warnings, hooks, permissions), `4e40f5e` (screens), and this document.

## Migrations added

Apply in order on the test copy, each followed by `notify pgrst, 'reload schema';` as a separate query:

1. `sql/092_partner_no_identity.sql`, if not applied yet. **093 needs it**: it uses `identity_terms` and `identity_hit`.
2. `sql/093_stock.sql`: stock tables, movements, consignment, the stock functions, `partner_stock()`.
3. `sql/094_inventory.sql`: inventory schedule and counts.

4. `sql/095_team_notifications.sql`: notifications inside the clinic (added later the same evening, see below).

The next migration is 096.

## What to test by hand (test copy)

1. **Sidebar:** as an owner, Stock appears. As a worker without stock permissions it doesn't. Grant "View stock" / "Manage stock" in the worker's permissions and it appears.
2. **Required fields:** add goods without a lot, then without an expiry date. Both are refused with a clear message.
3. **Low stock:**
   - Add an implant, quantity 5, "warn when fewer than" 3.
   - Use 3 on a job, finding it by job code. Stock shows 2, the item is amber, the sidebar shows a red 1, and the stock-warning sound plays once.
   - Restart the app: no sound again.
   - Open the item: the history shows "Used · <job code>".
4. **Consignment:**
   - Add goods as consignment from a partner with a due date three weeks away: the row is red.
   - Do the same for a supplier, with the default date: three months ahead, not red.
5. **Expiry:** goods expiring in two weeks are red.
6. **Return and buy out:** return 1 from a consignment item, then buy out 1. A new own item appears with the same lot and expiry, and the consignment quantity drops by 2.
7. **Correction:** "Correct" without a reason is refused. With a reason it works and shows in the history.
8. **Inventory:**
   - Set the schedule with the next count yesterday. The big red bar shows on the overview and in Stock.
   - Start a count and enter a different number without a reason: refused. Add a reason and save: the stock changes, past counts show the difference and reason, the bar disappears, and the next date moves on.
9. **Partner side:** sign in as the partner organisation that owns the consignment goods.
   - With `share_stock` on, Stock → "Our goods at partners" shows the item: received, used, remaining, lot, expiry. No job codes, no patient.
   - With `share_stock` off, the tab is gone.
   - `share_stock` is chosen when accepting a partnership. To flip it on the test copy you need SQL on `partnership.share_stock`; there's no screen for it yet.
10. **Patient name on partner goods:** on a partner-owned item, put one of your patients' surnames in "Product". You get the "remove the patient's name" message.
11. **Sound settings:** turn notification sounds off in Settings; a new warning stays silent.
12. **Layout:** the red bar on the overview at narrow window widths; the item panel next to a long list.

## Open questions

Questions 1–4 and the `share_stock` screen from 13 are decided and built: see "Decisions after Run 4" below.

5. **Expiry warning window:** one month, the same as consignment. Is that right, or should each clinic set it?
6. **Paid module:** the spec makes stock a paid module behind `has_module(org, 'stock')`. Phase 3 (modules) doesn't exist yet, so stock is open to every clinic.
7. **Reserving stock for a treatment package** (`reserve` and `release`, vision step 2) is not built. The movement kinds are limited to `in`, `use`, `return`, `buy`, `adjust` and `writeoff`, so adding them needs a migration.
8. **Using goods doesn't create a `patient_component` record yet.** The spec's Phase 4 treatment record creates one automatically from stock use, and that table doesn't exist.
9. **Partner notifications:** the owning partner isn't told when its goods are used, returned or near their due date. Should it be? (It would get "item X: 2 used", never the job.)
10. **Who records consignment goods:** only the clinic holding them can. The owning partner can't add or correct anything; it only reads totals.
11. **The patient-name check on partner goods** compares against every patient name in the clinic. A product name that happens to equal a patient's surname is refused. It is rare, but the message doesn't say which word matched (on purpose: errors end up in logs).
12. **A partner organisation can't be removed** while its goods are still on a clinic's shelf (`owner_org … on delete restrict`). Return or buy out first.
13. **Not built:** no phone (PWA) stock screen, no Russian texts (English shows).
14. **Blind counts:** the count screen shows the expected number beside the input, as the spec says. Some clinics prefer blind counts (expected hidden until saving). Keep it as it is?

## Added later: notifications inside the clinic (sql/095)

Kevin's case: the clinic's own technician works in a lab across town and heard nothing, because every notification was about a partner.

- **"Job TAL-26-0042 is now in Print"** goes to the job's technician and designers when the job, or a remake on it, moves to a stage.
  - Per stage, Settings → Job stages → *Notifications per stage* chooses whether the technician and the designer are told. The default is both.
  - A remake tells its own technician and designer, else the job's.
- **"You are the technician / designer on job …"** goes out when someone is put on a job, new or changed.
- Never the person who did it, never anyone outside the clinic, nothing for a deleted job, never a partner.
- They reach the bell (handoff and new-work sounds), the phone as a push, and e-mail once Resend is on.
- **Each person chooses their own channels** in their own settings (desktop: Settings → profile; phone: Settings → *My notifications*):
  - push to all their phones: new `profiles.notify_push`, `set_notify_push`, honoured by `pending_pushes`;
  - e-mail: the existing `notify_email` from sql/075.

  The bell always shows everything, and there is no switch for it. The phone's own "Notifications on this phone" switch stays as well; it turns off that one phone.
- A remake's stage changed in the job form counts as a stage change and notifies. Kevin's decision: keep it that way.
- `send-notifications` has subjects for the two new kinds, and needs a redeploy for them. Until then, an e-mail for these kinds would fall back to the "new files" subject. E-mail is off anyway.
- Tests: `sql/test/teamNotifications.test.ts` (13): who is told, per-stage settings, remakes, partners, push and e-mail switches, the bell always on.

**To test by hand (test copy):**
1. Apply 095.
2. Put the technician's account on a job as technician. Their phone gets "You are the technician on job …" within a minute.
3. Move the job to the next stage from another account. The technician's phone gets "Job … is now in <stage>". Moving it from their own account sends nothing.
4. In Settings → Job stages, untick "Technician" for one stage. Moving a job there no longer notifies the technician.
5. As the technician, turn off "Push to my phones" in their own settings. The next notification shows in the bell but the phone stays quiet. Turn it back on and the phone gets the next one.

**Open questions:**
- The switches are all or nothing per channel. A person can't yet choose by kind (for example push for "put on a job" but not for every stage).

## Decisions after Run 4 (3 November 2026)

Kevin decided the open stock questions. 093 and 094 weren't applied anywhere, so they were changed in place; no new migration numbers.

1. **Partner stock rule** stays as built: a partner sees only its own consignment goods, and only when `share_stock` is on. It is now in `wivo-2.0-spec.md`: the locked decisions (Privacy), "Rights and visibility", the Phase 2 line, and its acceptance criterion.
2. **Warning threshold per product, not per lot.**
   - `stock_item.product_key` is computed from category, manufacturer, system, size and product name or REF, ignoring case and outer spaces. So the same product across lots has one key.
   - `stock_threshold` holds one number per product, and the `stock_product_levels` view sums all of a product's lots against it. Set it with `set_stock_threshold` from any lot of the product, or when adding goods.
   - In the app: "Running low" above the list names every product below its threshold, including one whose lots are all used up.
   - A lot at zero never warns and leaves the list. "Show empty and archived" brings it back.
3. **Implants, abutments, bone material and membranes go out only on a job.**
   - "Membrane" is a new category.
   - Anything else can still be used without a job.
   - Any item can leave without a job as a **write-off**, with a required reason (damaged, expired, packaging opened, returned) and an optional note.
4. **Expired goods** (past the expiry date; usable on the day itself) are refused on a job with SQLSTATE `WV002`.
   - The clinic's **owner** can override with a reason. The movement is marked `expired_override` and the audit log gets a `stock_override` row with lot, expiry, quantity, job and reason.
   - In the app, the owner sees a reason field and the history says "used after expiry". Everyone else sees why the item can't be used.
   - Write-off and return of expired goods work as usual.
5. **`share_stock` switch:** Settings → Partnerships → "Share stock with this partner", on an accepted (active or paused) partnership.
   - Only an owner of either organisation, signed in with the second factor (as every partnership step).
   - Logged in both organisations' audit logs.
6. **Test mode:** `npm run dev:test` runs the desktop app against the test copy.
   - `.env.test` (git-ignored, created empty) takes only the test copy's URL and anon key. `.env.test.example` is the template.
   - The app shows an amber TEST COPY frame and label at all times.
   - It fails closed: if `.env.test` is empty, or its URL is production's (which is what a deleted line falls back to, from `.env`), the app connects to nothing and the label turns red with the reason.
   - Sentry is off in test mode. `npm test` now runs Vitest in mode `unit`, so unit tests never read `.env.test`.

**Tests:** `stock.test.ts` has new cases for every rule above:
- the per-product total and threshold, a used-up product still low;
- the job required per category, the write-off reasons;
- expired refused, the owner override with its audit row, a worker refused, write-off and return of expired goods;
- `share_stock`: either owner with MFA, both audit logs; refused for a worker, without MFA, for a stranger, and before acceptance.

`stockLeak.test.ts` covers `writeoff_stock`, `set_stock_threshold`, the `stock_threshold` table and the `stock_product_levels` view, and checks `written_off` in the partner's totals. `stockWarnings.test.ts` and `testCopy.test.ts` cover the app logic.

`partnerNoIdentity.test.ts` had a chance failure: a planted price matched digits inside a random UUID. The planted prices are now decimals, which a UUID can't contain.

Typecheck is clean, `npm test` passes all 1,372, and `npm run build` works.

**To test by hand (test copy, with `npm run dev:test`):**
1. **Test mode:**
   - With `.env.test` still empty: the frame and label are red with "no URL or anon key", and nothing loads.
   - Paste in the test copy's URL and anon key: amber "TEST COPY", and you can sign in.
2. **Per-product warning:** add two lots of the same implant, with 2 and 1 in stock and a threshold of 4. "Running low" shows it once, with 3 left. Use both lots up on jobs. The lots leave the list; the product stays under "Running low" with 0.
3. **Job rule:** "Use on a job" for an implant without choosing a job is refused with the message. A healing cap ("Other") can be used without a job. "Write off" requires a reason.
4. **Expired goods:**
   - Add a lot that expired yesterday.
   - As a worker with "Manage stock": no "Use on a job", and the message says why. Write-off works.
   - As the owner: "Use on a job" asks for a reason. After saving, the history says "used after expiry" and Settings → Audit log has the entry.
5. **share_stock:** as the owner, Settings → Partnerships → tick "Share stock with this partner". The partner's "Our goods at partners" appears; untick and it goes. Both audit logs have the change. A worker doesn't see the switch.

**Still open:**
- **Product key spelling:** "Nobel Active" and "NobelActive" are two products. Case and outer spaces are ignored, inner spelling isn't. A product catalogue would fix it; it would also serve the marketplace.
- **Override rights:** only the role `owner` can override expiry, not an org admin. Should admins be allowed too?
- **Hard-coded production project ID:** the test-mode guard has it in the source. It isn't a secret (the phone app's bundle carries it), but a new production project would need the guard updated.

# Guided tour and written guide

Status: **plan.** The administrator's steps are in docs/guide/admin.md, for Kevin to check with the secretary. Nothing is built until that is OK'd (Kevin, 2026-11-05).

**What it is:** an in-app tour that shows new staff around, one short step at a time, pointing at the real button. The same words also make a printable guide per role.

**Order:**
1. The administrator: reception, meaning patients, booking requests, calendar and visits, clients, invoices and payments.
2. The technician: jobs, stages, files, stock.
3. The owner: team and permissions, settings, statistics, the audit log, updates.

---

## 1. What a person sees

- **A step** is one action:
  - a title of a few words;
  - one or two plain sentences;
  - a highlight on the element on screen it is about.

  Back, Next, **Pause** and **Skip tour** are on every step.
- **Only what they may do.** Each step names what it needs, and the tour asks the same questions the menu does (`decidePermission`, `menuAllows` in shared/permissions.ts):
  - **the permission:** for example, "book a visit" needs Manage visits;
  - **the product:** Patients only in WivoDental and WivoX, Clients and Jobs only in WivoLab and WivoX (the sidebar's rule).

  A person who can't open Invoices never sees the invoice steps.
- **Chapters,** one per page:
  - "Start here", then each page the person can open, in the order of the written guide;
  - each chapter can be skipped on its own;
  - the roles are only how the chapters are grouped into the written guides. An owner who can open everything gets every chapter.
- **When it starts:**
  - by itself after someone's first sign-in, once the two-factor setup is done. A new account gets the tour instead of "What's new".
  - **Pause** remembers the step. **Help → Continue the tour** goes on from there.
  - **Skip tour** ends it. **Help → Take the tour** starts it again.
  - **A "?" on each page** runs just that page's chapter.
  - Where "seen" and "paused at" are kept: the person's account settings (user metadata), as "What's new" does, so the desktop remembers it across computers. No migration.
- **Help:** a new item in the sidebar footer, next to "What's new":
  - Take the tour;
  - Continue the tour (only while paused);
  - The written guide, shown in the app and printable.
- **Never real data:**
  - The tour switches pages itself, as a click on the menu would. It **never presses a button, opens a form or saves anything.**
  - A step about a form points at the button that opens it and says in words what the form asks for.
  - Where a step would need an example (a patient, an invoice), it explains instead of making one.
  - It points at the page's own controls (buttons, tabs, the search box), never at a row of real data.

## 2. How it is built

- **The steps,** in code: `shared/guide/steps.ts`. Each step has:
  - its id;
  - its chapter;
  - its page;
  - the element it points at (or none: a card in the middle);
  - what it needs (a permission or a menu place, and clinic or lab);
  - `since`: the first version that has it.
- **The words,** in **one file per language** that Kevin edits: `shared/guide/en.md`, `et.md`, `ru.md`.
  - English is the source. A step missing from Estonian or Russian shows English, as the rest of the app does.
  - The format:

    ```markdown
    # calendar: Calendar and visits

    ## calendar.new-visit: Book a visit
    Click {topBar.newVisit} at the top. A form opens: the patient, the time and the length.
    Nothing is saved until you click {calendarView.createVisit}.
    ```

  - **Change the words freely.** Keep the id before the colon: the app finds the step by it.
  - `{topBar.newVisit}` is the button's own name, taken from the app's texts. So if a button is renamed, the tour and the guide follow, and never name a button that no longer exists.
- **Pointing:**
  - each element a step points at gets a marker, `data-tour="calendar.new-visit"`;
  - the overlay dims the window except that element, scrolls it into view, and places the step beside it;
  - built in Wivo (about 300 lines), not a library: Wivo's look and texts, nothing new in what each release ships, and the keyboard works (Esc pauses, the arrows step).
- **Tests that fail rather than let it break silently:**
  1. Every step's element exists: its `data-tour` marker appears in the app's code exactly once. **A screen change that removes or renames the element fails the tests.**
  2. Every id in the text files is a step, every step has English text, and every `{label}` is a real app text.
  3. Each page's chapter renders with a person who has every permission, with a person who has none, and in a clinic and in a lab, and shows exactly the steps it should.
  4. The written guides in docs/guide/ match the text files: a test fails if a guide is out of date, as the schema check does. `npm run guide` regenerates them.
- **The written guide:**
  - `docs/guide/admin.md`, `technician.md` and `owner.md` in English, and `.et.md` and `.ru.md` beside each, generated from the same text files;
  - each section says what it needs ("Needs: Manage visits");
  - each step newer than the production version is marked **"New in 2.1, not in 2.0.4 yet"**, from `since`.
  - Printing: the in-app "Written guide" has a Print button; the Markdown files can also be sent as they are.

## 3. Decisions for Kevin

1. **Existing staff.** The tour starts by itself after a first sign-in, but everyone today signed in long ago.
   - **(a) Recommended:** accounts made after this release get the tour by itself. Existing accounts get a one-time note, "New: a guided tour. Start / Later", and Help.
   - **(b)** Everyone gets it by itself once.
2. **Russian.** Today the app offers only Eesti and English (Settings → Interface). Most of the app has no Russian yet; only e-mails and pushes do. So:
   - **(a) Recommended:** write the Russian tour and guide now. The printed Russian guide is usable at once; the tour shows Russian once Russian is offered in Settings, which is a translation job of its own;
   - **(b)** Offer Русский in Settings now, with the rest of the app in English until it is translated.
3. **The phone:** desktop only for now (recommended). The phone app has its own screens; reception works on the desktop.
4. **Updates** in the owner's chapter wait for Settings → Updates (phase 1, slice 4).

## 4. Order of work after the OK

1. **The engine and the administrator:** the overlay, Help, "?", pause and resume, the text files, the markers, the four tests, the guide generator, then "Start here" and the administrator's chapters in English. Then Estonian and Russian (Claude translates, Kevin edits). About 3–4 days. Kevin's part: a first sign-in with a new account on the test copy, and one run as the secretary would; about one session.
2. **The technician:** steps first in docs/guide/technician.md for the same check, then built. About 1–2 days.
3. **The owner:** the same. About 1–2 days, with Updates added when it exists.

## 5. Found while mapping the screens for the guide

The guide describes what the app does today; these are worth fixing, each separately, after Kevin decides. "Both" means 2.0.4 and `testing`.

**Money:**
1. **The Paid status records no money.** Clicking **Paid** without **Add payment** leaves the invoice counted as unpaid (column, boxes, Unpaid filter). The guide says to always use Add payment. Both.
2. **Automatic e-mail sends drafts.** With automatic sending on, every invoice dated today or earlier that isn't cancelled and isn't paid goes out within the hour, **Draft** or not. "Create invoice" gives no warning. Both.
3. **Job payments and invoice payments don't settle each other:** "Mark as paid" on a job doesn't lower its invoice's Unpaid, and the reverse. Both.
4. **A client invoice never lists the client's unbilled jobs:** "Unbilled work" always says "Select a patient…" in Client mode, so lines are typed by hand. Both.
5. **An invoice can't be edited after it is created**, only deleted or cancelled. Both.
6. **The payment bin and the request bin delete at once,** with no confirmation; a failed request delete shows nothing. Both.
7. **On a patient's page, the Invoiced and Unpaid numbers** in the strip under the name still show without **View payments**, though the Invoices card and the money columns hide. `testing`.
8. **Client delete on `testing`:** a member with View and Edit jobs but no View payments sees 0 invoices, so may be offered Delete for a client that has invoices (the database still refuses).

**Patients and visits:**

9. **New patient saves a record at once,** named "New patient". Cancel leaves it behind. Better: save on the first Save. Both.
10. **A patient's page has no visits.** The visits panel exists in the code but is never shown. Both.
11. **In WivoDental the calendar opens in Combined,** with no mode button lit; Week appears only after clicking Visits. Both.
12. **The calendar's Patient filter lists names from jobs,** not visits. Both.

**Requests:**

13. **Book from a request writes an Estonian note** ("Veebitaotlus · …") whatever the language. Both.
14. **If confirming the request fails** after the visit is made, nothing is shown. Both.
15. **The database lets an organisation admin read requests** (sql/116), but the menu needs Manage visits.

**Permissions and wording:**

16. **No screen hides a button for want of Edit patients or Manage visits.** The database refuses, with the plain message on `testing`.
17. **Still in Estonian whatever the language:**
    - the printed invoice;
    - CSV headers;
    - the "missing clinic details" names;
    - the default visit types.
18. **A client's Billing and Payment terms** are stored but used nowhere. Invoices take the clinic's own terms. Both.


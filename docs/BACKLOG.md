# Backlog

Work Kevin has agreed to, not yet scheduled, and the steps saved for the live release. Each item says who decided it and when. The larger plans have their own files (docs/STOCK.md, docs/AGREEMENTS.md, docs/TOUR.md §5).

## Before the live release

1. **Deploy `send-invoices` to production, then run its dry run** (Kevin, 2026-11-09).
   - The fix is on `main` (4c8b170): a draft is never e-mailed, nor an invoice marked Paid; an invoice goes out once marked Sent, and a payment plan's instalments on their dates.
   - **Until the deploy, automatic sending stays off in production.**
   - The steps:
     1. on the test copy: the deploy, two test invoices (one draft, one marked Sent) and the dry run;
     2. then production: the same deploy, in a session Kevin starts for it.

## Agreed, not scheduled

1. **Show on each invoice when it was e-mailed, and when sending failed** (Kevin, 2026-11-09).
   - `send-invoices` already records both on the invoice (`sent_at`, `send_error`). Neither is shown today: the list shows only the status.
   - **On the invoice:** "E-mailed 9 Nov 14:07 to …", or "Sending failed 9 Nov 14:07: …" with the reason in plain words, and that the next hourly run tries again.
   - **In the list:** a mark on e-mailed invoices and on failed ones, and a filter for failed ones.
   - No database change. About half a day, desktop and phone.

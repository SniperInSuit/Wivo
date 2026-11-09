# Patient portal

Status: **plan, for Kevin's OK** (C3, 2026-11-09). **A later release,** with a security review before it goes live (§9). Nothing is built.

**Kevin's decision (2026-11-05, docs/VISION.md): patient-held connections.** A central Wivo patient account was rejected, because Wivo would then know who is a patient where. This plan works out that decision.

**What it is:**
- **a second kind of login, for patients,** next to the clinic's own accounts;
- **a patient sees their own card and treatment history,** including work done for them by a partner clinic (§7);
- **confirms a treatment plan together with the doctor;** confirming with their login counts as a signature (Kevin);
- **prepays through a payment link** from the clinic's own payment provider, so Wivo never touches money;
- **each clinic keeps its own database, and Wivo holds nothing** about patients.

## 0. Today

- **A patient record has no personal ID code** (sql/001). Matching an eID sign-in needs one (§2).
- **Patients have no logins.** The only patient-facing surface is online booking (`public-booking`).
- **The database refuses every request without the second factor** (sql/098): a restrictive policy on every table, and a check before every function. A patient signed in with Smart-ID or an e-mail link has no second factor in Supabase's terms, so patients must not reach the tables at all (§3).
- **Payments are recorded by hand** (or by the clinic's bank import).
- **Treatment plans don't exist yet:** the treatment calculator is step 1 of docs/VISION.md.
- **A partner sees no patient identity** (sql/092), and that stays (§7).

## 1. Several clinics, each with its own database, and Wivo holding nothing

**The patient app:**
- **One web app** at its own address (for example `minu.wivodent.com`, decision 7), installable on the phone. It is separate from the clinic's app: different address, no staff code.
- **It is plain files** served as they are. **There is no patient server.** The app talks to each clinic's project directly.
- **The list of connected clinics lives on the device:** for each, the clinic's name and its connection address (the project's address and public key, which are public by design).
- **Each clinic is a separate connection,** with its own sign-in and session.
- **The app combines the clinics on the device only:** one timeline of visits, treatments and invoices, each marked with its clinic.

**Finding a clinic:**
- **A public directory of Wivo clinics** that choose to be listed: name, town and connection address only.
- **The app downloads the whole directory,** never asks about one clinic, so nobody learns which clinic a patient looks for.
- **The directory is signed** with Wivo's release key (docs/ARCHITECTURE-INSTANCES.md §5e), so a fake entry can't send patients to someone posing as a clinic.

**Connecting to a clinic,** either way:
1. **The clinic's invite:** a QR code or link from the patient's page in the clinic's app. It carries the clinic's connection address and a one-time code for that patient record, valid for 7 days.
2. **eID, without an invite:** the patient picks the clinic in the directory and signs in with Smart-ID, Mobile-ID (Estonia only) or eParaksts (Latvia). The clinic's project matches the personal code (§2).

**The backup:**
- **The list of clinics, and nothing else,** can be saved to the patient's own cloud (a file in iCloud Drive or Google Drive, or the phone's own backup).
- Restoring brings the list back; the patient then signs in to each clinic again. **No session is ever in the backup.**

**What Wivo sees:**
- that someone downloaded the app's files and the directory;
- nothing about which clinics a person is connected to;
- no analytics or outside scripts in the patient app.

## 2. Signing in

**With eID, through the clinic's own eID provider:**
- **Each clinic has its own account with an eID provider** that offers OpenID Connect, the standard sign-in protocol. The provider is set up as a sign-in method in the clinic's own project: Supabase Auth has supported custom OpenID Connect providers since April 2026.
- **Wivo builds to the standard,** so a clinic's choice of provider needs no code. It is tested with two (decision 1).
- **Each provider shows the patient which clinic they are signing in to,** under the name the clinic registered.

| Provider | Methods | Price (checked 9 Nov 2026, without VAT) |
|---|---|---|
| **eeID** (Estonian Internet Foundation) | Estonia: ID card, Mobile-ID, Smart-ID. Latvia: Smart-ID and eParaksts, through eIDAS. Passkeys after a first eID sign-in. | Prepaid, no monthly fee: €0.08 per eID sign-in, €0.01 per passkey sign-in |
| **SK Authentigate** (SK ID Solutions, the maker of Smart-ID) | Estonia: Smart-ID, Mobile-ID, ID card. Latvia: Smart-ID, eParaksts. | From €29 a month for 100 sign-ins (then €0.29 each); €49 for 500 (then €0.098) |
| **Signicat** | Smart-ID, Mobile-ID, Estonian ID card, eParaksts Mobile | On request |
| Smart-ID directly from SK | Smart-ID only, and not the standard protocol | At least €60 a month (550 sign-ins) |

**Mobile-ID is Estonian and Lithuanian only;** in Latvia it is Smart-ID or eParaksts.

**The match, exact only:**
- **the personal code** from the eID (for eeID it is the sign-in's subject, for example `EE38001085718`; SK's providers send it as `personal_code`) must equal the code on **exactly one** patient record of that clinic;
- **and the name** from the eID must match that record's name, ignoring case and accents;
- otherwise nothing connects, and the patient sees "Not connected: ask your clinic". **No near matches, ever.**
- **Staff enter the personal code with its check:** Estonian and Latvian codes are validated (format and check digit) when typed, since a wrong code on a record is the one way a stranger's eID could match it.
- **Changing a record's personal code ends its patient logins.**

**Without an Estonian or Latvian eID:**
- **an e-mail link, only after the clinic's invite** (decision 2), and only to the e-mail address on the patient's record. Nobody can claim a record by typing an e-mail address;
- **then a passkey on the device,** so later sign-ins need no e-mail. Supabase's passkeys are in beta (since May 2026), and eeID also offers passkeys after an eID sign-in. Until passkeys are stable, the e-mail link each time.

**Patients are kept apart from staff:**
- a patient login is never a member of the clinic and never gets a staff profile;
- the database's second-factor wall (sql/098) refuses its direct requests, so it reads nothing except through the patient gateway (§3).

## 3. The patient gateway

**A function in each clinic's project,** through which every patient request goes:
- it checks the patient's session, and that the session still exists;
- it finds the one patient record linked to that login;
- it returns **only that patient's records, in fixed shapes** (§4): a list of allowed fields, never whole rows;
- **it writes every sign-in and every read to the clinic's audit log** (docs/VISION.md);
- it limits how often it can be called;
- the app's version header is checked as for the clinic's app (docs/MIN-VERSION.md).

**What a patient can change through it:**
- confirm a treatment plan (§5);
- start a payment (§6);
- ask for a correction to their contact details, which the clinic accepts or not;
- disconnect.

**Why a gateway:** the database's wall stays exactly as it is for staff, and everything a patient can reach is in one place, which is the place the security review reads.

## 4. What a patient may see, and may not

| May see | May not see |
|---|---|
| Their details: name, birth date, contacts | Internal notes (`markmed`), staff notes on jobs, chat |
| Visits, upcoming and past: date, time, doctor | Other patients, and anything about staff beyond the doctor's name |
| Treatment history: the work done, the teeth, dates, material and shade | Costs, lab prices, partner prices, pay |
| The tooth chart | The job's internal stages and who moved them |
| Treatment plans offered, and the one confirmed, with its PDF | The audit log |
| Invoices, payments, payment plans and what is owed | Files the clinic hasn't marked for the patient |
| Files the clinic marks "show to patient" (decision 4) | Partner clinics' data of any kind beyond the work done for them |
| What is recorded about them: marketing consent, "told the consultation was recorded" | |
| **The medical card** (decision 3): allergies and the treatment notes | |

**The medical card is their health data,** and they have a right of access to it. Recommended: shown, except the free-form internal notes, which the patient can still get through an ordinary access request to the clinic. This waits for the lawyer (§10).

## 5. Confirming a treatment plan with the doctor

**It needs the treatment calculator** (docs/VISION.md, step 1), so it comes after it.

1. **The doctor builds the plan** and presents it.
2. **The doctor signs** with a fresh authenticator code (L5).
3. **The patient confirms in the portal** with a fresh sign-in at that moment: eID again, a passkey, or an e-mail link. Kevin's decision: that counts as a signature.
4. **Both are recorded:** the frozen plan, its hash, who, when (the database's clock) and how. The machinery is the agreements' (docs/AGREEMENTS.md §2), built once.
5. **Both get the PDF.**

**Each eID confirmation is a paid sign-in** at the clinic's provider (about €0.08–0.29).

**Whether an e-mail link or a passkey is enough** for a patient's signature, or only eID, is a question for the lawyer (§10).

## 6. Prepaying through the clinic's own payment provider

**The clinic connects its own account** with a payment provider. Its key is the clinic's secret, kept in its own project's functions, never in Wivo.

**Providers that make payment links by API and say when they are paid** (checked 9 Nov 2026):

| Provider | Baltic bank payments | Fees, roughly |
|---|---|---|
| **Montonio** | Estonia, Latvia, Lithuania | €11.99–39.99 a month, plus €10 for payment links; bank payment €0.05–0.20 |
| **MakeCommerce** | Estonia, Latvia | Estonia: €10 a month, bank 0.9% + €0.05; Latvia: bank 1.5% + €0.15 |
| **Paysera** | Estonia, Latvia, Lithuania | No Paysera fee on Baltic bank payments since August 2026 |
| Stripe | none for Baltic banks | cards 1.5% + €0.25 |

**The flow:**
1. The patient presses **Pay** on an invoice or the booking fee.
2. The gateway asks the clinic's provider for a link **for the amount in the clinic's database,** never an amount from the device.
3. The patient pays on the provider's page. **The money goes to the clinic's account.**
4. The provider tells the clinic's project. The notification's signature is checked, and the payment is recorded on the invoice **once,** whatever the number of notifications.
5. The audit log records it.

**Wivo never holds or forwards money** (docs/VISION.md, "Money"). Recommended first: Montonio and MakeCommerce (decision 5).

## 7. A lost phone, a change of clinic, the cost, and partner work

**A lost phone:**
- the sessions are on the device, behind the phone's lock and the app's own lock (a passkey or the phone's face or fingerprint to open it);
- **on a new phone:** sign in again, with eID (Smart-ID has its own recovery) or the e-mail link, and restore the list from the backup, or find the clinics in the directory;
- **then, in each clinic, "Sign out other devices"** ends the old phone's sessions at once;
- **the clinic can also end all of a patient's sessions** from the patient's page, when the patient calls.

**Changing clinics:**
- connect to the new clinic separately;
- the old connection stays, as read-only history, until the patient disconnects. Disconnecting removes it from the device and ends the login at that clinic. The clinic keeps the records as the law requires;
- **taking records along:** the patient downloads their own records as a file from the old clinic. The download is in that clinic's audit log.

**The cost of eID sign-ins, per clinic:**
- each clinic pays its own provider (§2). Wivo pays nothing and sees nothing;
- **for example, 300 patient sign-ins a month:** about €24 with eeID, or €49 with Authentigate's 500-sign-in plan;
- e-mail links go through the clinic's own e-mail sending.

**Work done by a partner clinic shows up:**
- **through the patient's own clinic:** the work a partner did on a shared job appears under the patient's clinic, as part of that clinic's job ("made by our partner lab in Riga");
- **or directly,** if the patient is also that partner clinic's own patient and connects to it: then it shows its own work for them;
- **the partner's side of a shared job is never linked to the patient** (sql/092), so nothing crosses between clinics and nothing appears twice.

## 8. Children and guardians

**Not in the first version** (decision 6): a patient under 18, by the personal code or birth date, can't connect. A guardian's access, and the age from which a minor sees their own records, wait for the lawyer (§10).

## 9. The security review before it goes live

**Claude's review, then an independent consultant** (as in docs/ARCHITECTURE-INSTANCES.md §5f), on a test project with made-up patients. It must cover:
1. **The match:** exact code and name only; the check digit on entry; one login per record; a changed code ending logins; a stranger's eID never reaching a record.
2. **Sign-in:** the providers' flows (state, nonce, PKCE, the issuer and the return addresses); the e-mail link (single use, expiry, only to the address on record); passkeys (the app's address); session lifetimes.
3. **Separation from staff:** a patient login never gets a profile or membership; the sign-up trigger can't make them staff; the wall refuses their direct requests.
4. **The gateway:** every answer scoped to the linked patient; only the allowed fields, with no internal notes, prices or pay through a join; limits on calls; errors that reveal nothing; every read logged.
5. **The patient app:** who can publish it; a strict content security policy; no outside scripts; how sessions are stored on the device; the app lock.
6. **The directory:** its signature, and that downloading it reveals nothing.
7. **Payments:** the notification's signature, once only, the amount from the database, no card data anywhere near Wivo.
8. **Signatures:** the patient's sign-in is fresh, and bound to the plan's hash.
9. **A lost device:** signing out ends a session at once, through the gateway too.
10. **The log:** every sign-in and read recorded, and kept as long as the staff's (L3).
11. **Children:** a minor can't connect.

## 10. Questions for the lawyer

1. **A patient's signature:** is a fresh e-mail link or passkey enough to confirm a treatment plan, or only eID?
2. **The medical card:** must the portal show the whole record, or may it show a defined part, with the rest through an access request?
3. **Children:** from what age does a minor see their own records, and how does a guardian get access?
4. **Logging every read** a patient makes: are 3 years right, as for staff (L3)?
5. **Recording the personal code** on each patient record, for matching sign-ins.

## 11. How it is built

**New tables,** each with `org_id`, access rules, the second-factor policy and a leak test:
- `patient_login`: the patient record, the login, how it signs in, and when it was connected and ended;
- `patient_invite`: the one-time code for a QR or link, its expiry and its use;
- `patient_file_share`: which files the clinic shows the patient;
- `payment_provider` and `payment_link`: the clinic's provider (its key in the functions' secrets, never in a table), and each link made, with its state.

**Changed:**
- **`patients`:** the personal code, validated, and unique within the clinic;
- **the sign-up trigger:** a patient login never becomes a member;
- **the audit log:** patient sign-ins and reads, as their own kinds.

**New functions:**
- **`patient-gateway`** (§3);
- **`payment-notify`,** for the provider's notifications;
- the patient app, and the signed directory.

## 12. Decisions for Kevin

1. **eID providers to build and test with:** eeID for Estonian clinics, and SK Authentigate for Latvian ones (recommended). Any provider with the standard protocol works without code.
2. **E-mail sign-in:** only after the clinic's invite, to the address on record (recommended).
3. **The medical card in the portal:** shown, except the free-form internal notes (recommended), once the lawyer answers.
4. **Files:** only those the clinic marks for the patient (recommended).
5. **Payment providers first:** Montonio and MakeCommerce (recommended).
6. **Children:** not in the first version (recommended).
7. **The patient app's address:** separate from the clinic's app (recommended), with Latvian added for Riga's patients.
8. **When:** after the treatment calculator (docs/VISION.md, step 1), which plan confirmation needs. The part without plans could come earlier, if wanted.

## 13. Order of work and time

| Slice | Built in | Kevin's part |
|---|---|---|
| 1. **The patient in the clinic:**<ul><li>the personal code with its check;</li><li>the invite QR and link;</li><li>patient logins kept apart from staff;</li><li>the gateway, with the log.</li></ul> | 4–5 days | Add codes to test patients; invite one. One session. |
| 2. **The patient app:**<ul><li>connections on the device, the signed directory, the timeline;</li><li>the backup;</li><li>the app lock.</li></ul> | 5–6 days | Two test clinics on one phone. One session. |
| 3. **Signing in:**<ul><li>eID through eeID and Authentigate;</li><li>the e-mail link, and passkeys.</li></ul> | 4–5 days | Sign in with your own Smart-ID to a test clinic; a test patient by e-mail. Two sessions. |
| 4. **What the patient sees** (§4), in English, Estonian, Russian and Latvian. | 5–6 days | A test patient's whole history, checked field by field against the clinic's app. Two sessions. |
| 5. **Payment links,** with two providers. | 3–4 days | A test payment of €1 through each, recorded once. One session. |
| 6. **Confirming a plan,** after the calculator. | 2–3 days | Confirm a test plan as doctor and patient. One session. |
| 7. **A lost phone, disconnecting, taking records along.** | 2–3 days | Sign out the old phone; disconnect; download the records. One session. |
| 8. **The security review** and its fixes, then the consultant. | 4–5 days, plus the consultant's 2–3 | Read the findings. One session. |

- **Building:** about 29–37 days, plus the consultant. **Kevin:** about 10 sessions.
- **Calendar:** about 7–9 weeks at 3–4 hours of testing a day, when its turn comes.

## Sources (checked 9 Nov 2026)

- eeID: https://eeid.ee/about · https://internetee.github.io/eeID-DOC · prices: https://www.internet.ee/eif/news-archive/eeid-introduces-new-pricing-and-updates-to-strengthen-digital-identity-verification
- SK ID Solutions price list (Smart-ID, Mobile-ID, Authentigate): https://www.skidsolutions.eu/price-list/ · Authentigate: https://www.skidsolutions.eu/services/authentigate/ · its claims: https://sk-eid.github.io/authentigate-documentation/api/overview.html
- Signicat eID Hub: https://developer.signicat.com/docs/eid-hub/oidc/
- Supabase custom OIDC providers: https://supabase.com/docs/guides/auth/custom-oauth-providers · passkeys (beta): https://supabase.com/docs/guides/auth/passkeys · e-mail links: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Montonio payment links: https://docs.montonio.com/api/stargate/guides/payment-links · https://montonio.com/pricing/
- MakeCommerce: https://developer.makecommerce.net/guides/custom-api/paymentLinks/ · https://makecommerce.net/pricing
- Paysera: https://developers.paysera.com/guides/checkout-modern/reference/api-reference · https://www.paysera.lt/v2/en-LT/blog/paysera-removes-payment-initiation-fee-for-merchants-in-the-baltics
- Stripe Pay by Bank coverage: https://docs.stripe.com/payments/pay-by-bank

**Not confirmed yet, to check in slice 3:** whether Supabase keeps a provider's extra claims (such as `personal_code`) with the login. eeID's personal code is the sign-in's subject, which Supabase always keeps.

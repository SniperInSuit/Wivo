/**
 * May this invoice be emailed, right now, to this address?
 *
 * ONE function, and the sender is not allowed to have an opinion of its own.
 * The mailbox this sends from is the clinic's MAIN address — the same one
 * patients and suppliers write to — so a runaway loop does not just annoy
 * people, it gets that address rate-limited or blacklisted by the host and
 * takes the clinic's ordinary mail down with it.
 *
 * Every answer is therefore a refusal by default. The switch is off, nothing is
 * allowed, the cap is whatever was configured, and each check below has to be
 * passed explicitly. Adding a new kind of mail later means adding a new flag,
 * not widening this one.
 *
 * WHAT THIS CANNOT DO, AND THAT IS THE POINT
 * SMTP is send-only. Nothing here — and nothing anywhere in Wivo — is ever
 * given IMAP settings, so the system physically cannot read, move or delete
 * anything in that mailbox. Handing over the main account grants exactly one
 * capability: putting a message into the outbox.
 *
 * NO DEPENDENCIES — `shared/README.md`. This runs in the renderer (to explain
 * why an invoice will not go) and in the edge function (to decide).
 */

export type SendBlockCode =
  | 'valjas'          // master switch off
  | 'liik-keelatud'   // this kind of mail is not permitted
  | 'juba-saadetud'   // sent_at is set
  | 'tuhistatud'      // cancelled invoice
  | 'tasutud'         // nothing outstanding
  | 'tulevik'         // issue date has not arrived
  | 'aadress-puudub'
  | 'aadress-vigane'
  | 'paevalimiit'     // daily cap reached
  | 'saatja-puudub'   // no from-address configured

export const SEND_BLOCK_LABEL: Record<SendBlockCode, string> = {
  'valjas':          'Automaatne saatmine on välja lülitatud',
  'liik-keelatud':   'Arvete saatmine ei ole lubatud',
  'juba-saadetud':   'See arve on juba välja saadetud',
  'tuhistatud':      'Arve on tühistatud',
  'tasutud':         'Arvel ei ole tasumata summat',
  'tulevik':         'Arve väljastuskuupäev ei ole veel käes',
  'aadress-puudub':  'Saajal ei ole e-posti aadressi',
  'aadress-vigane':  'Saaja e-posti aadress ei ole korrektne',
  'paevalimiit':     'Päeva saatmislimiit on täis',
  'saatja-puudub':   'Saatja aadress on seadistamata',
}

/** What the clinic has allowed. Every field defaults to the safe answer. */
export interface MailPolicy {
  /** Master switch. Off = nothing is ever sent, whatever else is set. */
  saatmineLubatud: boolean
  /** Permission for THIS kind of mail. Invoices are the only kind so far. */
  lubaArved: boolean
  /** Hard ceiling on messages per day. 0 = nothing goes out. */
  paevaLimiit: number
  /**
   * Everything is redirected here instead of the real recipient. Null = live.
   *
   * The point is that the first week can be watched without a single patient
   * being written to: same code path, same rendering, same cap — one address.
   */
  testAadress: string | null
  /** The From address. Empty = not configured, and nothing is sent. */
  saatjaAadress: string
}

export const SAFE_MAIL_POLICY: MailPolicy = {
  saatmineLubatud: false,
  lubaArved: false,
  paevaLimiit: 20,
  testAadress: null,
  saatjaAadress: '',
}

/** The invoice fields this decision needs. */
export interface SendableInvoice {
  status: string
  issue_date: string | null
  gross_total: number | string
  sent_at: string | null
  payments?: { amount: number | string }[]
}

export type SendVerdict =
  | { send: true; to: string; redirected: boolean }
  | { send: false; code: SendBlockCode; reason: string }

const no = (code: SendBlockCode): SendVerdict =>
  ({ send: false, code, reason: SEND_BLOCK_LABEL[code] })

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Deliberately strict and deliberately dumb: one @, something either side, a
 * dot in the domain, no spaces. Not RFC 5322 — a regex that accepts everything
 * the RFC allows also accepts things this host will reject, and a bounce from
 * the clinic's main mailbox costs more than a false negative here does.
 */
export function looksLikeEmail(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  if (!s || s.length > 254) return false
  return /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]+$/.test(s)
}

/**
 * @param sentToday How many messages this clinic has already sent today. The
 *   caller counts them; this only compares. A cap that the sender enforced for
 *   itself would be no cap at all.
 */
export function maySendInvoice(
  invoice: SendableInvoice,
  policy: MailPolicy,
  recipient: string | null | undefined,
  sentToday: number,
  today: string
): SendVerdict {
  // Order matters: the cheapest and most absolute refusals first, so a log of
  // blocked sends reads as a reason and not as a cascade.
  if (!policy.saatmineLubatud) return no('valjas')
  if (!policy.lubaArved) return no('liik-keelatud')
  if (!looksLikeEmail(policy.saatjaAadress)) return no('saatja-puudub')

  if (invoice.sent_at) return no('juba-saadetud')
  if (invoice.status === 'tuhistatud') return no('tuhistatud')

  // Nothing owed is nothing to chase. A receipt is a different message with a
  // different permission, and this one is not it.
  const paid = (invoice.payments ?? []).reduce((s, p) => s + num(p.amount), 0)
  if (num(invoice.gross_total) - paid <= 0.005) return no('tasutud')

  // A payment plan writes five invoices up front, four of them dated in the
  // future. Without this the first run would post all five on day one — the
  // single worst thing this feature could do.
  const issue = (invoice.issue_date ?? '').slice(0, 10)
  if (!issue || issue > today) return no('tulevik')

  // The cap is checked before the address so that a run against a list of
  // unreachable addresses cannot quietly burn through it.
  if (!Number.isFinite(policy.paevaLimiit) || sentToday >= policy.paevaLimiit) {
    return no('paevalimiit')
  }

  // The test address wins over the real one, so nothing reaches a patient while
  // it is set — including an invoice whose own address is missing.
  if (policy.testAadress) {
    return looksLikeEmail(policy.testAadress)
      ? { send: true, to: policy.testAadress.trim(), redirected: true }
      : no('aadress-vigane')
  }

  const to = (recipient ?? '').trim()
  if (!to) return no('aadress-puudub')
  if (!looksLikeEmail(to)) return no('aadress-vigane')

  return { send: true, to, redirected: false }
}

/**
 * How many of these may still go out today, given the cap.
 *
 * Separate from the per-invoice check so a caller can slice the queue before
 * it starts, rather than discovering the ceiling one refusal at a time.
 */
export const remainingToday = (policy: MailPolicy, sentToday: number): number =>
  Math.max(0, (Number.isFinite(policy.paevaLimiit) ? policy.paevaLimiit : 0) - sentToday)

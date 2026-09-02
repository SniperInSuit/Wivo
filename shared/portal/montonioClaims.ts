/**
 * When a Montonio order token may be treated as PAYMENT RECEIVED.
 *
 * The signature check is not here — that needs the secret key and lives in the
 * edge function. This file holds the part that decides what a *validly signed*
 * token actually entitles the caller to, and it is separate for one reason: it
 * is the half that is easy to get subtly wrong, and it is the half that can be
 * tested without crypto, without Deno and without a network.
 *
 * ── A valid signature is not enough ──────────────────────────────────────────
 * A correctly signed token proves Montonio sent it. It does NOT prove it is
 * about *this* order, or that money moved. Three separate questions:
 *
 *   1. Did Montonio sign it?          → the caller checks, before calling this
 *   2. Is it for OUR merchant account? → `accessKey`
 *   3. Is it for THIS booking, and is it PAID? → `uuid`, `paymentStatus`
 *
 * Skipping (2) or (3) is how a token from a different order — or a replayed one
 * from a cancelled payment — marks a booking paid.
 *
 * ── The browser coming back is not payment ───────────────────────────────────
 * A person can type the return URL. Only a signed token counts, and this
 * function is the only thing that says a booking is settled.
 *
 * The `shared/` contract applies: no dependencies at all. See shared/README.md.
 */

/** The claims Wivo reads. Montonio sends more; the rest is not our business. */
export interface MontonioClaims {
  accessKey?: string
  uuid?: string
  merchantReference?: string
  paymentStatus?: string
  grandTotal?: number | string
  currency?: string
}

export type PaymentVerdict =
  | { ok: true; uuid: string }
  | { ok: false; reason: PaymentRefusal; selgitus: string }

export type PaymentRefusal =
  | 'vale-konto'      // accessKey is not ours
  | 'vale-tellimus'   // uuid does not match the order we created
  | 'maksmata'        // paymentStatus is not PAID
  | 'vale-summa'      // the amount does not match what we asked for
  | 'vale-valuuta'
  | 'puudulik'        // the token does not carry what it must

/**
 * Montonio's own vocabulary. `PAID` is the only one that means money moved;
 * everything else is listed so an unexpected value is refused rather than
 * treated as one of the known-bad ones.
 */
export const PAID = 'PAID'

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * @param expected What WE created: the order uuid, the amount we asked for, our
 *                 access key. Every one of these comes from our own database or
 *                 environment — never from the token being checked.
 */
export function acceptPayment(
  claims: MontonioClaims,
  expected: { accessKey: string; uuid: string; summa: number; valuuta: string },
): PaymentVerdict {
  const refuse = (reason: PaymentRefusal, selgitus: string): PaymentVerdict =>
    ({ ok: false, reason, selgitus })

  if (!claims || typeof claims !== 'object') {
    return refuse('puudulik', 'Token on tühi või vigane.')
  }
  if (!claims.uuid || !claims.accessKey || !claims.paymentStatus) {
    return refuse('puudulik', 'Tokenis puudub uuid, accessKey või paymentStatus.')
  }

  // Ours? Checked before anything else: a token signed by Montonio for a
  // DIFFERENT merchant is a real thing, and it must never touch our rows.
  if (claims.accessKey !== expected.accessKey) {
    return refuse('vale-konto', 'Token kuulub teisele Montonio kontole.')
  }

  // This booking? Without it, a token from any of our own other orders would
  // settle this one — replay, and it costs the clinic a real appointment.
  if (claims.uuid !== expected.uuid) {
    return refuse('vale-tellimus', 'Token ei käi selle broneeringu kohta.')
  }

  if (claims.paymentStatus !== PAID) {
    return refuse('maksmata', `Makse staatus on ${claims.paymentStatus}, mitte ${PAID}.`)
  }

  // The amount is checked even though we set it: a token claiming less than we
  // asked for means something is wrong somewhere, and quietly accepting it
  // would be accepting a short payment.
  const paid = num(claims.grandTotal)
  if (paid === null) return refuse('puudulik', 'Tokenis puudub summa.')
  if (Math.abs(paid - expected.summa) > 0.005) {
    return refuse('vale-summa', `Makstud ${paid}, oodati ${expected.summa}.`)
  }

  if ((claims.currency ?? '').toUpperCase() !== expected.valuuta.toUpperCase()) {
    return refuse('vale-valuuta', `Valuuta ${claims.currency}, oodati ${expected.valuuta}.`)
  }

  return { ok: true, uuid: claims.uuid }
}

/**
 * What to store when a payment did NOT succeed.
 *
 * A refusal is not always a failure worth flagging: `maksmata` on an ABANDONED
 * or PENDING order is a person who changed their mind at the bank, which is
 * ordinary. A mismatched account or order is not ordinary and the status must
 * not quietly become "just unpaid".
 */
export function refusalStatus(reason: PaymentRefusal, paymentStatus?: string): 'ootel' | 'ebaonnestus' | 'tuhistatud' {
  if (reason !== 'maksmata') return 'ebaonnestus'
  const s = (paymentStatus ?? '').toUpperCase()
  if (s === 'ABANDONED' || s === 'VOIDED' || s === 'CANCELLED') return 'tuhistatud'
  if (s === 'PENDING' || s === 'CREATED') return 'ootel'
  return 'ebaonnestus'
}

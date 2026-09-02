/**
 * What a patient may send when asking for an appointment, and what counts as
 * acceptable. ONE implementation, so the widget and the server agree.
 *
 * The widget validates to be helpful — telling someone their phone number is
 * missing before they press the button. The SERVER validates because the widget
 * is public code that anyone can bypass. Those are different jobs served by the
 * same function, which is the only way they can never disagree.
 *
 * ── This is a REQUEST, not a booking ─────────────────────────────────────────
 * Nothing here promises a time. `eelistatudAeg` is free text — "kolmapäeva
 * hommikul" is what a person actually says — and the clinic offers the real
 * slot. A form that appeared to book a time and then did not would be worse
 * than a form that never claimed to.
 *
 * ── The message field is the risk ────────────────────────────────────────────
 * "Mul on diabeet ja kardan puurimist" is health data under GDPR art. 9, typed
 * voluntarily into a marketing website. We cannot stop someone writing it, so:
 * the label says not to, the length is capped at something too short for a
 * medical history, and the cap is enforced HERE rather than only in the markup.
 *
 * The `shared/` contract applies: no dependencies at all. See shared/README.md.
 */

export interface VisitRequestInput {
  /** `PublicService.id`, or empty when the patient did not pick one. */
  serviceId?: string
  nimi: string
  telefon: string
  email?: string
  /** Free text. "Kolmapäeva hommikul", "nii pea kui võimalik". */
  eelistatudAeg?: string
  sonum?: string
  /**
   * Generated when the form OPENS, not when it is sent. A key made at send time
   * is new on every click, so a double-click becomes two requests — which is
   * exactly the case idempotency exists to stop.
   */
  idempotencyKey: string
  /**
   * Honeypot. A real person never sees this field and never fills it; a bot
   * fills every input it finds. Anything here means the submission is spam.
   *
   * Named innocuously ON PURPOSE — `honeypot` would be skipped by anything
   * built after 2005.
   */
  veebileht?: string
}

export const SONUM_MAX = 300
export const NIMI_MAX = 120
export const TELEFON_MAX = 40

/**
 * Everything wrong with this submission, in Estonian, ready to show.
 * Empty array = acceptable. Never throws: a validator that throws cannot report
 * the second problem.
 */
export function visitRequestProblems(input: VisitRequestInput): string[] {
  const p: string[] = []
  const nimi = (input.nimi ?? '').trim()
  const telefon = (input.telefon ?? '').trim()
  const email = (input.email ?? '').trim()
  const sonum = (input.sonum ?? '').trim()

  if (!nimi) p.push('Nimi on puudu.')
  else if (nimi.length > NIMI_MAX) p.push(`Nimi on liiga pikk (kuni ${NIMI_MAX} tähemärki).`)

  // Phone, not email, is the required one: a clinic rings back, and plenty of
  // people have no email they check.
  if (!telefon) p.push('Telefoninumber on puudu.')
  else if (!looksLikePhone(telefon)) p.push('Telefoninumber ei tundu õige.')

  if (email && !looksLikeEmail(email)) p.push('E-posti aadress ei tundu õige.')

  if (sonum.length > SONUM_MAX) {
    p.push(`Sõnum on liiga pikk (kuni ${SONUM_MAX} tähemärki).`)
  }

  if (!(input.idempotencyKey ?? '').trim()) p.push('Vormi võti on puudu.')

  return p
}

/** True when this submission is a bot. Checked separately from the problems. */
export function looksLikeSpam(input: VisitRequestInput): boolean {
  return (input.veebileht ?? '').trim().length > 0
}

/**
 * Digits and the separators people actually type. Deliberately loose: a
 * validator that rejects a real Estonian number because of a space costs a
 * booking, and the clinic rings the number anyway.
 *
 * The `+` is allowed ANYWHERE, not just at the front — "(+372) 555-1234" is a
 * form people write, and anchoring the plus rejected it. The digit count is
 * what carries the check; the character class only keeps out prose.
 */
export function looksLikePhone(v: string): boolean {
  const digits = v.replace(/[^\d]/g, '')
  if (digits.length < 5 || digits.length > 15) return false
  return /^[\d\s+()./-]+$/.test(v.trim())
}

/** Same shape check the invoice sender uses: one @, a dot after it, no spaces. */
export function looksLikeEmail(v: string): boolean {
  const s = v.trim()
  // Commas and semicolons are header smuggling, not addresses.
  if (/[,;<>\s]/.test(s)) return false
  const at = s.indexOf('@')
  if (at < 1 || at !== s.lastIndexOf('@')) return false
  const domain = s.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/**
 * The row to store. Trimmed, capped, and with the honeypot dropped — it is
 * evidence for a decision already made, not data worth keeping.
 *
 * Capping here rather than trusting the check constraint: a constraint failure
 * is a 500 for the patient, and the honest answer to 400 characters is to store
 * 300 of them, not to lose the request.
 */
export function toVisitRequestRow(input: VisitRequestInput): {
  service_id: string | null
  nimi: string
  telefon: string
  email: string | null
  eelistatud_aeg: string | null
  sonum: string | null
  idempotency_key: string
} {
  const cut = (v: string | undefined, max: number): string => (v ?? '').trim().slice(0, max)
  const orNull = (v: string): string | null => (v.length > 0 ? v : null)
  return {
    service_id: orNull(cut(input.serviceId, 120)),
    nimi: cut(input.nimi, NIMI_MAX),
    telefon: cut(input.telefon, TELEFON_MAX),
    email: orNull(cut(input.email, 200)),
    eelistatud_aeg: orNull(cut(input.eelistatudAeg, 200)),
    sonum: orNull(cut(input.sonum, SONUM_MAX)),
    idempotency_key: cut(input.idempotencyKey, 100),
  }
}

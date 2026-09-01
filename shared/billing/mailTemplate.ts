/**
 * The words around the invoice.
 *
 * The emailed invoice already carried the whole document — header, requisites,
 * lines, totals, payment reference. What it had none of was a LETTER: no
 * greeting, no sentence saying what this is, no sign-off. A correct document
 * with no words around it reads as machine-generated, which is exactly what a
 * patient is most likely to ignore or report as spam.
 *
 * The text is the clinic's, not ours. A lab writes to dentists, a clinic writes
 * to patients, and neither wants a default we invented in Estonian we imagined.
 *
 * NO DEPENDENCIES — `shared/README.md`. Rendered identically by the settings
 * preview and by the sender, so what the clinic reads before switching this on
 * is what actually goes out.
 */

export interface MailTemplate {
  /** Subject line. Tokens allowed. */
  pealkiri: string
  /** Above the invoice. Tokens allowed, blank lines kept. */
  sissejuhatus: string
  /** Below the invoice — sign-off, contact, anything else. */
  lopp: string
}

/**
 * Deliberately complete rather than empty.
 *
 * An empty default would ship the blank-looking mail this exists to fix, and
 * "write your own or get nothing" is a worse first run than a plain letter the
 * clinic edits. Every line here is meant to be replaced.
 */
export const DEFAULT_MAIL_TEMPLATE: MailTemplate = {
  pealkiri: 'Arve {arve} — tähtaeg {tahtaeg}',
  sissejuhatus:
    'Tere, {saaja}\n\n'
    + 'Saadame arve {arve} summas {summa}. Arve on selle kirja all.\n\n'
    + 'Palume tasuda hiljemalt {tahtaeg}. Maksekorralduse selgitusse palume '
    + 'märkida arve numbri.',
  lopp:
    'Küsimuste korral vastake sellele kirjale.\n\n'
    + 'Parimat,\n{kliinik}',
}

/**
 * What a token stands for. The settings screen lists these, so a clinic never
 * has to guess the spelling — a mistyped token would otherwise reach a patient
 * as literal curly braces.
 */
export const TEMPLATE_TOKENS: { token: string; selgitus: string }[] = [
  { token: '{arve}',     selgitus: 'Arve number' },
  { token: '{saaja}',    selgitus: 'Kellele arve on adresseeritud' },
  { token: '{summa}',    selgitus: 'Kokku tasuda' },
  { token: '{tasumata}', selgitus: 'Tasumata jääk' },
  { token: '{tahtaeg}',  selgitus: 'Maksetähtaeg' },
  { token: '{kuupaev}',  selgitus: 'Arve kuupäev' },
  { token: '{kliinik}',  selgitus: 'Kliiniku nimi' },
]

export type TemplateVars = Record<string, string>

/**
 * Substitute the tokens. An UNKNOWN token is left exactly as typed.
 *
 * Left rather than blanked on purpose: `{tahtaef}` reaching a patient as
 * literal braces is visible and gets fixed, while silently becoming an empty
 * string produces a sentence with a hole in it that nobody notices.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return (text ?? '').replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole
  )
}

/** Everything a template may refer to, from a rendered invoice document. */
export function templateVars(doc: {
  number: string
  issueDate: string
  dueDate: string
  buyer: { name: string }
  totals: { grossText: string; dueText: string }
  seller: { name: string }
}): TemplateVars {
  return {
    arve: doc.number,
    saaja: doc.buyer.name,
    summa: doc.totals.grossText,
    tasumata: doc.totals.dueText,
    tahtaeg: doc.dueDate,
    kuupaev: doc.issueDate,
    kliinik: doc.seller.name,
  }
}

/** Tokens used here that nothing can fill. For the settings screen to warn. */
export function unknownTokens(text: string, vars: TemplateVars): string[] {
  const found = [...(text ?? '').matchAll(/\{(\w+)\}/g)].map(m => m[1])
  return [...new Set(found.filter(k => !Object.prototype.hasOwnProperty.call(vars, k)))]
}

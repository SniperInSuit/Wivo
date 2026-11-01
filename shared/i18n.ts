/**
 * The interface language — Estonian, or English.
 *
 * ── Why every string is an inline pair, not a key into a dictionary ─────────
 * There are exactly two languages and there will not be a third any time soon.
 * A key file is a second place every string has to be kept in step with, and
 * the failure it invites — a key that exists in one language and not the other
 * — shows up as a raw key on screen in the language nobody tested. With
 * `t('Salvesta', 'Save')` both halves sit where the string is used, the
 * Estonian stays readable in the code (and greppable from a screenshot), and
 * TypeScript refuses a call that forgets either half.
 *
 * ── Why the language is fixed for the life of the page ──────────────────────
 * It is read ONCE, when this module is first evaluated, and changing it reloads
 * the window (see `setLang` in the renderer's lib/i18n). That is what lets a
 * module-level constant — a column title, a theme label, a list of options —
 * call `t()` like anything else. A live switch would have to turn every one of
 * them into a function and still miss whatever some `useMemo` had already
 * captured; a reload cannot miss anything.
 *
 * ── Why it lives in shared/ ─────────────────────────────────────────────────
 * The wizard and pricing rules here produce text the desktop app shows. Those
 * need `t()` too, and shared/ may not import from the renderer. Reading
 * `localStorage` through `globalThis` keeps this file dependency-free: main,
 * tests and the web portal have no `wivo_lang` and simply get Estonian.
 *
 * Text that leaves the building — invoices, e-mails, the patient portal, CSV
 * exports — does NOT go through `t()`. Its language is the recipient's, not
 * whichever one the person at the keyboard happens to read.
 */

export type Lang = 'et' | 'en'

/** Machine-wide, like the theme — see the renderer's lib/i18n for why. */
export const LANG_KEY = 'wivo_lang'

function readLang(): Lang {
  try {
    return globalThis.localStorage?.getItem(LANG_KEY) === 'en' ? 'en' : 'et'
  } catch {
    // Storage blocked or absent: the default, which is also what it was before.
    return 'et'
  }
}

export const lang: Lang = readLang()

/** The string in the current language. Estonian first, as the app was written. */
export function t(et: string, en: string): string {
  return lang === 'en' ? en : et
}

/**
 * The renderer's side of the interface language. The core — `t()` and the
 * language itself — is in shared/i18n.ts; this adds what only a window has:
 * switching, and the locales date-fns and Intl need.
 *
 * ── Per machine, not per person ─────────────────────────────────────────────
 * Stored like the theme, in its own localStorage key, rather than in
 * `profiles.ui_prefs`. The language has to be known before the first module
 * evaluates — the login screen is in it too — and a per-person value only
 * arrives after login, which would mean a second reload every time someone
 * signs in on a machine set to the other language.
 */
import { et, enGB } from 'date-fns/locale'
import { lang, LANG_KEY, type Lang } from '@shared/i18n'

export { t, lang, type Lang } from '@shared/i18n'

/** For date-fns `format(…, { locale })`: month and weekday names follow the UI. */
export const dateLocale = lang === 'en' ? enGB : et

/**
 * For `toLocaleString` / `Intl`. en-GB rather than en-US: day before month and
 * a 24-hour clock, which is what an Estonian lab reads either way.
 */
export const intlLocale = lang === 'en' ? 'en-GB' : 'et-EE'

/**
 * Save and reload. See shared/i18n.ts for why this does not switch live.
 * Whatever is on screen is lost, so the only caller is the Seaded control,
 * where nothing is half-typed.
 */
export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem(LANG_KEY, next)
  } catch {
    // Storage refused: reloading would only come back in the same language.
    return
  }
  window.location.reload()
}

// Screen readers and the spellchecker go by this, not by the text. Guarded
// because the tests import this file under Node, where there is no document.
if (typeof document !== 'undefined') document.documentElement.lang = lang

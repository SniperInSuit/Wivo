/**
 * Which language Chromium itself speaks.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 * Not the interface language — that is `shared/i18n` and every string in the
 * app goes through it. This is the layer underneath, the one `t()` cannot
 * reach: the native date and time pickers, the right-click menu, the
 * spellchecker, Chromium's own error pages.
 *
 * ── Why it was wrong ────────────────────────────────────────────────────────
 * `app.commandLine.appendSwitch('lang', 'et-EE')` was there to force a 24-hour
 * clock in the `datetime-local` and `time` controls, and the comment above it
 * said exactly that. Estonian was a side effect nobody meant, and it is one
 * `noHardcodedText` cannot see: open the app in English, click a date field,
 * and an Estonian calendar appears over it.
 *
 * `en-GB` has the same 24-hour clock and the same day-before-month order — the
 * renderer already picks it for `Intl` for precisely that reason — so the
 * original purpose is kept whichever language is chosen.
 *
 * ── Why it comes from a file ────────────────────────────────────────────────
 * The switch has to be set before the app is ready, and the chosen language
 * lives in the renderer's `localStorage`, which does not exist yet and which
 * the main process cannot read. So the renderer reports it on every boot and
 * the main process remembers it for the next one.
 *
 * That means a language change takes effect in these controls one launch
 * later. `setLang` already reloads the window, and Chromium's locale is fixed
 * for the life of the process, so there is no version of this without the lag.
 */
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

/**
 * UI language → the locale Chromium is started with.
 *
 * `en-GB` and not `en-US`: a 24-hour clock and day before month, which is what
 * this app has always shown and what the switch existed to guarantee.
 */
export function chromiumLocaleFor(lang: string | null | undefined): string {
  switch (lang) {
    case 'et': return 'et-EE'
    case 'ru': return 'ru-RU'
    default: return 'en-GB'
  }
}

const storePath = (): string => join(app.getPath('userData'), 'ui-language.json')

/**
 * The language last reported by the renderer, or null before it ever has.
 *
 * Any failure reads as null and the caller falls back to English. A missing or
 * corrupt file must not stop the app from starting over something this small.
 */
export function rememberedLanguage(): string | null {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf-8')) as { lang?: unknown }
    return typeof raw.lang === 'string' ? raw.lang : null
  } catch {
    return null
  }
}

/** Called from the renderer on boot and whenever the language changes. */
export function rememberLanguage(lang: string): void {
  if (lang !== 'et' && lang !== 'en' && lang !== 'ru') return
  if (rememberedLanguage() === lang) return
  try {
    writeFileSync(storePath(), JSON.stringify({ lang }), 'utf-8')
  } catch {
    // Read-only profile or a full disk. The controls stay in the previous
    // language, which is worth nothing to report and must not fail a boot.
  }
}

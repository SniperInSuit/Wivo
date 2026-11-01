/**
 * Interface language: English is the source, Estonian and Russian translate it.
 *
 * Spec, "Language": all interface text goes through i18n keys; English is the
 * source language; a missing translation shows the English text; the language
 * is a user setting with an organisation default.
 *
 * ── Why the language is fixed for the life of the page ──────────────────────
 * It is read ONCE, when this module is first evaluated, and changing it reloads
 * the window (the renderer's lib/i18n `setLang`). That is what lets a
 * module-level constant — a column title, a list of options — call `t()` like
 * anything else. A live switch would have to turn every one of them into a
 * function and still miss whatever some `useMemo` had already captured.
 *
 * ── Why it lives in shared/ ─────────────────────────────────────────────────
 * The wizard and pricing rules here produce text the desktop app shows, and
 * shared/ may not import from the renderer. Reading `localStorage` through
 * `globalThis` keeps this dependency-free: main, tests and the web portal have
 * no stored language and get the default.
 *
 * Text that leaves the building — invoices, e-mails, the patient portal, CSV
 * exports — does NOT go through `t()`. Its language is the recipient's, not
 * whichever one the person at the keyboard happens to read.
 */
import { en, type MessageKey } from './en'
import { et } from './et'
import { ru } from './ru'
import type { Message, Params } from './types'

export type { MessageKey } from './en'
export type { Message, Params } from './types'

export type Lang = 'en' | 'et' | 'ru'
export const LANGS: readonly Lang[] = ['en', 'et', 'ru']

/** Machine-wide for now, like the theme — see the renderer's lib/i18n. */
export const LANG_KEY = 'wivo_lang'

/**
 * When nobody has chosen. Estonian, because the one organisation that exists
 * today works in it. Phase 1 moves this to the organisation's own default.
 */
export const DEFAULT_LANG: Lang = 'et'

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)

function readLang(): Lang {
  try {
    const stored = globalThis.localStorage?.getItem(LANG_KEY)
    return isLang(stored) ? stored : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

export const lang: Lang = readLang()

const CATALOGS: Record<Lang, Partial<Record<MessageKey, Message>>> = { en, et, ru }

function render(msg: Message, params: Params | undefined): string {
  if (typeof msg === 'function') return msg(params ?? {})
  if (!params) return msg
  return msg.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name] ?? '') : whole)
}

/** The message for `key` in a given language, falling back to English. */
export function translate(language: Lang, key: MessageKey, params?: Params): string {
  return render(CATALOGS[language][key] ?? en[key], params)
}

/** The message for `key` in the current language, falling back to English. */
export function t(key: MessageKey, params?: Params): string {
  return translate(lang, key, params)
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/**
 * Weekday names, Monday first, in the current language. `short` is what a
 * chart axis fits (Mon / E), `letter` a single column (M / E).
 */
export function weekdays(style: 'long' | 'short' | 'letter'): string[] {
  const prefix = style === 'long' ? 'common.weekdayLong' : style === 'short' ? 'common.weekdayShort' : 'common.weekdayLetter'
  return WEEK.map(d => t(`${prefix}${d}` as MessageKey))
}

export interface LanguageSources {
  /** The user's own setting (profiles.language). */
  profile: Lang | null | undefined
  /** The organisation's default (clinics.default_language). */
  organisation: Lang | null | undefined
  /** What this window runs in now. */
  current: Lang
  /** Whether someone CHOSE the machine's language (a stored wivo_lang). */
  chosenOnThisMachine: boolean
}

/**
 * Which language a signed-in user should see, and whether their profile should
 * learn it. Spec: "the language is a user setting; the organisation has a
 * default".
 *
 * - Their own setting wins.
 * - No setting yet, but someone picked a language on this machine (the
 *   machine-wide switch before per-user settings existed): keep it, and save it
 *   to their profile — switching them to the organisation default would undo a
 *   choice they made.
 * - Otherwise the organisation's default, else what is running.
 */
export function decideLanguage(s: LanguageSources): { lang: Lang; saveToProfile: boolean } {
  if (s.profile && LANGS.includes(s.profile)) return { lang: s.profile, saveToProfile: false }
  if (s.chosenOnThisMachine) return { lang: s.current, saveToProfile: true }
  if (s.organisation && LANGS.includes(s.organisation)) return { lang: s.organisation, saveToProfile: false }
  return { lang: s.current, saveToProfile: false }
}

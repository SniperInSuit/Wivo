/**
 * Russian, for Riga. Empty for now: every key falls back to English.
 *
 * Spec, open questions: launch in English, the Russian translation within the
 * first month. Translate by adding keys from `en.ts`; nothing else changes.
 */
import type { Message } from './types'
import type { MessageKey } from './en'

export const ru: Partial<Record<MessageKey, Message>> = {
  // A push without its own words shows this as its title (sw.js); the sender's
  // words are already Russian (supabase/functions/_shared/pushText.ts).
  'mobile.pushFallbackTitle': "Новое уведомление",
}

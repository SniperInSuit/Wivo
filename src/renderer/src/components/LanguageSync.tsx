/**
 * After sign-in: show the language this USER chose, or their organisation's
 * default (spec: "the language is a user setting; the organisation has a
 * default"). Renders nothing. The language is fixed per page load
 * (shared/i18n), so a different answer means one reload; the next load reads
 * it from the machine cache and there is nothing left to do — no loop.
 */
import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { lang, setLang, decideLanguage, languageChosenHere } from '@/lib/i18n'

export function LanguageSync() {
  const { user, profile, clinic } = useAuth()

  useEffect(() => {
    if (!user || !profile) return
    const decision = decideLanguage({
      profile: profile.language ?? null,
      organisation: clinic?.default_language ?? null,
      current: lang,
      chosenOnThisMachine: languageChosenHere(),
    })
    if (decision.saveToProfile) {
      void supabase.from('profiles').update({ language: decision.lang }).eq('id', user.id).then(() => {}, () => {})
    }
    if (decision.lang !== lang) setLang(decision.lang)
  }, [user, profile, clinic])

  return null
}

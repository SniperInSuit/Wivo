/**
 * profiles.ui_prefs ⇄ the local preferences store.
 *
 * Renders nothing. Mounted beside ClinicSettingsSync inside the authed tree,
 * and deliberately much smaller than it: a person's own layout is not
 * collaborative, so there is no realtime channel, no seeding and no conflict to
 * resolve. Read once on login, write debounced.
 *
 * Reading costs no query. `getProfile()` already does `select('*')`, so the
 * column arrives with the profile the moment the migration has been run.
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateUiPrefs } from '../lib/supabase'
import { setUiPrefsUser, setUiPrefsPusher, applyRemotePrefs } from '../stores/useUiPrefs'
import type { UiPrefs } from '../lib/uiPrefs'

/** One drag fires onReorder continuously; the network must see one write. */
const DEBOUNCE_MS = 600

export function UiPrefsSync() {
  const { status, user, profile } = useAuth()
  const pending = useRef<UiPrefs | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef<string>('')
  // Set when a write fails in a way retrying cannot fix — most likely the
  // migration has not been run. Layout keeps working from the local cache;
  // firing a doomed request on every drag would just be noise.
  const disabled = useRef(false)

  useEffect(() => {
    if (status !== 'authenticated' || !user) {
      setUiPrefsPusher(null)
      setUiPrefsUser(null)
      return
    }

    disabled.current = false
    // Namespace the cache BEFORE applying the row, so the first paint after a
    // user switch never shows the previous person's dashboard.
    setUiPrefsUser(user.id)
    if (profile?.ui_prefs !== undefined) applyRemotePrefs(profile.ui_prefs)

    const flush = async () => {
      timer.current = null
      const next = pending.current
      pending.current = null
      if (!next || disabled.current) return
      const body = JSON.stringify(next)
      if (body === lastSent.current) return
      try {
        await updateUiPrefs(user.id, next)
        lastSent.current = body
      } catch (err) {
        disabled.current = true
        // Once, not per drag. The most likely cause is `42703 undefined column`
        // because sql/055 has not been run yet.
        console.warn('[wivo] vaateseadeid ei saanud salvestada, kasutan ainult kohalikku koopiat:', err)
      }
    }

    setUiPrefsPusher(next => {
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DEBOUNCE_MS)
    })

    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        // A layout dragged and then navigated away from within the debounce
        // window must not be lost.
        void flush()
      }
      setUiPrefsPusher(null)
    }
    // `profile.ui_prefs` is intentionally NOT a dependency: re-applying the row
    // whenever AuthContext refreshes the profile (which the Profiil settings
    // section does after any save) would overwrite whatever the user just
    // dragged with an older server copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id])

  return null
}

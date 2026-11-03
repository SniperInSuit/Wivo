/**
 * Phone: an old build reloads itself to the new version (docs/MIN-VERSION.md §5).
 *
 * The phone app is a web page; a fresh start already gets the newest version,
 * so an old build here is one left open for days. On start, whenever the app
 * comes back to the screen, and after a save refused for the version (426): if
 * this build is below the minimum, reload — unless the camera is open or a
 * message is being typed (then later). At most once in 10 minutes: if the
 * reloaded page is still old (not published yet, offline), a notice with a
 * button instead of a loop.
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMinVersion, MIN_VERSION_KEY } from '../hooks/useMinVersion'
import { APP_VERSION, onUpdateRequired, updateWasRequired } from '../lib/appVersion'
import { restartBlocked } from '../lib/restartGuard'
import { decidePhoneReload } from '../lib/updatePolicy'
import { t } from '@/lib/i18n'

const RELOADED_AT = 'wivo_update_reloaded_at'

function lastReloadAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(RELOADED_AT))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

function reloadForUpdate(): void {
  try { sessionStorage.setItem(RELOADED_AT, String(Date.now())) } catch { /* private mode: reload anyway */ }
  location.reload()
}

export function PhoneVersionGuard() {
  const minimum = useMinVersion()
  const qc = useQueryClient()
  const [refused, setRefused] = useState(updateWasRequired)
  const [notice, setNotice] = useState(false)

  useEffect(() => onUpdateRequired(() => setRefused(true)), [])

  // Back on the screen: ask the database again.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') void qc.invalidateQueries({ queryKey: MIN_VERSION_KEY }) }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [qc])

  useEffect(() => {
    let cancelled = false
    const decide = async () => {
      const decision = decidePhoneReload({
        running: APP_VERSION, minimum: minimum?.min_version ?? null, refused,
        blocked: await restartBlocked(), lastReloadAt: lastReloadAt(), now: Date.now(),
      })
      if (cancelled) return
      setNotice(decision === 'notice')
      if (decision === 'reload') reloadForUpdate()
    }
    void decide()
    const timer = setInterval(() => void decide(), 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [minimum, refused])

  if (!notice) return null
  return (
    <div role="alert" className="sticky top-0 z-50 flex items-center gap-2 bg-amber-600 px-3 py-2 text-xs text-white">
      <span className="flex-1">{t('updateRequired.phoneNotice')}</span>
      <button type="button" onClick={reloadForUpdate} className="flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1 font-semibold">
        <RefreshCw size={12} aria-hidden="true" /> {t('updateRequired.reload')}
      </button>
    </div>
  )
}

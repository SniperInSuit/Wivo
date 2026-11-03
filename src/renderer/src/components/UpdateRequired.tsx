/**
 * Desktop: when this build is too old (docs/MIN-VERSION.md §4).
 *
 * - A save was refused for the version (HTTP 426): a banner "Update Wivo"
 *   with "Restart now" once the update is downloaded; until then it asks the
 *   updater for it at once.
 * - A REQUIRED minimum this build is below, the update downloaded and nothing
 *   open (no unsaved form, upload, download or print): a 60-second countdown,
 *   then Wivo restarts into the new version. "Wait 15 min" up to three times.
 *
 * The rule at the top of main/updater.ts still holds: an update never stops
 * somebody working. Anything open simply makes it wait.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useUpdate } from '../providers/UpdateProvider'
import { useMinVersion } from '../hooks/useMinVersion'
import { onUpdateRequired, updateWasRequired, versionBelow } from '../lib/appVersion'
import { restartBlocked } from '../lib/restartGuard'
import { decideRequiredRestart, canPostpone, COUNTDOWN_SECONDS, POSTPONE_MS, MAX_POSTPONEMENTS } from '../lib/updatePolicy'
import { t } from '@/lib/i18n'

export function UpdateRequired() {
  const { running, state, installNow, checkNow } = useUpdate()
  const minimum = useMinVersion()
  const [refused, setRefused] = useState(updateWasRequired)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [postponements, setPostponements] = useState(0)
  const postponedUntil = useRef(0)
  const asked = useRef(0)
  const downloaded = state.stage === 'ready'
  const newVersion = state.stage === 'ready' ? state.version : minimum?.min_version ?? ''

  useEffect(() => onUpdateRequired(() => setRefused(true)), [])

  // Too old (refused, or below any minimum) and nothing downloaded: ask the updater now, at most every 10 minutes.
  const tooOld = refused || (!!minimum && versionBelow(running, minimum.min_version))
  useEffect(() => {
    if (!tooOld || downloaded || Date.now() - asked.current < 10 * 60_000) return
    asked.current = Date.now()
    checkNow()
  }, [tooOld, downloaded, checkNow])

  // The required restart: decided every 30 s, and every second while counting down.
  useEffect(() => {
    let cancelled = false
    const decide = async () => {
      const decision = decideRequiredRestart({
        running, minimum, downloaded, blocked: await restartBlocked(), postponedUntil: postponedUntil.current, now: Date.now(),
      })
      if (cancelled) return
      if (decision === 'fetch' && Date.now() - asked.current > 10 * 60_000) { asked.current = Date.now(); checkNow() }
      setCountdown(c => (decision === 'countdown' ? (c ?? COUNTDOWN_SECONDS) : null))
    }
    void decide()
    const timer = setInterval(() => void decide(), countdown === null ? 30_000 : 1_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [running, minimum, downloaded, countdown === null, checkNow])

  // The countdown itself; at zero, one last look, then restart.
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      void restartBlocked().then(blocked => { if (blocked) setCountdown(null); else installNow() })
      return
    }
    const timer = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1_000)
    return () => clearTimeout(timer)
  }, [countdown, installNow])

  function postpone() {
    postponedUntil.current = Date.now() + POSTPONE_MS
    setPostponements(n => n + 1)
    setCountdown(null)
  }

  if (countdown !== null) {
    return (
      <Bar>
        <span className="font-semibold">{t('updateRequired.restartingIn', { seconds: Math.max(0, countdown), version: newVersion })}</span>
        <button type="button" onClick={installNow} className="btn-primary text-xs px-3 py-1">
          <RefreshCw size={12} /> {t('updateBanner.restartNow')}
        </button>
        {canPostpone(postponements) && (
          <button type="button" onClick={postpone} className="btn-ghost text-xs border border-white/40 text-white">
            {t('updateRequired.wait15', { left: MAX_POSTPONEMENTS - postponements })}
          </button>
        )}
      </Bar>
    )
  }

  if (!refused) return null
  return (
    <Bar>
      <span className="font-semibold">{t('app.updateRequired')}</span>
      {downloaded ? (
        <button type="button" onClick={installNow} className="btn-primary text-xs px-3 py-1">
          <RefreshCw size={12} /> {t('updateBanner.restartNow')}
        </button>
      ) : (
        <span className="text-white/80">{t('updateRequired.fetching')}</span>
      )}
    </Bar>
  )
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="fixed top-0 inset-x-0 z-[90] flex flex-wrap items-center justify-center gap-3 bg-amber-600 px-4 py-2 text-xs text-white shadow-card">
      <AlertTriangle size={14} aria-hidden="true" />
      {children}
    </div>
  )
}

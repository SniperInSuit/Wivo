/**
 * Right after sign-in: notifications were on for this person on this phone,
 * but the browser no longer holds the subscription (lib/push.ts, 'lost').
 * Registering the existing one again needs no tap and happens by itself; a
 * new one can need a tap on an iPhone, so it is one tap here. "Not now"
 * stops offering it until the switch in Settings is turned on.
 */
import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { syncPushSubscription, enablePush, declinePush } from '../lib/push'
import { describeError } from '../components/Patients/errors'
import { t } from '@/lib/i18n'

export function PushTurnOnNotice() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The same check MfaGate starts after sign-in: one request between them.
  useEffect(() => {
    let cancelled = false
    void syncPushSubscription().then(state => { if (!cancelled) setShow(state === 'lost') }, () => {})
    return () => { cancelled = true }
  }, [])

  async function turnOn() {
    setBusy(true)
    setError(null)
    // Blocked in the phone's settings instead: Settings says so.
    try { await enablePush(); setShow(false) }
    catch (e) { setError(describeError(e)) }
    finally { setBusy(false) }
  }

  if (!show) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b border-accent/20 bg-accent/10 px-3 py-2 text-xs text-ink">
      <BellRing size={14} className="flex-shrink-0 text-accent" aria-hidden="true" />
      <span className="flex-1">{error ?? t('mobile.pushOffNotice')}</span>
      <button type="button" onClick={() => void turnOn()} disabled={busy}
        className="btn-primary px-2.5 py-1 text-xs disabled:opacity-50">
        {t('mobile.pushTurnOn')}
      </button>
      <button type="button" onClick={() => { declinePush(); setShow(false) }} disabled={busy}
        aria-label={t('mobile.pushNotNow')} title={t('mobile.pushNotNow')} className="rounded-lg p-1 text-ink-muted">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
